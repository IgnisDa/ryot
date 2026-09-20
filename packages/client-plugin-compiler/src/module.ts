// Vite consumes native absolute paths for the staged entry and workspace regions.
// oxlint-disable-next-line effecttsgo/node-builtin-import
import { resolve } from "node:path";

import {
	clientArtifactFile,
	clientArtifactMetadata,
	isPluginClientArtifactContentType,
	type PluginClientArtifact,
} from "@ryot-app/client-plugin-contract";
import { decodeExecutableText } from "@ryot-app/ts-utils/executable-text";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { inspectJavaScriptReferences } from "@ryot-app/typescript-compiler/javascript-references";
import type { ViteBuildService } from "@ryot-app/vite-compiler";
import {
	acquireCompilerWorkspace,
	buildWithVite,
	stageGeneratedFiles,
	stageSourceFiles,
	validateRelativePath,
} from "@ryot-app/vite-compiler";
import tailwindcss from "@tailwindcss/vite";
import { Effect, type FileSystem, Result } from "effect";

import { validateClientPluginPackage } from "./compile";
import { isNeutralPluginModule, isTrustedClientModule } from "./dependencies";
import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";
import type { ClientPluginCompilerDiagnostic, ClientPluginCompilerFailure } from "./diagnostics";
import { compilerStylesheet } from "./generated-source";
import type { ClientPluginCompilerPackageInput } from "./input";
import { CLIENT_PLUGIN_COMPILER_LIMITS } from "./limits";
import { cssOutputReferences } from "./output-references";
import { isCompiledTextSource } from "./planning";
import { isExternalReference, referencePath } from "./reference-path";
import { clientTypeScriptProject } from "./semantic-check";

const PLUGIN_IMPORT =
	/^@ryot-app\/plugins\/([a-z0-9]+(?:[._-][a-z0-9]+)*)\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const OUTPUT_FILE =
	/^(?:module\.(?:js|css)|chunk-[A-Za-z0-9_-]+\.js|asset-[A-Za-z0-9_-]+\.(?:svg|png|jpe?g|gif|webp|avif|ico|woff2|wasm))$/;

const failure = (entry: string, code: string, message: string) =>
	clientPluginCompilationFailure([clientPluginCompilerDiagnostic(code, entry, message)]);

