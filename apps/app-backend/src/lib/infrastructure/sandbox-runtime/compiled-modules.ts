import { sha256Hex } from "@ryot/ts-utils/crypto";
import { Data, Effect, FileSystem, Path, PlatformError } from "effect";

import type { SandboxRuntimePaths } from "./dependencies";

export class SandboxCompiledModuleMaterializationError extends Data.TaggedError(
	"SandboxCompiledModuleMaterializationError",
)<{
	message: string;
}> {}

const hashBytes = sha256Hex;

const verifiedModulePaths = new Set<string>();
const compiledModuleName = /^([0-9a-f]{64})\.mjs$/;

const hasSystemErrorReason = (error: unknown, reason: "AlreadyExists" | "NotFound") =>
	error instanceof PlatformError.PlatformError &&
	error.reason instanceof PlatformError.SystemError &&
	error.reason._tag === reason;

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
			if (
				!verifiedModulePaths.has(modulePath) &&
				!(yield* moduleMatches(fs, modulePath, contentHash))
			) {
				return yield* new SandboxCompiledModuleMaterializationError({
					message: "Compiled module destination contains different bytes",
				});
			}
			yield* fs.chmod(modulePath, 0o444);
			verifiedModulePaths.add(modulePath);
			return modulePath;
		}
		verifiedModulePaths.delete(modulePath);

		return yield* Effect.acquireUseRelease(
			fs.makeTempDirectory({
				prefix: ".ryot-compiled-module-",
				directory: runtime.moduleDirectory,
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
					yield* fs.link(temporaryPath, modulePath).pipe(
						Effect.catchIf(
							(error) => hasSystemErrorReason(error, "AlreadyExists"),
							() =>
								moduleMatches(fs, modulePath, contentHash).pipe(
									Effect.flatMap((matches) =>
										matches
											? Effect.void
											: new SandboxCompiledModuleMaterializationError({
													message: "Compiled module destination contains different bytes",
												}),
									),
								),
						),
					);
					yield* fs.chmod(modulePath, 0o444);
					verifiedModulePaths.add(modulePath);
					return modulePath;
				}),
			(temporaryDirectory) =>
				fs.remove(temporaryDirectory, { force: true, recursive: true }).pipe(Effect.ignore),
		);
	});

export const acquireSandboxCompiledModule = (
	runtime: Pick<SandboxRuntimePaths, "moduleDirectory">,
	contentHash: string,
	javascript: string,
) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		const temporaryDirectory = yield* fs.makeTempDirectoryScoped({
			directory: runtime.moduleDirectory,
			prefix: ".ryot-compiled-module-execution-",
		});
		const executionPath = path.join(temporaryDirectory, `${contentHash}.mjs`);
		const materializeAndLink = materializeSandboxCompiledModule(
			runtime,
			contentHash,
			javascript,
		).pipe(Effect.flatMap((modulePath) => fs.link(modulePath, executionPath)));

		yield* materializeAndLink.pipe(
			Effect.catchIf(
				(error) => hasSystemErrorReason(error, "NotFound"),
				() => materializeAndLink,
			),
		);
		return executionPath;
	});

export const garbageCollectSandboxCompiledModules = (
	runtime: Pick<SandboxRuntimePaths, "moduleDirectory">,
	liveContentHashes: ReadonlySet<string>,
) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		const entries = yield* fs.readDirectory(runtime.moduleDirectory);
		const candidates = entries.flatMap((entry) => {
			const match = compiledModuleName.exec(entry);
			return match?.[1] && !liveContentHashes.has(match[1]) ? [entry] : [];
		});

		const removals = yield* Effect.forEach(candidates, (entry) =>
			fs.remove(path.join(runtime.moduleDirectory, entry), { force: false }).pipe(
				Effect.as(1),
				Effect.catchIf(
					(error) => hasSystemErrorReason(error, "NotFound"),
					() => Effect.succeed(0),
				),
			),
		);
		return {
			candidateCount: candidates.length,
			removedCount: removals.reduce((total, removed) => total + removed, 0),
		};
	});
