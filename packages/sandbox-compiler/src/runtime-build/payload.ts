import { canonicalFileSetHash, sha256Hex } from "@ryot-app/ts-utils/crypto";
import { buildSandboxEsm } from "@ryot-app/vite-compiler";
import { Effect, Schema } from "effect";

import {
	type ResolvedSandboxRuntimeDependency,
	SandboxRuntimeBuildError,
	resolveSandboxRuntimeRegistry,
	resolveViteVersion,
} from "./registry";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export const buildSandboxRuntimePayload = (resolveFrom: string) =>
	Effect.gen(function* () {
		const dependencies = yield* resolveSandboxRuntimeRegistry(resolveFrom);
		const specifiers = new Map(
			dependencies.map(({ name, aliases, sdkImport }) => [name, [sdkImport, ...aliases]]),
		);
		const runtimeExternalSpecifiers = (
			names: ResolvedSandboxRuntimeDependency["runtimeExternals"],
		) =>
			Effect.forEach(names, (name) => {
				const external = specifiers.get(name);
				return external === undefined
					? Effect.fail(
							new SandboxRuntimeBuildError({ message: `Runtime registry has no ${name} entry` }),
						)
					: Effect.succeed(external);
			}).pipe(Effect.map((externals) => new Set(externals.flat())));
		const moduleFiles = yield* Effect.forEach(dependencies, (dependency) =>
			Effect.flatMap(runtimeExternalSpecifiers(dependency.runtimeExternals), (externals) =>
				buildSandboxEsm({
					// Dependency frames are hidden; loading their maps on first Error.stack stalls every process.
					sourceMap: false,
					entry: dependency.entrypoint,
					aliases: dependency.buildAliases,
					outputFile: dependency.runtimeFile,
					approvedExternalSpecifiers: externals,
				}),
			).pipe(
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
