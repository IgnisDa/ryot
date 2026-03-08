import type { SandboxExecutionGrants } from "@ryot/contract/modules/sandbox/schemas";
import { sha256Base64Url, sha256Hex } from "@ryot/ts-utils/crypto";
import { Context, Data, Effect, FileSystem, Layer, Path, PlatformError, Semaphore } from "effect";

import { AppConfig } from "../config/service";
import { sandboxGrantPathError } from "./filesystem-grants";

const artifactHandlePattern = /^[A-Za-z0-9_-]+$/;
const SANDBOX_ARTIFACT_DIRECTORY = "ryot-sandbox-artifacts";

const hasSystemErrorReason = (error: unknown, reason: "NotFound") =>
	error instanceof PlatformError.PlatformError &&
	error.reason instanceof PlatformError.SystemError &&
	error.reason._tag === reason;

export class SandboxArtifactNotFoundError extends Data.TaggedError("SandboxArtifactNotFoundError")<{
	handle: string;
	message: string;
}> {}

const materializeBytes = Effect.fn("sandbox.materializeArtifactBytes")(function* (
	bytes: Uint8Array,
	target: string,
) {
	const fs = yield* FileSystem.FileSystem;
	if (yield* fs.exists(target)) {
		const existing = yield* fs.readFile(target);
		if (sha256Hex(existing) !== sha256Hex(bytes)) {
			return yield* Effect.fail("Sandbox artifact destination contains different bytes");
		}
		yield* fs.chmod(target, 0o444);
		return;
	}

	const path = yield* Path.Path;
	const temporaryDirectory = yield* fs.makeTempDirectory({
		prefix: ".ryot-sandbox-artifact-",
		directory: path.dirname(target),
	});
	const temporaryPath = path.join(temporaryDirectory, "artifact");
	yield* fs.writeFile(temporaryPath, bytes);
	yield* fs.chmod(temporaryPath, 0o444);
	yield* fs.link(temporaryPath, target).pipe(
		Effect.catch(() =>
			fs.readFile(target).pipe(
				Effect.filterOrFail(
					(existing) => sha256Hex(existing) === sha256Hex(bytes),
					() => "Sandbox artifact destination contains different bytes",
				),
			),
		),
	);
	yield* fs.remove(temporaryDirectory, { force: true, recursive: true });
});