const viteDiagnostic = (diagnostic: {
	readonly code?: string;
	readonly file?: string;
	readonly location?: { readonly line: number; readonly column: number };
	readonly message: string;
}): ClientPluginCompilerDiagnostic => ({
	severity: "error",
	message: diagnostic.message,
	code: diagnostic.code ?? "RYOT_CLIENT_BUNDLE",
	line: Math.max(1, diagnostic.location?.line ?? 1),
	column: Math.max(1, diagnostic.location?.column ?? 1),
	file: diagnostic.file?.replace(/^source\//, "") ?? "client",
});

const moduleSource = (input: ClientPluginCompilerPackageInput) => {
	const imports: string[] = [];
	const exports: string[] = [];
	for (const [index, [, declaration]] of sortBy(
		Object.entries(input.publicExports),
		([name]) => name,
	).entries()) {
		const binding = `Export${index}`;
		imports.push(`import ${binding} from ${JSON.stringify(`../source/${declaration.entry}`)};`);
		exports.push(`export { ${binding} };`);
	}
	return [...imports, 'import "./styles.css";', ...exports, ""].join("\n");
};

const outputReferenceIssue = (
	name: string,
	contents: string,
	contentType: string,
	names: ReadonlySet<string>,
	trustedModules: ReadonlySet<string>,
	pluginDependencies: ReadonlySet<string>,
) => {
	let references: string[];
	if (contentType.startsWith("text/javascript")) {
		const parsed = inspectJavaScriptReferences(contents);
		if (parsed.dynamicExpressions.length > 0) {
			return `Emitted file "${name}" contains a non-literal dynamic import`;
		}
		references = [...parsed.imports, ...parsed.assets];
	} else if (contentType.startsWith("text/css")) {
		references = cssOutputReferences(contents, name).map(({ reference }) => reference);
	} else {
		return null;
	}
	for (const reference of references) {
		const pluginSlug = PLUGIN_IMPORT.exec(reference)?.[1];
		if (
			isExternalReference(reference) ||
			trustedModules.has(reference) ||
			(pluginSlug !== undefined && pluginDependencies.has(pluginSlug))
		) {
			continue;
		}
		const target = referencePath(reference).replace(/^\.\//, "");
		if (target.startsWith("/") || target.includes("..") || !names.has(target)) {
			return `Emitted file "${name}" references missing, external, or escaping path "${reference}"`;
		}
	}
	return null;
};

export const compileClientPluginModule = (
	input: ClientPluginCompilerPackageInput,
): Effect.Effect<
	{ readonly artifact: PluginClientArtifact },
	ClientPluginCompilerFailure,
	FileSystem.FileSystem | ViteBuildService
> =>
	Effect.gen(function* () {
		const { dependencies, compiledFiles: sourceEntries } =
			yield* validateClientPluginPackage(input);
		const reachableSources = sourceEntries
			.filter(([path]) => isCompiledTextSource(path))
			.map(([path]) => path);
		const workspace = yield* acquireCompilerWorkspace({
			parentPath: dependencies.compilerRoot,
		}).pipe(Effect.mapError((error) => failure("client", "RYOT_CLIENT_COMPILER", error.message)));
		yield* stageSourceFiles(
			workspace,
			sourceEntries.map(([path, contents]) => ({ path, contents })),
		).pipe(Effect.mapError((error) => failure("client", "RYOT_CLIENT_SOURCE_PATH", error.message)));
		yield* stageGeneratedFiles(workspace, [
			{ path: "module.ts", contents: moduleSource(input) },
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
		]).pipe(Effect.mapError((error) => failure("client", "RYOT_CLIENT_COMPILER", error.message)));

		const trustedModules = new Set(
			Object.keys(dependencies.typeScriptEntries).filter(
				(specifier) => isTrustedClientModule(specifier) || isNeutralPluginModule(specifier),
			),
		);
		const pluginDependencies = new Set(input.pluginDependencies ?? []);
		const bundled = yield* buildWithVite({
			workspace,
			root: workspace.generatedPath,
			typeScriptProject: clientTypeScriptProject,
			config: {
				base: "./",
				mode: "production",
				plugins: tailwindcss(),
				resolve: { noExternal: true },
				oxc: { jsx: { development: false } },
				envPrefix: "__RYOT_CLIENT_PLUGIN_NO_ENV__",
				define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' },
				build: {
					minify: true,
					sourcemap: false,
					target: "es2022",
					cssCodeSplit: false,
					assetsInlineLimit: 0,
					modulePreload: false,
					rolldownOptions: {
						preserveEntrySignatures: "strict",
						input: resolve(workspace.generatedPath, "module.ts"),
						external: (specifier: string) => {
							const pluginSlug = PLUGIN_IMPORT.exec(specifier)?.[1];
							return (
								trustedModules.has(specifier) ||
								(pluginSlug !== undefined && pluginDependencies.has(pluginSlug))
							);
						},
						output: {
							format: "es",
							entryFileNames: "module.js",
							chunkFileNames: "chunk-[hash].js",
							assetFileNames: ({ names }) =>
								names.some((name) => name.endsWith(".css"))
									? "module.css"
									: "asset-[hash][extname]",
						},
					},
				},
			},
		}).pipe(
			Effect.mapError((error) => {
				const diagnostics = (error.diagnostics ?? [])
					.filter(({ severity }) => severity === "error")
					.map(viteDiagnostic);
				return clientPluginCompilationFailure(
					diagnostics.length > 0
						? diagnostics
						: [clientPluginCompilerDiagnostic("RYOT_CLIENT_BUNDLE", "client", error.message)],
				);
			}),
		);
		const buildErrors = bundled.diagnostics.filter(({ severity }) => severity === "error");
		if (buildErrors.length > 0) {
			return yield* clientPluginCompilationFailure(buildErrors.map(viteDiagnostic));
		}

		if (bundled.files.length > CLIENT_PLUGIN_COMPILER_LIMITS.artifactFileCount) {
			return yield* failure(
				"client",
				"RYOT_CLIENT_ARTIFACT_FILE",
				"Compiled client module emits too many files",
			);
		}
		const cssFiles = bundled.files.filter(({ contentType }) => contentType.startsWith("text/css"));
		if (cssFiles.length !== 1 || cssFiles[0]?.path !== "module.css") {
			return yield* failure(
				"client",
				"RYOT_CLIENT_ARTIFACT_FILE",
				"Vite did not emit exactly one module.css stylesheet",
			);
		}
		const moduleEntry = bundled.files.find(({ path }) => path === "module.js");
		if (!moduleEntry) {
			return yield* failure("client", "RYOT_CLIENT_ARTIFACT_FILE", "Vite did not emit module.js");
		}

		for (const file of bundled.files) {
			if (Result.isFailure(validateRelativePath(file.path)) || !OUTPUT_FILE.test(file.path)) {
				return yield* failure(
					"client",
					"RYOT_CLIENT_ARTIFACT_FILE",
					`Vite emitted unsupported module file name "${file.path}"`,
				);
			}
			if (!isPluginClientArtifactContentType(file.contentType)) {
				return yield* failure(
					"client",
					"RYOT_CLIENT_ARTIFACT_FILE",
					`Vite emitted unsupported MIME type "${file.contentType}"`,
				);
			}
			if (
				!file.contentType.startsWith("text/") &&
				file.bytes.byteLength > CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes
			) {
				return yield* failure(
					file.path,
					"RYOT_CLIENT_ASSET_SIZE",
					`Emitted client asset "${file.path}" exceeds ${CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes} bytes`,
				);
			}
		}

		const names = new Set(bundled.files.map(({ path }) => path));
		for (const file of bundled.files) {
			if (file.contentType.startsWith("text/")) {
				const contents = yield* Effect.try({
					try: () => decodeExecutableText(file.bytes),
					catch: () =>
						failure(
							file.path,
							"RYOT_CLIENT_UTF8",
							`Emitted text file "${file.path}" is not valid UTF-8`,
						),
				});
				const issue = yield* Effect.try({
					catch: () =>
						failure(
							file.path,
							"RYOT_CLIENT_ARTIFACT_FILE",
							`Emitted file "${file.path}" could not be parsed`,
						),
					try: () =>
						outputReferenceIssue(
							file.path,
							contents,
							file.contentType,
							names,
							trustedModules,
							pluginDependencies,
						),
				});
				if (issue) {
					return yield* failure("client", "RYOT_CLIENT_ARTIFACT_FILE", issue);
				}
			}
		}

		const files = bundled.files.map(({ path, bytes, contentType }) =>
			clientArtifactFile({ path, bytes, contentType }),
		);
		const artifactBytes = files.reduce((total, file) => total + file.contents.byteLength, 0);
		if (artifactBytes > CLIENT_PLUGIN_COMPILER_LIMITS.artifactBytes) {
			return yield* failure(
				"client",
				"RYOT_CLIENT_ARTIFACT_SIZE",
				`Compiled client module exceeds ${CLIENT_PLUGIN_COMPILER_LIMITS.artifactBytes} bytes`,
			);
		}
		const metadata = clientArtifactMetadata(input.name, files);
		return { artifact: { ...metadata, files: sortBy(files, ({ name }) => name) } };
	}).pipe(Effect.scoped);
