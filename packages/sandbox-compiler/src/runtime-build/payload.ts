import { canonicalFileSetHash, sha256Hex } from "@ryot-app/ts-utils/crypto";
import { buildSandboxEsm } from "@ryot-app/vite-compiler";
import { Effect, Schema } from "effect";

import {
	SandboxRuntimeBuildError,
	resolveSandboxRuntimeRegistry,
	resolveViteVersion,
} from "./registry";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export const buildSandboxRuntimePayload = (resolveFrom: string) =>
	Effect.gen(function* () {
		const dependencies = yield* resolveSandboxRuntimeRegistry(resolveFrom);
		const effectDependency = dependencies.find(({ name }) => name === "effect");
		if (!effectDependency) {
			return yield* new SandboxRuntimeBuildError({
				message: "Runtime registry has no Effect entry",
			});
		}
		const filesystemDependency = dependencies.find(({ name }) => name === "filesystem");
		if (!filesystemDependency) {
			return yield* new SandboxRuntimeBuildError({
				message: "Runtime registry has no filesystem entry",
			});
		}
		const dependencyRuntime = dependencies.find(({ name }) => name === "dependency-runtime");
		if (!dependencyRuntime) {
			return yield* new SandboxRuntimeBuildError({
				message: "Runtime registry has no dependency-runtime entry",
			});
		}
		const effectExternalSpecifiers = new Set([
			effectDependency.sdkImport,
			...effectDependency.aliases,
		]);
		const sharedExternalSpecifiers = new Set([
			...effectExternalSpecifiers,
			dependencyRuntime.sdkImport,
			...dependencyRuntime.aliases,
			filesystemDependency.sdkImport,
			...filesystemDependency.aliases,
		]);
		const runtimeExternalSpecifiers = (name: string): ReadonlySet<string> => {
			if (name === "effect" || name === "dependency-runtime") {
				return new Set<string>();
			}
			if (name === "filesystem") {
				return effectExternalSpecifiers;
			}
			return sharedExternalSpecifiers;
		};
		const moduleFiles = yield* Effect.forEach(dependencies, (dependency) =>
			buildSandboxEsm({
				// Dependency frames are hidden; loading their maps on first Error.stack stalls every process.
				sourceMap: false,
				entry: dependency.entrypoint,
				outputFile: dependency.runtimeFile,
				approvedExternalSpecifiers: runtimeExternalSpecifiers(dependency.name),
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
				Effect.map(({ javascript: contents }) => ({ contents, path: dependency.runtimeFile })),
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
		const metadataWithoutFiles = {
			format: 1 as const,
			viteVersion: yield* resolveViteVersion(resolveFrom),
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
		const metadata = {
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
		return { files, metadata, contentHash: canonicalFileSetHash(files) };
	});
