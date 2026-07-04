import { relative as relativePath, resolve as resolvePath } from "node:path";

import { BunFileSystem } from "@effect/platform-bun";
import type {
	CLIENT_API_VERSION,
	PluginClientArtifact,
	PluginClientArtifactFile,
} from "@ryot-app/client-plugin-contract";
import {
	isPluginClientTextSource,
	pluginClientFileExtension,
	pluginClientAssetMimeType,
} from "@ryot-app/client-plugin-contract";
import { comparePluginRoutePaths } from "@ryot-app/contract/modules/plugins/manifest";
import { isPluginSharedSource } from "@ryot-app/contract/modules/plugins/shared-file-policy";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";
import {
	acquireCompilerWorkspace,
	stageGeneratedFiles,
	stageSourceFiles,
	validateRelativePath,
	ViteBuildService,
} from "@ryot-app/vite-compiler";
import { Effect, Layer, Result } from "effect";

import {
	CLIENT_ARTIFACT_DOCUMENT_NAME,
	clientArtifactFile,
	clientArtifactMetadata,
} from "./artifact";
import { bundleClientPlugin } from "./bundle";
import { resolveClientPluginCompilerDependencies } from "./dependencies";
import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";
import { CLIENT_PLUGIN_COMPILER_LIMITS } from "./limits";
import { analyzeClientPluginTypes } from "./semantic-check";
import { validateClientSourcePolicy } from "./styles";

const CLIENT_SOURCE_ROOT = "client/";
const SHARED_SOURCE_ROOT = "shared/";
const ARTIFACT_METADATA_PLACEHOLDER = "__RYOT_CLIENT_ARTIFACT_METADATA__";
const GENERATED_BOOTSTRAP = "__generated/bootstrap.tsx";
const GENERATED_VALIDATION = "__generated/validation.tsx";
const compilerLayer = Layer.merge(BunFileSystem.layer, ViteBuildService.layer);

const isClientSourcePath = (path: string) =>
	path.startsWith(CLIENT_SOURCE_ROOT) || path.includes(`/${CLIENT_SOURCE_ROOT}`);
const isSharedSourcePath = (path: string) =>
	path.startsWith(SHARED_SOURCE_ROOT) || path.includes(`/${SHARED_SOURCE_ROOT}`);

const isCompiledTextSource = (path: string) =>
	isSharedSourcePath(path)
		? isPluginSharedSource(path.slice(path.lastIndexOf(SHARED_SOURCE_ROOT)))
		: isPluginClientTextSource(path);

type ClientPluginCompilerBaseInput = {
	readonly name: string;
	readonly apiVersion: typeof CLIENT_API_VERSION;
};

export type ClientPluginCompilerPackageInput = ClientPluginCompilerBaseInput & {
	readonly pluginDependencies?: readonly string[];
	readonly files: Readonly<Record<string, Uint8Array>>;
	readonly publicExports: Readonly<Record<string, ClientPluginCompilerPackageExport>>;
};

export type ClientPluginExportKind = "component" | "page" | "presentation";

export type ClientPluginCompilerContributor = {
	readonly files: Readonly<Record<string, Uint8Array>>;
};

export type ClientPluginCompilerPublicExport = {
	readonly entry: string;
	readonly contributor: string;
	readonly kind: ClientPluginExportKind;
};

export type ClientPluginCompilerPackageExport = Omit<
	ClientPluginCompilerPublicExport,
	"contributor"
>;

export type ClientPluginAutomaticRegistryEntry = {
	readonly ownerPluginId: string;
	readonly layout: "grid" | "list";
	readonly exportSpecifier: string;
	readonly entitySchemaSlug: string;
};

export type ClientPluginRouteRegistry = {
	readonly home: string;
	readonly notFound?: string;
	readonly routes: readonly { readonly path: string; readonly exportSpecifier: string }[];
};

