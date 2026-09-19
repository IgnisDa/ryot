import { canonicalFileSetHash, sha256Hex } from "@ryot-app/ts-utils/crypto";
import { buildDenoEsm } from "@ryot-app/vite-compiler";
import { Effect, Schema } from "effect";

import {
	SANDBOX_DENO_VERSION,
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
		const effectSpecifiers = new Set([effectDependency.sdkImport, ...effectDependency.aliases]);
		const moduleFiles = yield* Effect.forEach(dependencies, (dependency) =>
			buildDenoEsm({
				entry: dependency.entrypoint,
				outputFile: dependency.runtimeFile,
				approvedExternalSpecifiers:
					dependency.name === "effect" ? new Set<string>() : effectSpecifiers,
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
		// oxlint-disable perfectionist/sort-objects -- Metadata key order determines the payload bytes.
		const metadataWithoutFiles = {
			denoVersion: SANDBOX_DENO_VERSION,
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
		// oxlint-enable perfectionist/sort-objects
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