export class SandboxArtifactStore extends Context.Service<SandboxArtifactStore>()(
	"SandboxArtifactStore",
	{
		make: Effect.gen(function* () {
			const path = yield* Path.Path;
			const config = yield* AppConfig;
			const fs = yield* FileSystem.FileSystem;
			const lifecycleLock = yield* Semaphore.make(1);
			const localTempRoot = yield* fs.realPath(config.fileStorage.localTempDir).pipe(Effect.orDie);
			const root = path.join(localTempRoot, SANDBOX_ARTIFACT_DIRECTORY);
			yield* fs.makeDirectory(root, { recursive: true }).pipe(Effect.orDie);

			const ownerDirectory = (ownerExecutionId: string) =>
				path.join(root, sha256Hex(ownerExecutionId));
			const outputDirectory = (ownerExecutionId: string) =>
				path.join(ownerDirectory(ownerExecutionId), "outputs");
			const referenceDirectory = (ownerExecutionId: string, referenceExecutionId: string) =>
				path.join(ownerDirectory(ownerExecutionId), "references", sha256Hex(referenceExecutionId));

			const retain = Effect.fn("SandboxArtifactStore.retain")(
				(ownerExecutionId: string, referenceExecutionId: string) =>
					lifecycleLock.withPermits(1)(
						fs.makeDirectory(referenceDirectory(ownerExecutionId, referenceExecutionId), {
							recursive: true,
						}),
					),
			);

			const release = Effect.fn("SandboxArtifactStore.release")(
				(ownerExecutionId: string, referenceExecutionId: string) =>
					lifecycleLock.withPermits(1)(
						Effect.gen(function* () {
							const owner = ownerDirectory(ownerExecutionId);
							const references = path.join(owner, "references");
							yield* fs
								.remove(referenceDirectory(ownerExecutionId, referenceExecutionId), {
									force: true,
									recursive: true,
								})
								.pipe(
									Effect.catchIf(
										(error) => hasSystemErrorReason(error, "NotFound"),
										() => Effect.void,
									),
								);
							const remaining = yield* fs.readDirectory(references).pipe(
								Effect.catchIf(
									(error) => hasSystemErrorReason(error, "NotFound"),
									() => Effect.succeed([]),
								),
							);
							if (remaining.length === 0) {
								yield* fs.remove(owner, { force: true, recursive: true }).pipe(
									Effect.catchIf(
										(error) => hasSystemErrorReason(error, "NotFound"),
										() => Effect.void,
									),
								);
							}
						}),
					),
			);

			const materializeInput = Effect.fn("SandboxArtifactStore.materializeInput")(function* (
				ownerExecutionId: string,
				source: string,
			) {
				const pathError = sandboxGrantPathError(
					path,
					"Sandbox artifact source path",
					source,
					localTempRoot,
				);
				if (pathError) {
					return yield* Effect.fail(pathError);
				}
				const canonicalSource = yield* fs.realPath(source);
				const canonicalPathError = sandboxGrantPathError(
					path,
					"Sandbox artifact source path",
					canonicalSource,
					localTempRoot,
				);
				if (canonicalPathError) {
					return yield* Effect.fail(canonicalPathError);
				}
				if (canonicalSource !== source) {
					return yield* Effect.fail(
						`Sandbox artifact source "${source}" must not be a symbolic link`,
					);
				}
				const info = yield* fs.stat(canonicalSource);
				if (info.type !== "File") {
					return yield* Effect.fail(`Sandbox artifact source "${source}" must be a regular file`);
				}
				const bytes = yield* fs.readFile(canonicalSource);
				const contentHash = sha256Hex(bytes);
				const directory = path.join(ownerDirectory(ownerExecutionId), "inputs");
				yield* fs.makeDirectory(directory, { recursive: true });
				const target = path.join(directory, contentHash);
				yield* materializeBytes(bytes, target);
				return target;
			});

			const materializeInputs = Effect.fn("SandboxArtifactStore.materializeInputs")(function* (
				ownerExecutionId: string,
				referenceExecutionId: string,
				grants: SandboxExecutionGrants,
			) {
				yield* retain(ownerExecutionId, referenceExecutionId);
				const artifactPath = grants.artifactPath
					? yield* materializeInput(ownerExecutionId, grants.artifactPath)
					: undefined;
				const namedArtifactPaths: Record<string, string> = {};
				for (const [key, source] of Object.entries(grants.namedArtifactPaths ?? {})) {
					namedArtifactPaths[key] = yield* materializeInput(ownerExecutionId, source);
				}
				return {
					artifactOwnerExecutionId: ownerExecutionId,
					...(artifactPath ? { artifactPath } : {}),
					...(Object.keys(namedArtifactPaths).length > 0 ? { namedArtifactPaths } : {}),
				} satisfies SandboxExecutionGrants;
			});

			const materializeOutputs = Effect.fn("SandboxArtifactStore.materializeOutputs")(function* (
				ownerExecutionId: string,
				sources: ReadonlyArray<string>,
			) {
				if (sources.length === 0) {
					return [];
				}
				const directory = outputDirectory(ownerExecutionId);
				yield* fs.makeDirectory(directory, { recursive: true });
				return yield* Effect.forEach(sources, (source) =>
					Effect.gen(function* () {
						const bytes = yield* fs.readFile(source);
						const contentHash = sha256Hex(bytes);
						const handle = sha256Base64Url(`${ownerExecutionId}\0${contentHash}`);
						yield* materializeBytes(bytes, path.join(directory, handle));
						return handle;
					}),
				);
			});

			const resolveOutputs = Effect.fn("SandboxArtifactStore.resolveOutputs")(function* (
				ownerExecutionId: string,
				handles: ReadonlyArray<string>,
			) {
				const directory = outputDirectory(ownerExecutionId);
				return yield* Effect.forEach(handles, (handle) =>
					Effect.gen(function* () {
						if (!artifactHandlePattern.test(handle)) {
							return yield* new SandboxArtifactNotFoundError({
								handle,
								message: `Sandbox artifact handle '${handle}' was not found`,
							});
						}
						const target = path.join(directory, handle);
						if (!(yield* fs.exists(target))) {
							return yield* new SandboxArtifactNotFoundError({
								handle,
								message: `Sandbox artifact handle '${handle}' was not found`,
							});
						}
						return target;
					}),
				);
			});

			return {
				retain,
				release,
				resolveOutputs,
				materializeInputs,
				materializeOutputs,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
