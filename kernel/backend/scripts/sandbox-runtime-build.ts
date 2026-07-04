import { SANDBOX_RUNTIME_REGISTRY } from "@ryot-app/sandbox-sdk/runtime-registry";
import { createSha256Hasher, sha256Hex } from "@ryot-app/ts-utils/crypto";
import {
	acquireCompilerWorkspace,
	buildWithVite,
	stageGeneratedFiles,
	stageSourceFiles,
} from "@ryot-app/vite-compiler";
import type { CollectedViteFile, WorkspaceFile } from "@ryot-app/vite-compiler";
import { Data, Effect, FileSystem, Schema } from "effect";

import type {
	SandboxRuntimePayload,
	SandboxRuntimePayloadMetadata,
} from "../src/lib/infrastructure/sandbox-runtime/payload";
import { SANDBOX_RUNTIME_PAYLOAD_FORMAT } from "../src/lib/infrastructure/sandbox-runtime/payload";

export class SandboxRuntimeBuildError extends Data.TaggedError("SandboxRuntimeBuildError")<{
	readonly message: string;
}> {}

export const SANDBOX_DENO_VERSION = "2.8.1";

const typeScriptProject = {
	compilerOptions: {
		target: "ES2022",
		module: "ESNext",
		verbatimModuleSyntax: true,
		moduleResolution: "bundler",
	},
};

const PackageManifest = Schema.fromJsonString(
	Schema.Struct({ name: Schema.String, version: Schema.optional(Schema.String) }),
);

type RegistryEntry = (typeof SANDBOX_RUNTIME_REGISTRY)[number];

type ResolvedSandboxRuntimeDependency = {
	readonly version: string;
	readonly entrypoint: string;
	readonly runtimeFile: string;
	readonly packageEntrypoint: string;
	readonly aliases: readonly string[];
	readonly name: RegistryEntry["name"];
	readonly sdkImport: RegistryEntry["sdkImport"];
	readonly packageName: RegistryEntry["packageName"];
	readonly buildAliases: readonly {
		readonly replacement: string;
		readonly find: string | RegExp;
	}[];
};

const resolvePackageManifest = (packageName: string, resolveFrom: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const manifestPath = yield* Effect.try({
			try: () => Bun.resolveSync(`${packageName}/package.json`, resolveFrom),
			catch: (cause) =>
				new SandboxRuntimeBuildError({
					message: `Could not resolve ${packageName} package manifest: ${String(cause)}`,
				}),
		});
		const manifest = yield* Schema.decodeUnknownEffect(PackageManifest)(
			yield* fs.readFileString(manifestPath),
		).pipe(
			Effect.mapError(
				(cause) =>
					new SandboxRuntimeBuildError({
						message: `Could not read ${packageName} package manifest: ${String(cause)}`,
					}),
			),
		);
		return { manifest, manifestPath };
	});

export const resolveSandboxRuntimeRegistry = (resolveFrom: string) =>
	Effect.gen(function* () {
		const sandboxSdk = yield* resolvePackageManifest("@ryot-app/sandbox-sdk", resolveFrom);
		const sdkDirectory = sandboxSdk.manifestPath.slice(0, sandboxSdk.manifestPath.lastIndexOf("/"));
		return yield* Effect.forEach(SANDBOX_RUNTIME_REGISTRY, (entry) =>
			Effect.gen(function* () {
				const dependencyPackage = yield* resolvePackageManifest(entry.packageName, sdkDirectory);
				const version = dependencyPackage.manifest.version ?? "workspace";
				const entrypoint = yield* Effect.try({
					try: () => Bun.resolveSync(entry.sdkImport, resolveFrom),
					catch: (cause) =>
						new SandboxRuntimeBuildError({
							message: `Could not resolve trusted entry ${entry.sdkImport}: ${String(cause)}`,
						}),
				});
				const packageEntrypoint = yield* Effect.try({
					try: () => Bun.resolveSync(entry.packageName, sdkDirectory),
					catch: (cause) =>
						new SandboxRuntimeBuildError({
							message: `Could not resolve trusted package ${entry.packageName}: ${String(cause)}`,
						}),
				});
				const packageDirectory = dependencyPackage.manifestPath.slice(
					0,
					dependencyPackage.manifestPath.lastIndexOf("/"),
				);
				const buildAliases =
					"sourceAliases" in entry
						? entry.sourceAliases.map(({ specifier, entryRelativePath }) => ({
								find: specifier,
								replacement: `${packageDirectory}/${entryRelativePath}`,
							}))
						: [];
				return {
					version,
					entrypoint,
					buildAliases,
					name: entry.name,
					packageEntrypoint,
					aliases: entry.aliases,
					sdkImport: entry.sdkImport,
					packageName: entry.packageName,
					runtimeFile: `${entry.name}-${version}.mjs`,
				} satisfies ResolvedSandboxRuntimeDependency;
			}),
		);
	});

