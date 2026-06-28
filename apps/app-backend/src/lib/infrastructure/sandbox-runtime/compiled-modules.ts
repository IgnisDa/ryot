import { FileSystem, Path } from "@effect/platform";
import { Data, Effect } from "effect";

import type { SandboxRuntimePaths } from "./dependencies";

export class SandboxCompiledModuleMaterializationError extends Data.TaggedError(
	"SandboxCompiledModuleMaterializationError",
)<{
	message: string;
}> {}

const hashBytes = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

const moduleMatches = (fs: FileSystem.FileSystem, modulePath: string, contentHash: string) =>
	fs.readFile(modulePath).pipe(
		Effect.map((bytes) => hashBytes(bytes) === contentHash),
		Effect.orElseSucceed(() => false),
	);

export const materializeSandboxCompiledModule = (
	runtime: Pick<SandboxRuntimePaths, "moduleDirectory">,
	contentHash: string,
	javascript: string,
) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		const bytes = new TextEncoder().encode(javascript);
		if (hashBytes(bytes) !== contentHash) {
			return yield* new SandboxCompiledModuleMaterializationError({
				message: "Compiled module bytes do not match supplied content hash",
			});
		}

		const modulePath = path.join(runtime.moduleDirectory, `${contentHash}.mjs`);
		if (yield* fs.exists(modulePath)) {
			if (!(yield* moduleMatches(fs, modulePath, contentHash))) {
				return yield* new SandboxCompiledModuleMaterializationError({
					message: "Compiled module destination contains different bytes",
				});
			}
			yield* fs.chmod(modulePath, 0o444);
			return modulePath;
		}

		return yield* Effect.acquireUseRelease(
			fs.makeTempDirectory({
				directory: runtime.moduleDirectory,
				prefix: ".ryot-compiled-module-",
			}),
			(temporaryDirectory) =>
				Effect.gen(function* () {
					const temporaryPath = path.join(temporaryDirectory, "module.mjs");
					yield* fs.writeFile(temporaryPath, bytes);
					if (!(yield* moduleMatches(fs, temporaryPath, contentHash))) {
						return yield* new SandboxCompiledModuleMaterializationError({
							message: "Compiled module temporary file failed verification",
						});
					}
					yield* fs.chmod(temporaryPath, 0o444);
					const published = yield* fs.link(temporaryPath, modulePath).pipe(
						Effect.as(true),
						Effect.orElseSucceed(() => false),
					);
					if (!published && !(yield* moduleMatches(fs, modulePath, contentHash))) {
						return yield* new SandboxCompiledModuleMaterializationError({
							message: "Compiled module destination contains different bytes",
						});
					}
					yield* fs.chmod(modulePath, 0o444);
					return modulePath;
				}),
			(temporaryDirectory) =>
				fs.remove(temporaryDirectory, { force: true, recursive: true }).pipe(Effect.ignore),
		);
	});
