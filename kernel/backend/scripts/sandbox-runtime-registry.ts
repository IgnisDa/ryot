import { SANDBOX_RUNTIME_REGISTRY } from "@ryot-app/sandbox-sdk/runtime-registry";
import { Data, Effect, FileSystem, Schema } from "effect";

export class SandboxRuntimeBuildError extends Data.TaggedError("SandboxRuntimeBuildError")<{
	readonly message: string;
}> {}

export const SANDBOX_DENO_VERSION = "2.8.1";

const PackageManifest = Schema.fromJsonString(
	Schema.Struct({ name: Schema.String, version: Schema.optional(Schema.String) }),
);

type RegistryEntry = (typeof SANDBOX_RUNTIME_REGISTRY)[number];

export type ResolvedSandboxRuntimeDependency = {
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

export const resolveViteVersion = (resolveFrom: string) =>
	Effect.gen(function* () {
		const viteCompilerEntry = yield* Effect.try({
			try: () => Bun.resolveSync("@ryot-app/vite-compiler", resolveFrom),
			catch: (cause) =>
				new SandboxRuntimeBuildError({
					message: `Could not resolve Vite compiler toolchain: ${String(cause)}`,
				}),
		});
		const vitePackage = yield* resolvePackageManifest("vite", viteCompilerEntry);
		return vitePackage.manifest.version ?? "unknown";
	});
