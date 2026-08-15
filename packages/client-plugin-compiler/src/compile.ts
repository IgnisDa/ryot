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
import { Effect } from "effect";

import {
	CLIENT_ARTIFACT_DOCUMENT_NAME,
	CLIENT_ARTIFACT_SCRIPT_NAME,
	CLIENT_ARTIFACT_STYLE_NAME,
	clientArtifactDocument,
	clientArtifactMetadata,
	clientAssetArtifactFile,
	clientAssetName,
	clientGeneratedArtifactFile,
} from "./artifact";
import { bundleClientPlugin } from "./bundle";
import { resolveClientPluginCompilerDependencies } from "./dependencies";
import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";
import { CLIENT_PLUGIN_COMPILER_LIMITS } from "./limits";
import { checkClientPluginTypes } from "./semantic-check";
import { compileClientStyles } from "./styles";

const CLIENT_SOURCE_ROOT = "client/";
const SHARED_SOURCE_ROOT = "shared/";
const SCANNED_EXTENSIONS = new Set(["ts", "tsx"]);

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

export type ClientPluginCompilerSingleInput = ClientPluginCompilerBaseInput & {
	readonly entry: string;
	readonly application?: "page" | "plugin";
	readonly pluginDependencies?: readonly string[];
	readonly files: Readonly<Record<string, Uint8Array>>;
	readonly publicExports?: Readonly<Record<string, ClientPluginCompilerPackageExport>>;
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
	| ClientPluginCompilerSingleInput
	| ClientPluginCompilerGraphInput;

const GENERATED_PAGE_ENTRY = "client/__ryot_page_entry.tsx";
const GENERATED_PACKAGE_VALIDATION_ENTRY = "client/__ryot_public_exports_validation__.tsx";

const PUBLIC_EXPORT_SPECIFIER =
	/^@ryot-app\/plugins\/[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const PUBLIC_EXPORT_NAME = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const CONTRIBUTOR_NAMESPACE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const pageEntrySource = (entry: string, automaticExports: readonly string[] = []) => `
import { bootstrapClientPage } from "@ryot-app/client-sdk/plugin";
import Page from ${JSON.stringify(`./${entry.slice(CLIENT_SOURCE_ROOT.length).replace(/\.(?:ts|tsx)$/, "")}`)};
${automaticExports.map((specifier, index) => `import AutomaticPresentation${index} from ${JSON.stringify(specifier)};`).join("\n")}
void [${automaticExports.map((_, index) => `AutomaticPresentation${index}`).join(", ")}];
bootstrapClientPage(Page);
`;

const pluginRouteEntrySource = (
	registry: ClientPluginRouteRegistry,
	automaticExports: readonly string[],
) => {
	const routes = [...registry.routes].sort((left, right) =>
		comparePluginRoutePaths(left.path, right.path),
	);
	const registrations = [
		["Home", registry.home],
		...routes.map(({ exportSpecifier }, index) => [`Route${index}`, exportSpecifier]),
		...(registry.notFound === undefined ? [] : [["NotFound", registry.notFound]]),
		...automaticExports.map((specifier, index) => [`AutomaticPresentation${index}`, specifier]),
	] as const;
	return `
import { bootstrapClientPlugin } from "@ryot-app/client-sdk/plugin";
${registrations.map(([name, specifier]) => `import ${name} from ${JSON.stringify(specifier)};`).join("\n")}
void [${automaticExports.map((_, index) => `AutomaticPresentation${index}`).join(", ")}];
bootstrapClientPlugin({
  home: { component: Home },
	  routes: [${routes
			.map(({ path }, index) => `{ path: ${JSON.stringify(path)}, component: Route${index} }`)
			.join(", ")}],
  ${registry.notFound === undefined ? "" : "notFound: NotFound,"}
});
`;
};

const publicExportType = (kind: ClientPluginExportKind | undefined) => {
	if (kind === "presentation") {
		return "ComponentType<EntityRendererProps>";
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
		`import { bootstrapClientPage, type EntityRendererProps } from "@ryot-app/client-sdk/plugin";`,
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

const packageValidationSource = (
	publicExports: Readonly<Record<string, ClientPluginCompilerPackageExport>>,
) => {
	const imports = [
		`import type { ComponentType } from "react";`,
		`import { bootstrapClientPage } from "@ryot-app/client-sdk/plugin";`,
		`import type { EntityRendererProps } from "@ryot-app/client-sdk/plugin";`,
	];
	for (const [index, [, declaration]] of sortBy(
		Object.entries(publicExports),
		([name]) => name,
	).entries()) {
		const specifier = `./${declaration.entry.slice(CLIENT_SOURCE_ROOT.length).replace(/\.(?:ts|tsx)$/, "")}`;
		imports.push(`import PublicExport${index} from ${JSON.stringify(specifier)};`);
		imports.push(
			declaration.kind === "page"
				? `const publicExport${index} = () => bootstrapClientPage(PublicExport${index});`
				: `const publicExport${index}: ${publicExportType(declaration.kind)} = PublicExport${index};`,
		);
		imports.push(`void publicExport${index};`);
	}
	return imports.join("\n");
};

const packageDependencyDeclarations = (pluginDependencies: readonly string[]) =>
	pluginDependencies
		.map(
			(slug) =>
				`declare module ${JSON.stringify(`@ryot-app/plugins/${slug}/*`)} { const value: any; export default value; }`,
		)
		.join("\n");

const contributorNamespaceOf = (path: string) => path.split("/")[1] ?? "";

const orderContributorSources = (paths: readonly string[], contributorOrder: readonly string[]) => {
	const order = new Map(contributorOrder.map((namespace, index) => [namespace, index]));
	return [...paths].sort((left, right) => {
		const rank = (path: string) =>
			order.get(contributorNamespaceOf(path)) ?? Number.MAX_SAFE_INTEGER;
		return rank(left) - rank(right) || left.localeCompare(right);
	});
};

const extensionOf = (path: string) => path.slice(path.lastIndexOf(".") + 1);

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

const bytesEqual = (left: Uint8Array, right: Uint8Array) =>
	left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);

export const compileClientPlugin = (input: ClientPluginCompilerInput) =>
	Effect.gen(function* () {
		let entry: string;
		const pluginName = input.name;
		let packagePageEntry: string | undefined;
		const graphInput = "contributors" in input;
		let automaticExports: readonly string[] = [];
		let files: Readonly<Record<string, Uint8Array>>;
		const application = input.application ?? "plugin";
		let pluginRouteRegistry: ClientPluginRouteRegistry | undefined;
		let publicExportPaths: Readonly<Record<string, string>> = {};
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
			if (application === "plugin-route") {
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
			automaticExports = sortBy(
				(input.automaticRegistry ?? []).map((registration) => {
					const key = `${registration.ownerPluginId}/${registration.entitySchemaSlug}/${registration.layout}`;
					const declaration = input.publicExports[registration.exportSpecifier];
					if (registryKeys.has(key) || declaration?.kind !== "presentation") {
						return "";
					}
					registryKeys.add(key);
					return registration.exportSpecifier;
				}),
			).filter(Boolean);
			if (automaticExports.length !== (input.automaticRegistry ?? []).length) {
				return yield* failure(
					entry,
					"RYOT_CLIENT_AUTOMATIC_REGISTRY",
					"Automatic registry entries must be unique and reference authorized presentation exports",
				);
			}
		} else {
			entry = input.entry;
			files = input.files;
			packagePublicExports = input.publicExports ?? {};
			packagePageEntry = sortBy(
				Object.values(packagePublicExports).filter(({ kind }) => kind === "page"),
				({ entry: pageEntry }) => pageEntry,
			)[0]?.entry;
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
			(!entry.endsWith(".ts") && !entry.endsWith(".tsx")) ||
			!(graphInput ? entry.includes("/client/") : entry.startsWith(CLIENT_SOURCE_ROOT)) ||
			!Object.hasOwn(files, entry)
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
		const generatedPageEntry = graphInput
			? `contributors/${input.entry.contributor}/${GENERATED_PAGE_ENTRY}`
			: GENERATED_PAGE_ENTRY;
		const generatedPageSourceEntry =
			application === "page" || application === "plugin-route" ? entry : packagePageEntry;
		const buildEntry = generatedPageSourceEntry === undefined ? entry : generatedPageEntry;
		if (generatedPageSourceEntry !== undefined) {
			if (Object.hasOwn(sourceFiles, generatedPageEntry)) {
				return yield* failure(
					entry,
					"RYOT_CLIENT_ENTRY",
					"Client sources use a compiler-owned entry path",
				);
			}
			sourceFiles[generatedPageEntry] =
				graphInput && pluginRouteRegistry
					? pluginRouteEntrySource(pluginRouteRegistry, automaticExports)
					: pageEntrySource(
							graphInput ? input.entry.path : generatedPageSourceEntry,
							automaticExports,
						);
		}
		if (!graphInput && Object.keys(packagePublicExports).length > 0) {
			if (Object.hasOwn(sourceFiles, GENERATED_PACKAGE_VALIDATION_ENTRY)) {
				return yield* failure(
					entry,
					"RYOT_CLIENT_ENTRY",
					"Client sources use a compiler-owned public export validation path",
				);
			}
			sourceFiles[GENERATED_PACKAGE_VALIDATION_ENTRY] =
				packageValidationSource(packagePublicExports);
			const dependencyDeclarations = packageDependencyDeclarations(input.pluginDependencies ?? []);
			if (dependencyDeclarations.length > 0) {
				sourceFiles["client/__ryot_plugin_dependencies__.d.ts"] = dependencyDeclarations;
			}
		}

		const assetNames = Object.fromEntries(
			assetSources.map(([path, contents]) => [path, clientAssetName(path, contents)]),
		);
		const dependencies = yield* resolveClientPluginCompilerDependencies;
		const bundled = yield* bundleClientPlugin(
			{ entry: buildEntry, assetNames, files: sourceFiles, publicExports: publicExportPaths },
			dependencies.compilerRoot,
		);
		if ("diagnostics" in bundled) {
			return yield* clientPluginCompilationFailure(bundled.diagnostics);
		}
		if (!graphInput && Object.keys(packagePublicExports).length > 0) {
			const validationBundle = yield* bundleClientPlugin(
				{
					files: sourceFiles,
					assetNames,
					publicExports: {},
					entry: GENERATED_PACKAGE_VALIDATION_ENTRY,
					unresolvedPluginDependencies: input.pluginDependencies ?? [],
				},
				dependencies.compilerRoot,
			);
			if ("diagnostics" in validationBundle) {
				return yield* clientPluginCompilationFailure(validationBundle.diagnostics);
			}
		}
		const reachablePublicExports = sortBy([
			...new Set([...bundled.publicExports, ...automaticExports]),
		]);
		const validationEntry = "__ryot_client_validation__.tsx";
		const checkedSourceFiles = graphInput
			? Object.fromEntries(
					bundled.sources.flatMap((path) =>
						sourceFiles[path] === undefined ? [] : [[path, sourceFiles[path]]],
					),
				)
			: { ...sourceFiles };
		if (application === "page" || application === "plugin-route") {
			checkedSourceFiles[validationEntry] = validationSource(
				"@ryot-internal/application-entry",
				reachablePublicExports,
				publicExports,
			);
		}
		const typeDiagnostics = yield* checkClientPluginTypes(checkedSourceFiles, dependencies, {
			...(application === "page" || application === "plugin-route"
				? { "@ryot-internal/application-entry": entry }
				: {}),
			...Object.fromEntries(
				reachablePublicExports.map((specifier) => [specifier, publicExportPaths[specifier] ?? ""]),
			),
		}).pipe(
			Effect.mapError((error) =>
				clientPluginCompilationFailure([
					clientPluginCompilerDiagnostic(
						"RYOT_CLIENT_COMPILER",
						buildEntry,
						`TypeScript compiler failed: ${String(error)}`,
					),
				]),
			),
		);
		if (typeDiagnostics.length > 0) {
			return yield* clientPluginCompilationFailure(typeDiagnostics);
		}
		const styles = yield* compileClientStyles({
			entry,
			files,
			assetNames,
			sourceFiles,
			fontStylesheet: dependencies.fontStylesheet,
			themeStylesheet: dependencies.themeStylesheet,
			paletteStylesheet: dependencies.paletteStylesheet,
			tailwindStylesheet: dependencies.tailwindStylesheet,
			stylesheets: (graphInput
				? orderContributorSources(bundled.stylesheets, input.contributorOrder)
				: bundled.stylesheets
			).map((path) => ({ path, content: sourceFiles[path] ?? "" })),
			scanSources: [
				...(graphInput ? bundled.sources.map((path) => [path, files[path]] as const) : clientFiles)
					.filter(([path]) => SCANNED_EXTENSIONS.has(extensionOf(path)))
					.map(([path]) => ({ extension: extensionOf(path), content: sourceFiles[path] ?? "" })),
				...dependencies.uiSdkScanSources,
			],
		});
		const reachablePaths = new Set([
			...bundled.sources,
			...styles.sources,
			...bundled.assets,
			...styles.assets,
		]);
		const reachableSourceBytes = [...reachablePaths].reduce(
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
		const reachableOversizedAsset = assetSources.find(
			([path, contents]) =>
				reachablePaths.has(path) && contents.byteLength > CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes,
		);
		if (graphInput && reachableOversizedAsset) {
			return yield* failure(
				reachableOversizedAsset[0],
				"RYOT_CLIENT_ASSET_SIZE",
				`Client plugin asset exceeds ${CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes} bytes`,
			);
		}

		const assetsByName = new Map<string, PluginClientArtifactFile>();
		const emittedAssets: Array<readonly [string, PluginClientArtifactFile]> = [];
		for (const path of new Set([...bundled.assets, ...styles.assets])) {
			const contents = files[path];
			const name = assetNames[path];
			if (contents === undefined || name === undefined) {
				return yield* failure(
					path,
					"RYOT_CLIENT_ARTIFACT_FILE",
					`Client plugin asset "${path}" could not be emitted`,
				);
			}
			emittedAssets.push([path, clientAssetArtifactFile(path, name, contents)]);
		}
		for (const file of dependencies.fontAssets) {
			emittedAssets.push([file.name, file]);
		}
		for (const [path, file] of emittedAssets) {
			const existing = assetsByName.get(file.name);
			if (existing === undefined) {
				assetsByName.set(file.name, file);
			} else if (
				!bytesEqual(existing.contents, file.contents) ||
				existing.contentType !== file.contentType
			) {
				return yield* failure(
					path,
					"RYOT_CLIENT_ARTIFACT_FILE",
					`Client plugin assets emitted duplicate file name "${file.name}"`,
				);
			}
		}

		const hashedFiles = sortBy(
			[
				clientGeneratedArtifactFile(CLIENT_ARTIFACT_SCRIPT_NAME, bundled.javascript),
				clientGeneratedArtifactFile(CLIENT_ARTIFACT_STYLE_NAME, styles.css),
				...assetsByName.values(),
			],
			(file) => file.name,
		);
		const metadata = clientArtifactMetadata(pluginName, hashedFiles);
		const artifact: PluginClientArtifact = {
			...metadata,
			files: [
				...hashedFiles,
				clientGeneratedArtifactFile(
					CLIENT_ARTIFACT_DOCUMENT_NAME,
					clientArtifactDocument(pluginName, metadata),
				),
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
	});