const importPattern = /^\s*(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gm;
const dynamicImportPattern = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
const forbiddenRuntimePattern =
	/\b(?:require|__require)\s*\(|__vite(?:_|-)?browser(?:_|-)?external|vite:preloadError|document\.getElementsByTagName/;
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const encodeJsonString = Schema.encodeSync(Schema.fromJsonString(Schema.String));

export const auditDenoEsmOutput = (
	javascript: string,
	approvedExternalSpecifiers: ReadonlySet<string>,
) =>
	Effect.gen(function* () {
		const executableJavascript = javascript
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/^\s*\/\/.*$/gm, "");
		const forbidden = forbiddenRuntimePattern.exec(executableJavascript);
		if (forbidden) {
			return yield* new SandboxRuntimeBuildError({
				message: `Deno ESM output contains a CommonJS or browser-external runtime helper: ${forbidden[0]}`,
			});
		}
		importPattern.lastIndex = 0;
		for (const pattern of [importPattern, dynamicImportPattern]) {
			pattern.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = pattern.exec(executableJavascript)) !== null) {
				const specifier = match[1];
				if (!specifier) {
					continue;
				}
				if (/^(?:node:|bun:|https?:|npm:|jsr:)/.test(specifier)) {
					return yield* new SandboxRuntimeBuildError({
						message: `Deno ESM output contains forbidden runtime import: ${specifier}`,
					});
				}
				if (!specifier.startsWith(".") && !approvedExternalSpecifiers.has(specifier)) {
					return yield* new SandboxRuntimeBuildError({
						message: `Deno ESM output contains unknown external import: ${specifier}`,
					});
				}
			}
		}
		return undefined;
	});

const denoViteConfig = (
	entrypoint: string,
	outputFile: string,
	externalSpecifiers: ReadonlySet<string>,
	aliases: readonly { readonly find: string | RegExp; readonly replacement: string }[] = [],
) => ({
	resolve: {
		alias: aliases,
		mainFields: ["browser", "module", "jsnext:main", "jsnext", "main"],
		conditions: ["deno", "worker", "browser", "import", "module", "default"],
	},
	build: {
		minify: false,
		target: "es2022",
		cssCodeSplit: false,
		modulePreload: false,
		sourcemap: "inline" as const,
		lib: { entry: entrypoint, formats: ["es" as const], fileName: () => outputFile },
		rolldownOptions: {
			preserveEntrySignatures: "strict" as const,
			external: (specifier: string) => externalSpecifiers.has(specifier),
			output: { codeSplitting: false, format: "es" as const, entryFileNames: outputFile },
		},
	},
});

const exactJavascriptOutput = (files: readonly CollectedViteFile[], expectedFile: string) =>
	files.length === 1 && files[0]?.path === expectedFile
		? Effect.succeed(new TextDecoder().decode(files[0].bytes))
		: Effect.fail(
				new SandboxRuntimeBuildError({ message: `Vite did not emit exactly ${expectedFile}` }),
			);

export const buildDenoEsmModule = ({
	sources,
	entrypoint,
	outputFile,
	aliases = [],
	externalSpecifiers,
}: {
	readonly entrypoint: string;
	readonly externalSpecifiers: ReadonlySet<string>;
	readonly outputFile: string;
	readonly sources?: readonly WorkspaceFile[];
	readonly aliases?: readonly { readonly find: string | RegExp; readonly replacement: string }[];
}) =>
	Effect.scoped(
		Effect.gen(function* () {
			const workspace = yield* acquireCompilerWorkspace();
			let input = entrypoint;
			if (sources) {
				yield* stageSourceFiles(workspace, sources);
				input = `${workspace.sourcePath}/${entrypoint}`;
			} else {
				yield* stageGeneratedFiles(workspace, [
					{ path: "entry.ts", contents: `export * from ${encodeJsonString(entrypoint)};\n` },
				]);
				input = `${workspace.generatedPath}/entry.ts`;
			}
			const result = yield* buildWithVite({
				workspace,
				typeScriptProject,
				config: denoViteConfig(input, outputFile, externalSpecifiers, aliases),
			}).pipe(
				Effect.mapError(
					(cause) =>
						new SandboxRuntimeBuildError({ message: `Vite build failed: ${cause.message}` }),
				),
			);
			const javascript = yield* exactJavascriptOutput(result.files, outputFile);
			yield* auditDenoEsmOutput(javascript, externalSpecifiers);
			return javascript;
		}),
	);