export type ClientPluginCompilerGraphInput = ClientPluginCompilerBaseInput & {
	readonly contributorOrder: readonly string[];
	readonly application: "page" | "plugin-route";
	readonly routeRegistry?: ClientPluginRouteRegistry;
	readonly entry: { readonly contributor: string; readonly path: string };
	readonly automaticRegistry?: readonly ClientPluginAutomaticRegistryEntry[];
	readonly contributors: Readonly<Record<string, ClientPluginCompilerContributor>>;
	readonly publicExports: Readonly<Record<string, ClientPluginCompilerPublicExport>>;
};

export type ClientPluginCompilerInput =
	| ClientPluginCompilerPackageInput
	| ClientPluginCompilerGraphInput;

const PUBLIC_EXPORT_SPECIFIER =
	/^@ryot-app\/plugins\/[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const PUBLIC_EXPORT_NAME = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const CONTRIBUTOR_NAMESPACE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const automaticRegistrySource = (
	automaticRegistry: readonly ClientPluginAutomaticRegistryEntry[],
) =>
	`{ entityPresentations: [${automaticRegistry
		.map(
			(registration, index) =>
				`{ ownerPluginId: ${JSON.stringify(registration.ownerPluginId)}, entitySchemaSlug: ${JSON.stringify(registration.entitySchemaSlug)}, layout: ${JSON.stringify(registration.layout)}, definition: AutomaticPresentation${index} }`,
		)
		.join(", ")}] }`;

const pageEntrySource = (automaticRegistry: readonly ClientPluginAutomaticRegistryEntry[] = []) => `
import { bootstrapClientPage } from "@ryot-app/client-sdk/plugin";
import Page from "@ryot-internal/application-entry";
${automaticRegistry.map(({ exportSpecifier }, index) => `import AutomaticPresentation${index} from ${JSON.stringify(exportSpecifier)};`).join("\n")}
bootstrapClientPage(Page, ${automaticRegistrySource(automaticRegistry)});
`;

const pluginRouteEntrySource = (
	registry: ClientPluginRouteRegistry,
	automaticRegistry: readonly ClientPluginAutomaticRegistryEntry[],
) => {
	const routes = [...registry.routes].sort((left, right) =>
		comparePluginRoutePaths(left.path, right.path),
	);
	const registrations = [
		["Home", registry.home],
		...routes.map(({ exportSpecifier }, index) => [`Route${index}`, exportSpecifier]),
		...(registry.notFound === undefined ? [] : [["NotFound", registry.notFound]]),
		...automaticRegistry.map(({ exportSpecifier }, index) => [
			`AutomaticPresentation${index}`,
			exportSpecifier,
		]),
	] as const;
	return `
import { bootstrapClientPlugin } from "@ryot-app/client-sdk/plugin";
${registrations.map(([name, specifier]) => `import ${name} from ${JSON.stringify(specifier)};`).join("\n")}
bootstrapClientPlugin({
  home: { component: Home },
	  routes: [${routes
			.map(({ path }, index) => `{ path: ${JSON.stringify(path)}, component: Route${index} }`)
			.join(", ")}],
  ${registry.notFound === undefined ? "" : "notFound: NotFound,"}
}, ${automaticRegistrySource(automaticRegistry)});
`;
};

const publicExportType = (kind: ClientPluginExportKind | undefined) => {
	if (kind === "presentation") {
		return "EntityPresentationDefinition";
	}
	return kind === "component" ? "ComponentType<any>" : "ComponentType";
};

const validationSource = (
	entrySpecifier: string,
	publicSpecifiers: readonly string[],
	publicExports: Readonly<Record<string, ClientPluginCompilerPublicExport>>,
) => {
	const imports = [
		`import type { ComponentType } from "react";`,
		`import { bootstrapClientPage, type EntityPresentationDefinition } from "@ryot-app/client-sdk/plugin";`,
		`import Application from ${JSON.stringify(entrySpecifier)};`,
		`const application: ComponentType = Application;`,
		`void application;`,
	];
	publicSpecifiers.forEach((specifier, index) => {
		const expected = publicExportType(publicExports[specifier]?.kind);
		imports.push(`import PublicExport${index} from ${JSON.stringify(specifier)};`);
		imports.push(`const publicExport${index}: ${expected} = PublicExport${index};`);
		imports.push(`void publicExport${index};`);
	});
	return imports.join("\n");
};

const packageDependencyDeclarations = (pluginDependencies: readonly string[]) =>
	pluginDependencies
		.map(
			(slug) =>
				`declare module ${JSON.stringify(`@ryot-app/plugins/${slug}/*`)} { const value: any; export default value; }`,
		)
		.join("\n");

const packageValidationSource = (
	publicExports: Readonly<Record<string, ClientPluginCompilerPackageExport>>,
) => {
	const imports = [
		`import type { ComponentType } from "react";`,
		`import type { EntityPresentationDefinition } from "@ryot-app/client-sdk/plugin";`,
	];
	for (const [index, [, declaration]] of sortBy(
		Object.entries(publicExports),
		([name]) => name,
	).entries()) {
		imports.push(
			`import PublicExport${index} from ${JSON.stringify(`@ryot-internal/package-export-${index}`)};`,
		);
		imports.push(
			`const publicExport${index}: ${publicExportType(declaration.kind)} = PublicExport${index};`,
		);
		imports.push(`void publicExport${index};`);
	}
	return imports.join("\n");
};

const failure = (entry: string, code: string, message: string) =>
	clientPluginCompilationFailure([clientPluginCompilerDiagnostic(code, entry, message)]);

const duplicateFileName = (files: readonly PluginClientArtifactFile[]) => {
	const names = new Set<string>();
	return files.find(({ name }) => {
		if (names.has(name)) {
			return true;
		}
		names.add(name);
		return false;
	})?.name;
};

const escapeHtmlText = (value: string) =>
	value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const generatedDocument = (name: string) => `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${escapeHtmlText(name)}</title>
		<script type="application/json" id="ryot-client-artifact">${ARTIFACT_METADATA_PLACEHOLDER}</script>
	</head>
	<body>
		<div id="app"></div>
		<script type="module" src="./bootstrap.tsx"></script>
	</body>
</html>
`;

const baseStylesheet = `@layer base {
	html, body { height: 100%; margin: 0; overflow: hidden; overscroll-behavior-y: none; -webkit-tap-highlight-color: transparent; }
	body { background: var(--bg); font-family: var(--font-family-ui); }
	#app { height: 100%; isolation: isolate; overflow: hidden; position: relative; }
}`;

const compilerStylesheet = (
	reachableSources: readonly string[],
	sourcePath: string,
	generatedPath: string,
	clientSdkRoot: string,
	uiSdkRoot: string,
) => {
	const source = (path: string) =>
		`@source ${JSON.stringify(relativePath(generatedPath, path).replaceAll("\\", "/"))};`;
	return [
		'@import "@fontsource-variable/outfit";',
		'@import "@fontsource-variable/lora";',
		'@import "tailwindcss" source(none);',
		'@import "@ryot-app/client-ui-sdk/theme.css";',
		'@import "@ryot-app/client-ui-sdk/palette.css";',
		...reachableSources
			.filter((path) => /\.tsx?$/.test(path))
			.map((path) => source(resolvePath(sourcePath, path))),
		source(clientSdkRoot),
		source(uiSdkRoot),
		baseStylesheet,
	].join("\n");
};

const outputReferenceIssue = (
	name: string,
	contents: string,
	contentType: string,
	names: ReadonlySet<string>,
	pluginDependencies: ReadonlySet<string>,
) => {
	let pattern = /(?:\bimport\s*\(\s*|\bnew\s+URL\s*\(\s*)["'`]([^"'`]+)["'`]/g;
	if (contentType.startsWith("text/html")) {
		pattern = /(?:src|href)=["']([^"']+)["']/g;
	} else if (contentType.startsWith("text/css")) {
		pattern = /url\(\s*["']?([^"')]+)/g;
	}
	for (const match of contents.matchAll(pattern)) {
		const reference = match[1];
		const pluginSlug = reference?.match(PUBLIC_EXPORT_SPECIFIER)?.[0].split("/")[2];
		if (
			!reference ||
			reference.startsWith("#") ||
			reference.startsWith("data:") ||
			/^[a-z][\w+.-]*:/i.test(reference) ||
			reference.startsWith("//") ||
			(pluginSlug !== undefined && pluginDependencies.has(pluginSlug))
		) {
			continue;
		}
		const target = reference.split(/[?#]/, 1)[0]?.replace(/^\.\//, "") ?? "";
		if (target.startsWith("/") || target.includes("..") || !names.has(target)) {
			return `Emitted file "${name}" references missing or escaping path "${reference}"`;
		}
	}
	return null;
};

export const compileClientPlugin = (input: ClientPluginCompilerInput) =>
	Effect.gen(function* () {
		let entry: string;
		const pluginName = input.name;
		const graphInput = "contributors" in input;
		let automaticExports: readonly string[] = [];
		let files: Readonly<Record<string, Uint8Array>>;
		let publicExportPaths: Readonly<Record<string, string>> = {};
		let pluginRouteRegistry: ClientPluginRouteRegistry | undefined;
		let automaticRegistry: readonly ClientPluginAutomaticRegistryEntry[] = [];
		let publicExports: Readonly<Record<string, ClientPluginCompilerPublicExport>> = {};
		let packagePublicExports: Readonly<Record<string, ClientPluginCompilerPackageExport>> = {};

		if (graphInput) {
			if (
				new Set(input.contributorOrder).size !== input.contributorOrder.length ||
				input.contributorOrder.length !== Object.keys(input.contributors).length ||
				input.contributorOrder.some((contributor) => input.contributors[contributor] === undefined)
			) {
				return yield* failure(
					input.entry.contributor,
					"RYOT_CLIENT_CONTRIBUTOR",
					"Contributor order must contain every contributor exactly once",
				);
			}
			const namespacedFiles: Record<string, Uint8Array> = {};
			for (const contributor of sortBy(Object.keys(input.contributors))) {
				if (!CONTRIBUTOR_NAMESPACE.test(contributor)) {
					return yield* failure(
						contributor,
						"RYOT_CLIENT_CONTRIBUTOR",
						`Contributor namespace "${contributor}" is not canonical`,
					);
				}
				for (const [path, contents] of Object.entries(
					input.contributors[contributor]?.files ?? {},
				)) {
					if (
						canonicalRelativePosixPathIssue(path) !== null ||
						(path.startsWith(CLIENT_SOURCE_ROOT)
							? pluginClientFileExtension(path) === undefined
							: !isPluginSharedSource(path))
					) {
						return yield* failure(
							path,
							"RYOT_CLIENT_SOURCE_PATH",
							`Contributor "${contributor}" source "${path}" must be an allowed canonical client/ or shared/ file`,
						);
					}
					namespacedFiles[`contributors/${contributor}/${path}`] = contents;
				}
			}

			const selectedContributor = input.contributors[input.entry.contributor];
			if (selectedContributor === undefined) {
				return yield* failure(
					input.entry.contributor,
					"RYOT_CLIENT_ENTRY",
					`Application contributor "${input.entry.contributor}" is missing`,
				);
			}
			entry = `contributors/${input.entry.contributor}/${input.entry.path}`;
			files = namespacedFiles;
			publicExports = input.publicExports;
			const resolvedPublicExports: Record<string, string> = {};
			for (const [specifier, declaration] of Object.entries(input.publicExports)) {
				if (!PUBLIC_EXPORT_SPECIFIER.test(specifier)) {
					return yield* failure(
						specifier,
						"RYOT_CLIENT_PUBLIC_EXPORT",
						`Public export specifier "${specifier}" is not canonical`,
					);
				}
				if (
					input.contributors[declaration.contributor] === undefined ||
					canonicalRelativePosixPathIssue(declaration.entry) !== null ||
					!declaration.entry.startsWith(CLIENT_SOURCE_ROOT)
				) {
					return yield* failure(
						specifier,
						"RYOT_CLIENT_PUBLIC_EXPORT",
						`Public export "${specifier}" has an invalid contributor or client entry`,
					);
				}
				const target = `contributors/${declaration.contributor}/${declaration.entry}`;
				if (!Object.hasOwn(namespacedFiles, target)) {
					return yield* failure(
						specifier,
						"RYOT_CLIENT_PUBLIC_EXPORT",
						`Public export "${specifier}" entry "${declaration.entry}" is missing`,
					);
				}
				resolvedPublicExports[specifier] = target;
			}
			publicExportPaths = resolvedPublicExports;
			if (input.application === "plugin-route") {
				const registry = input.routeRegistry;
				const routePaths = new Set(registry?.routes.map(({ path }) => path) ?? []);
				const registrySpecifiers = registry
					? [
							registry.home,
							...registry.routes.map(({ exportSpecifier }) => exportSpecifier),
							...(registry.notFound === undefined ? [] : [registry.notFound]),
						]
					: [];
				if (
					!registry ||
					routePaths.size !== registry.routes.length ||
					registry.routes.some(({ path }) => path === "/") ||
					registrySpecifiers.some((specifier) => input.publicExports[specifier]?.kind !== "page")
				) {
					return yield* failure(
						entry,
						"RYOT_CLIENT_ROUTE_REGISTRY",
						"Plugin route registry must have one home and unique non-home routes referencing authorized page exports",
					);
				}
				pluginRouteRegistry = registry;
			}
			const registryKeys = new Set<string>();
			const checkedAutomaticRegistry: ClientPluginAutomaticRegistryEntry[] = [];
			for (const registration of input.automaticRegistry ?? []) {
				const key = `${registration.ownerPluginId}/${registration.entitySchemaSlug}/${registration.layout}`;
				const declaration = input.publicExports[registration.exportSpecifier];
				if (registryKeys.has(key) || declaration?.kind !== "presentation") {
					return yield* failure(
						entry,
						"RYOT_CLIENT_AUTOMATIC_REGISTRY",
						"Automatic registry entries must be unique and reference authorized presentation exports",
					);
				}
				registryKeys.add(key);
				checkedAutomaticRegistry.push(registration);
			}
			automaticRegistry = sortBy(
				checkedAutomaticRegistry,
				({ layout, ownerPluginId, exportSpecifier, entitySchemaSlug }) =>
					`${ownerPluginId}\u0000${entitySchemaSlug}\u0000${layout}\u0000${exportSpecifier}`,
			);
			automaticExports = automaticRegistry.map(({ exportSpecifier }) => exportSpecifier);
		} else {
			entry = "client";
			files = input.files;
			for (const path of Object.keys(files)) {
				if (
					(path.startsWith(CLIENT_SOURCE_ROOT) || path.startsWith(SHARED_SOURCE_ROOT)) &&
					(canonicalRelativePosixPathIssue(path) !== null ||
						(path.startsWith(CLIENT_SOURCE_ROOT)
							? pluginClientFileExtension(path) === undefined
							: !isPluginSharedSource(path)))
				) {
					return yield* failure(
						path,
						"RYOT_CLIENT_SOURCE_PATH",
						`Source "${path}" must be an allowed canonical client/ or shared/ file`,
					);
				}
			}
			packagePublicExports = input.publicExports;
			for (const [name, declaration] of Object.entries(packagePublicExports)) {
				if (
					!PUBLIC_EXPORT_NAME.test(name) ||
					canonicalRelativePosixPathIssue(declaration.entry) !== null ||
					!declaration.entry.startsWith(CLIENT_SOURCE_ROOT) ||
					pluginClientFileExtension(declaration.entry) === undefined ||
					!Object.hasOwn(files, declaration.entry)
				) {
					return yield* failure(
						declaration.entry,
						"RYOT_CLIENT_PUBLIC_EXPORT",
						`Public export "${name}" must reference a client TypeScript source present in the plugin package`,
					);
				}
			}
		}

		if (
			graphInput &&
			((!entry.endsWith(".ts") && !entry.endsWith(".tsx")) ||
				!entry.includes("/client/") ||
				!Object.hasOwn(files, entry))
		) {
			return yield* failure(
				entry,
				"RYOT_CLIENT_ENTRY",
				`Client entry "${entry}" must be a client source file present in the plugin package`,
			);
		}

		const compiledFiles = sortBy(
			Object.entries(files).filter(
				([path]) => isClientSourcePath(path) || isSharedSourcePath(path),
			),
			([path]) => path,
		);
		const clientFiles = compiledFiles.filter(([path]) => isClientSourcePath(path));
		const packageSourceBytes = compiledFiles.reduce(
			(total, [, contents]) => total + contents.byteLength,
			0,
		);
		if (!graphInput && packageSourceBytes > CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes) {
			return yield* failure(
				entry,
				"RYOT_CLIENT_SOURCE_SIZE",
				`Client plugin source exceeds ${CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes} bytes`,
			);
		}

		const assetSources = clientFiles.filter(
			([path]) => pluginClientAssetMimeType(path) !== undefined,
		);
		const oversizedAsset = assetSources.find(
			([, contents]) => contents.byteLength > CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes,
		);
		if (!graphInput && oversizedAsset) {
			return yield* failure(
				oversizedAsset[0],
				"RYOT_CLIENT_ASSET_SIZE",
				`Client plugin asset exceeds ${CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes} bytes`,
			);
		}

		const sourceFiles: Record<string, string> = {};
		const decoder = new TextDecoder("utf-8", { fatal: true });
		for (const [path, contents] of compiledFiles) {
			if (!isCompiledTextSource(path)) {
				continue;
			}
			try {
				sourceFiles[path] = decoder.decode(contents);
			} catch {
				return yield* failure(
					path,
					"RYOT_CLIENT_UTF8",
					`Client text source "${path}" is not valid UTF-8`,
				);
			}
		}
		const dependencies = yield* resolveClientPluginCompilerDependencies;
		const policyDiagnostics = validateClientSourcePolicy({
			files,
			sourceFiles,
			publicExports: publicExportPaths,
			...(!graphInput ? { unresolvedPluginDependencies: input.pluginDependencies ?? [] } : {}),
		});
		if (policyDiagnostics.length > 0) {
			return yield* clientPluginCompilationFailure(policyDiagnostics);
		}

		let applicationSource: string;
		if (!graphInput) {
			applicationSource = packageValidationSource(packagePublicExports);
		} else if (input.application === "plugin-route" && pluginRouteRegistry) {
			applicationSource = pluginRouteEntrySource(pluginRouteRegistry, automaticRegistry);
		} else {
			applicationSource = pageEntrySource(automaticRegistry);
		}
		const bootstrapSource = `${applicationSource}\nimport "./styles.css";\n`;
		if (!graphInput) {
			const declarations = packageDependencyDeclarations(input.pluginDependencies ?? []);
			if (declarations) {
				sourceFiles["client/__ryot_plugin_dependencies__.d.ts"] = declarations;
			}
		}
		const typeAliases: Record<string, string> = graphInput
			? { "@ryot-internal/application-entry": entry, ...publicExportPaths }
			: Object.fromEntries(
					sortBy(Object.entries(packagePublicExports), ([name]) => name).map(
						([, declaration], index) => [
							`@ryot-internal/package-export-${index}`,
							declaration.entry,
						],
					),
				);
		const analysisFiles = { ...sourceFiles, [GENERATED_BOOTSTRAP]: bootstrapSource };
		const analysis = yield* analyzeClientPluginTypes(
			analysisFiles,
			dependencies,
			typeAliases,
			graphInput ? [GENERATED_BOOTSTRAP] : undefined,
		).pipe(
			Effect.mapError((error) =>
				clientPluginCompilationFailure([
					clientPluginCompilerDiagnostic(
						"RYOT_CLIENT_COMPILER",
						entry,
						`TypeScript compiler failed: ${String(error)}`,
					),
				]),
			),
		);
		if (analysis.diagnostics.length > 0) {
			return yield* clientPluginCompilationFailure(analysis.diagnostics);
		}
		const reachableSources = graphInput
			? analysis.sources.filter((path) => path !== GENERATED_BOOTSTRAP)
			: Object.keys(sourceFiles);
		if (graphInput) {
			const reachablePublicExports = sortBy([
				...new Set([
					...automaticExports,
					...Object.entries(publicExportPaths).flatMap(([specifier, path]) =>
						reachableSources.includes(path) ? [specifier] : [],
					),
				]),
			]);
			const checked = {
				...sourceFiles,
				[GENERATED_VALIDATION]: validationSource(
					"@ryot-internal/application-entry",
					reachablePublicExports,
					publicExports,
				),
			};
			const checkedAnalysis = yield* analyzeClientPluginTypes(checked, dependencies, typeAliases, [
				GENERATED_VALIDATION,
			]);
			if (checkedAnalysis.diagnostics.length > 0) {
				return yield* clientPluginCompilationFailure(checkedAnalysis.diagnostics);
			}
		}
		const reachableSourceBytes = reachableSources.reduce(
			(total, path) => total + (files[path]?.byteLength ?? 0),
			0,
		);
		if (graphInput && reachableSourceBytes > CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes) {
			return yield* failure(
				entry,
				"RYOT_CLIENT_SOURCE_SIZE",
				`Client plugin source exceeds ${CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes} bytes`,
			);
		}

		const workspace = yield* acquireCompilerWorkspace({
			parentPath: dependencies.compilerRoot,
		}).pipe(
			Effect.mapError((error) =>
				clientPluginCompilationFailure([
					clientPluginCompilerDiagnostic("RYOT_CLIENT_COMPILER", entry, error.message),
				]),
			),
		);
		yield* stageSourceFiles(
			workspace,
			compiledFiles.map(([path, contents]) => ({ path, contents })),
		).pipe(
			Effect.mapError((error) =>
				clientPluginCompilationFailure([
					clientPluginCompilerDiagnostic("RYOT_CLIENT_SOURCE_PATH", entry, error.message),
				]),
			),
		);
		yield* stageGeneratedFiles(workspace, [
			{ path: "bootstrap.tsx", contents: bootstrapSource },
			{ path: "index.html", contents: generatedDocument(pluginName) },
			{
				path: "styles.css",
				contents: compilerStylesheet(
					reachableSources,
					workspace.sourcePath,
					workspace.generatedPath,
					dependencies.clientSdkRoot,
					dependencies.uiSdkRoot,
				),
			},
		]).pipe(
			Effect.mapError((error) =>
				clientPluginCompilationFailure([
					clientPluginCompilerDiagnostic("RYOT_CLIENT_COMPILER", entry, error.message),
				]),
			),
		);
		const viteAliases = Object.fromEntries(
			Object.entries(typeAliases).map(([specifier, path]) => [specifier, path]),
		);
		const bundled = yield* bundleClientPlugin({
			entry,
			workspace,
			publicExports: viteAliases,
			...(!graphInput ? { unresolvedPluginDependencies: input.pluginDependencies ?? [] } : {}),
		});
		const emittedErrors = bundled.diagnostics.filter(({ severity }) => severity === "error");
		if (emittedErrors.length > 0) {
			return yield* clientPluginCompilationFailure(emittedErrors);
		}
		if (bundled.files.length > CLIENT_PLUGIN_COMPILER_LIMITS.artifactFileCount) {
			return yield* failure(
				entry,
				"RYOT_CLIENT_ARTIFACT_FILE",
				"Compiled client artifact emits too many files",
			);
		}
		const oversizedOutputAsset = bundled.files.find(
			(file) =>
				!file.contentType.startsWith("text/") &&
				file.bytes.byteLength > CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes,
		);
		if (oversizedOutputAsset) {
			return yield* failure(
				entry,
				"RYOT_CLIENT_ASSET_SIZE",
				`Emitted client asset "${oversizedOutputAsset.path}" exceeds ${CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes} bytes`,
			);
		}
		const html = bundled.files.find(({ path }) => path === CLIENT_ARTIFACT_DOCUMENT_NAME);
		if (!html) {
			return yield* failure(
				entry,
				"RYOT_CLIENT_ARTIFACT_FILE",
				`Vite did not emit index.html (${bundled.files.map(({ path }) => path).join(", ")})`,
			);
		}
		const hashedFiles = bundled.files
			.filter(({ path }) => path !== CLIENT_ARTIFACT_DOCUMENT_NAME)
			.map(clientArtifactFile);
		const names = new Set(hashedFiles.map(({ name }) => name));
		names.add(CLIENT_ARTIFACT_DOCUMENT_NAME);
		const pluginDependencies = new Set(!graphInput ? (input.pluginDependencies ?? []) : []);
		for (const file of bundled.files) {
			if (Result.isFailure(validateRelativePath(file.path))) {
				return yield* failure(
					entry,
					"RYOT_CLIENT_ARTIFACT_FILE",
					`Vite emitted invalid path "${file.path}"`,
				);
			}
			if (
				!/^(?:text\/(?:html|css|javascript); charset=utf-8|image\/(?:png|gif|jpeg|webp|avif|x-icon|svg\+xml)|font\/woff2|application\/wasm)$/.test(
					file.contentType,
				)
			) {
				return yield* failure(
					entry,
					"RYOT_CLIENT_ARTIFACT_FILE",
					`Vite emitted unsupported MIME type "${file.contentType}"`,
				);
			}
			if (file.contentType.startsWith("text/")) {
				const issue = outputReferenceIssue(
					file.path,
					decoder.decode(file.bytes),
					file.contentType,
					names,
					pluginDependencies,
				);
				if (issue) {
					return yield* failure(entry, "RYOT_CLIENT_ARTIFACT_FILE", issue);
				}
			}
		}
		const metadata = clientArtifactMetadata(pluginName, hashedFiles);
		const emittedDocument = decoder.decode(html.bytes);
		if (!emittedDocument.includes(ARTIFACT_METADATA_PLACEHOLDER)) {
			return yield* failure(
				entry,
				"RYOT_CLIENT_ARTIFACT_FILE",
				"Vite HTML lost the artifact metadata placeholder",
			);
		}
		const artifact: PluginClientArtifact = {
			...metadata,
			files: [
				...sortBy(hashedFiles, ({ name }) => name),
				clientArtifactFile({
					contentType: html.contentType,
					path: CLIENT_ARTIFACT_DOCUMENT_NAME,
					bytes: new TextEncoder().encode(
						emittedDocument.replace(ARTIFACT_METADATA_PLACEHOLDER, JSON.stringify(metadata)),
					),
				}),
			],
		};
		const duplicateName = duplicateFileName(artifact.files);
		if (duplicateName !== undefined) {
			return yield* failure(
				entry,
				"RYOT_CLIENT_ARTIFACT_FILE",
				`Client plugin emitted duplicate file name "${duplicateName}"`,
			);
		}

		const artifactBytes = artifact.files.reduce(
			(total, file) => total + file.contents.byteLength,
			0,
		);
		if (artifactBytes > CLIENT_PLUGIN_COMPILER_LIMITS.artifactBytes) {
			return yield* failure(
				entry,
				"RYOT_CLIENT_ARTIFACT_SIZE",
				`Compiled client artifact exceeds ${CLIENT_PLUGIN_COMPILER_LIMITS.artifactBytes} bytes`,
			);
		}

		return { artifact };
	}).pipe(Effect.provide(compilerLayer), Effect.scoped);