const canonicalPayloadHash = (
	files: readonly { readonly path: string; readonly contents: string }[],
) => {
	const hasher = createSha256Hasher();
	for (const { path, contents } of files
		.slice()
		.sort(({ path: left }, { path: right }) => left.localeCompare(right))) {
		const bytes = new TextEncoder().encode(contents);
		hasher.update(`${path.length}:${path}:${bytes.byteLength}:`);
		hasher.update(bytes);
	}
	return hasher.digest("hex");
};

export const buildSandboxRuntimePayload = (resolveFrom: string) =>
	Effect.gen(function* () {
		const dependencies = yield* resolveSandboxRuntimeRegistry(resolveFrom);
		const effectDependency = dependencies.find(({ name }) => name === "effect");
		if (!effectDependency) {
			return yield* new SandboxRuntimeBuildError({
				message: "Runtime registry has no Effect entry",
			});
		}
		const effectSpecifiers = new Set([effectDependency.sdkImport, ...effectDependency.aliases]);
		const moduleFiles = yield* Effect.forEach(dependencies, (dependency) =>
			buildDenoEsmModule({
				entrypoint: dependency.entrypoint,
				outputFile: dependency.runtimeFile,
				externalSpecifiers: dependency.name === "effect" ? new Set() : effectSpecifiers,
				aliases:
					dependency.name === "effect"
						? [
								{ find: /^effect$/, replacement: dependency.packageEntrypoint },
								{
									find: /^effect\/(.+)$/,
									replacement: `${dependency.packageEntrypoint.slice(0, dependency.packageEntrypoint.lastIndexOf("/"))}/$1.js`,
								},
							]
						: dependency.buildAliases,
			}).pipe(
				Effect.map((contents) => ({ contents, path: dependency.runtimeFile })),
				Effect.mapError(
					(error) =>
						new SandboxRuntimeBuildError({
							message: `${dependency.name} runtime build failed: ${error.message}`,
						}),
				),
			),
		);
		const imports = Object.fromEntries(
			dependencies.flatMap(({ aliases, sdkImport, runtimeFile }) =>
				[sdkImport, ...aliases].map((specifier) => [specifier, `./${runtimeFile}`]),
			),
		);
		const importMapFile = { path: "import-map.json", contents: `${encodeJson({ imports })}\n` };
		const viteCompilerEntry = yield* Effect.try({
			try: () => Bun.resolveSync("@ryot-app/vite-compiler", resolveFrom),
			catch: (cause) =>
				new SandboxRuntimeBuildError({
					message: `Could not resolve Vite compiler toolchain: ${String(cause)}`,
				}),
		});
		const vitePackage = yield* resolvePackageManifest("vite", viteCompilerEntry);
		const metadataWithoutFiles = {
			denoVersion: SANDBOX_DENO_VERSION,
			format: SANDBOX_RUNTIME_PAYLOAD_FORMAT,
			viteVersion: vitePackage.manifest.version ?? "unknown",
			dependencies: dependencies.map((dependency) => ({
				name: dependency.name,
				aliases: dependency.aliases,
				version: dependency.version,
				sdkImport: dependency.sdkImport,
				packageName: dependency.packageName,
				runtimeFile: dependency.runtimeFile,
			})),
		};
		const contentFiles = [importMapFile, ...moduleFiles];
		const metadata: SandboxRuntimePayloadMetadata = {
			...metadataWithoutFiles,
			files: contentFiles.map(({ path, contents }) => {
				const bytes = new TextEncoder().encode(contents);
				return { path, sha256: sha256Hex(bytes), byteLength: bytes.byteLength };
			}),
		};
		const files = [
			...contentFiles,
			{ path: "runtime-metadata.json", contents: `${encodeJson(metadata)}\n` },
		].sort(({ path: left }, { path: right }) => left.localeCompare(right));
		return {
			files,
			metadata,
			contentHash: canonicalPayloadHash(files),
		} satisfies SandboxRuntimePayload;
	});
