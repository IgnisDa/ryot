// Effect FileSystem.open has no O_NOFOLLOW flags for pinned descriptor operations.
// TODO: Use FileSystem.open once https://github.com/Effect-TS/effect/issues/8898 is resolved.
// oxlint-disable-next-line effecttsgo/node-builtin-import
import { constants } from "node:fs";
// oxlint-disable-next-line effecttsgo/node-builtin-import
import { open as openDescriptor } from "node:fs/promises";

import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import { POLICY_SAFE_SANDBOX_CAPABILITIES } from "@ryot-app/contract/modules/sandbox/wire";
import type { SandboxHostError } from "@ryot-app/sandbox-sdk/wire";
import type { Scope } from "effect";
import { Context, Effect, Exit, FileSystem, Layer, Option, Path, Schema, Semaphore } from "effect";

import { AppConfig } from "../config/service";
import { ServerRun } from "../server-run";
import { SandboxArtifactStaging } from "./artifact-staging";
import { SandboxArtifactStore } from "./artifacts";
import {
	decodeSandboxScratchManifest,
	declaresSandboxFilesystemGrant,
	measureSandboxScratchBytes,
	SANDBOX_HARVEST_DIRECTORY_PREFIX,
	sandboxArtifactGrant,
	sandboxGrantPathError,
	sanitizeSandboxExecutionSegment,
} from "./filesystem-grants";
import { SANDBOX_LIMITS } from "./limits";
import { toSandboxHostError, type SandboxRunInput } from "./shared";
import {
	artifactReadRangeArgsSchema,
	scratchWriteArgsSchema,
	type artifactReadRangeResultSchema,
	type SandboxInvocation,
} from "./sidecar-protocol";

const strictOptions = { onExcessProperty: "error" } as const;
const maxScratchChunkBytes = 256 * 1024;
const scratchDirectoryPrefix = "ryot-sandbox-scratch-";
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const decodeArtifactReadRangeArgs = Schema.decodeUnknownEffect(
	artifactReadRangeArgsSchema,
	strictOptions,
);
const decodeScratchWriteArgs = Schema.decodeUnknownEffect(scratchWriteArgsSchema, strictOptions);
const missingArtifactGrant = (operation: string): SandboxHostError => ({
	message: "Sandbox artifact grant is unavailable",
	data: { operation, code: "missing-artifact-grant" },
});
const failedHostRequest = (message: string): SandboxHostError => ({ message });
const sandboxFailure = (
	error: unknown,
	kind: "infrastructure" | "invalid-input" | "script-failure",
) =>
	error instanceof SandboxRunError
		? error
		: new SandboxRunError({ kind, message: unknownToMessage(error) });
const hostFailure = (error: unknown): SandboxHostError => toSandboxHostError(error);

type PathSnapshot = {
	readonly path: string;
	readonly dev: number;
	readonly ino: number;
	readonly type: string;
};

type PinnedFile = {
	readonly handle: Awaited<ReturnType<typeof openDescriptor>>;
	readonly size: number;
};

type ScratchUpload = {
	readonly name: string;
	readonly temporaryPath: string;
	readonly targetPath: string;
	bytes: number;
	complete: boolean;
	started: boolean;
	valid: boolean;
};

const isPlainFileName = (name: string) =>
	name.length > 0 &&
	name !== "." &&
	name !== ".." &&
	!name.includes("/") &&
	!name.includes("\\") &&
	!name.includes("\0");

const decodedBase64Length = (data: string) => {
	let padding = 0;
	if (data.endsWith("==")) {
		padding = 2;
	} else if (data.endsWith("=")) {
		padding = 1;
	}
	return (data.length / 4) * 3 - padding;
};

const decodeBase64 = (data: string) => {
	const binary = atob(data);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
};

const encodeBase64 = (bytes: Uint8Array) => {
	let binary = "";
	for (let index = 0; index < bytes.length; index += 32_768) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 32_768));
	}
	return btoa(binary);
};

const samePathIdentity = (
	before: ReadonlyArray<PathSnapshot>,
	after: ReadonlyArray<PathSnapshot>,
) =>
	before.length === after.length &&
	before.every((entry, index) => {
		const next = after[index];
		return (
			next !== undefined &&
			entry.path === next.path &&
			entry.dev === next.dev &&
			entry.ino === next.ino &&
			entry.type === next.type
		);
	});

type SandboxFileAccess = {
	readonly filesystem: NonNullable<SandboxInvocation["filesystem"]>;
	readonly artifactReadRange: (
		args: typeof artifactReadRangeArgsSchema.Type,
	) => Effect.Effect<typeof artifactReadRangeResultSchema.Type, SandboxHostError>;
	readonly scratchWrite: (
		args: typeof scratchWriteArgsSchema.Type,
	) => Effect.Effect<null, SandboxHostError>;
	readonly harvest: (
		output: unknown,
	) => Effect.Effect<{ readonly chunkHandles: ReadonlyArray<string> } | null, SandboxRunError>;
};

type SandboxFileServiceApi = {
	readonly open: (
		input: SandboxRunInput,
	) => Effect.Effect<SandboxFileAccess, SandboxRunError, Scope.Scope>;
};

export class SandboxFileService extends Context.Service<SandboxFileService>()(
	"SandboxFileService",
	{
		make: Effect.gen(function* () {
			const path = yield* Path.Path;
			const config = yield* AppConfig;
			const serverRun = yield* ServerRun;
			const fs = yield* FileSystem.FileSystem;
			const artifacts = yield* SandboxArtifactStore;
			const staging = yield* Effect.serviceOption(SandboxArtifactStaging);
			const localTempRoot = yield* fs.realPath(config.fileStorage.localTempDir).pipe(Effect.orDie);

			const inspectPath = Effect.fnUntraced(function* (
				candidate: string,
				label: string,
				expectedType: "Directory" | "File",
			) {
				const pathError = sandboxGrantPathError(path, label, candidate, localTempRoot);
				if (pathError) {
					return yield* new SandboxRunError({ message: pathError, kind: "invalid-input" });
				}

				const ancestors: string[] = [];
				let current = candidate;
				let parent = path.dirname(current);
				while (parent !== current) {
					ancestors.unshift(current);
					current = parent;
					parent = path.dirname(current);
				}
				ancestors.unshift(current);

				const snapshots: PathSnapshot[] = [];
				for (const [index, ancestor] of ancestors.entries()) {
					const isSymbolicLink = yield* fs.readLink(ancestor).pipe(
						Effect.as(true),
						Effect.orElseSucceed(() => false),
					);
					if (isSymbolicLink) {
						return yield* new SandboxRunError({
							kind: "invalid-input",
							message: `${label} must not contain symbolic links`,
						});
					}

					const info = yield* fs
						.stat(ancestor)
						.pipe(
							Effect.mapError(
								(error) =>
									new SandboxRunError({ kind: "invalid-input", message: unknownToMessage(error) }),
							),
						);
					const final = index === ancestors.length - 1;
					if (final ? info.type !== expectedType : info.type !== "Directory") {
						return yield* new SandboxRunError({
							kind: "invalid-input",
							message: `${label} must resolve only through directories to a regular ${expectedType.toLowerCase()}`,
						});
					}
					const ino = Option.getOrNull(info.ino);
					if (ino === null) {
						return yield* new SandboxRunError({
							kind: "invalid-input",
							message: `${label} does not have a stable inode identity`,
						});
					}
					snapshots.push({ ino, dev: info.dev, path: ancestor, type: info.type });
				}
				return snapshots;
			});

			const acquirePinnedFile = Effect.fnUntraced(function* (
				candidate: string,
				label: string,
			): Effect.fn.Return<PinnedFile, SandboxRunError, Scope.Scope> {
				const before = yield* inspectPath(candidate, label, "File");
				const expected = before[before.length - 1];
				if (expected === undefined) {
					return yield* new SandboxRunError({
						kind: "invalid-input",
						message: `${label} is invalid`,
					});
				}
				const handle = yield* Effect.acquireRelease(
					Effect.tryPromise({
						try: () => openDescriptor(candidate, constants.O_RDONLY | constants.O_NOFOLLOW),
						catch: (error) =>
							new SandboxRunError({ kind: "invalid-input", message: unknownToMessage(error) }),
					}),
					(file) =>
						Effect.tryPromise({ catch: () => undefined, try: () => file.close() }).pipe(
							Effect.ignore,
						),
				);
				const descriptorInfo = yield* Effect.tryPromise({
					try: () => handle.stat(),
					catch: (error) =>
						new SandboxRunError({ kind: "invalid-input", message: unknownToMessage(error) }),
				});
				const after = yield* inspectPath(candidate, label, "File");
				if (
					!descriptorInfo.isFile() ||
					descriptorInfo.dev !== expected.dev ||
					descriptorInfo.ino !== expected.ino ||
					!samePathIdentity(before, after)
				) {
					return yield* new SandboxRunError({
						kind: "invalid-input",
						message: `${label} changed while its descriptor was pinned`,
					});
				}
				if (!Number.isSafeInteger(descriptorInfo.size) || descriptorInfo.size < 0) {
					return yield* new SandboxRunError({
						kind: "invalid-input",
						message: `${label} has an unsupported size`,
					});
				}
				return { handle, size: descriptorInfo.size } satisfies PinnedFile;
			});

			const readPinnedFile = (candidate: string, label: string, expectedSize?: number) =>
				Effect.scoped(
					Effect.gen(function* () {
						const pinned = yield* acquirePinnedFile(candidate, label);
						const size = expectedSize ?? pinned.size;
						if (pinned.size !== size) {
							return yield* new SandboxRunError({
								kind: "script-failure",
								message: `${label} size does not match its completed upload`,
							});
						}
						const bytes = new Uint8Array(size);
						let offset = 0;
						while (offset < size) {
							const read = yield* Effect.tryPromise({
								try: () => pinned.handle.read(bytes, offset, size - offset, offset),
								catch: (error) =>
									new SandboxRunError({ kind: "infrastructure", message: unknownToMessage(error) }),
							});
							if (read.bytesRead === 0) {
								return yield* new SandboxRunError({
									kind: "script-failure",
									message: `${label} ended before its pinned size`,
								});
							}
							offset += read.bytesRead;
						}
						return bytes;
					}),
				);

			const open = Effect.fn("SandboxFileService.open")(function* (
				input: SandboxRunInput,
			): Effect.fn.Return<SandboxFileAccess, SandboxRunError, Scope.Scope> {
				const declaredCapabilities = (input.principal.metadata.capabilities ?? []).filter(
					(capability) =>
						input.principal.subject.type !== "automation-run" ||
						input.principal.subject.stage !== "before" ||
						POLICY_SAFE_SANDBOX_CAPABILITIES.some((safe) => safe === capability),
				);
				const artifactPath = sandboxArtifactGrant(declaredCapabilities, input.grants?.artifactPath);
				const namedArtifactPaths = sandboxArtifactGrant(
					declaredCapabilities,
					input.grants?.namedArtifactPaths,
				);
				const scratchAllowed = declaresSandboxFilesystemGrant(declaredCapabilities, "scratch");
				const artifact =
					artifactPath !== undefined
						? yield* acquirePinnedFile(artifactPath, "Sandbox artifact grant path")
						: undefined;
				const namedArtifacts = new Map<string, PinnedFile>();
				for (const [key, candidate] of Object.entries(namedArtifactPaths ?? {})) {
					namedArtifacts.set(
						key,
						yield* acquirePinnedFile(candidate, `Sandbox named artifact grant path "${key}"`),
					);
				}

				const scratchDirectory = scratchAllowed
					? yield* Effect.acquireRelease(
							fs
								.makeTempDirectory({
									directory: localTempRoot,
									prefix: `${scratchDirectoryPrefix}${serverRun.id}-${sanitizeSandboxExecutionSegment(input.executionId)}-`,
								})
								.pipe(Effect.mapError((error) => sandboxFailure(error, "infrastructure"))),
							(directory) =>
								fs.remove(directory, { force: true, recursive: true }).pipe(Effect.ignore),
						)
					: undefined;
				if (scratchDirectory !== undefined) {
					yield* inspectPath(scratchDirectory, "Sandbox scratch directory", "Directory");
				}

				const semaphore = yield* Semaphore.make(1);
				const uploads = new Map<string, ScratchUpload>();
				let reservedBytes = 0;
				let temporaryIndex = 0;
				let harvested = false;

				const removeUpload = Effect.fnUntraced(function* (upload: ScratchUpload) {
					const currentPath = upload.complete ? upload.targetPath : upload.temporaryPath;
					const info = yield* fs.readLink(currentPath).pipe(
						Effect.as({ type: "SymbolicLink" as const }),
						Effect.catch(() => fs.stat(currentPath)),
					);
					if (info.type !== "File") {
						return yield* new SandboxRunError({
							kind: "invalid-input",
							message: `Sandbox scratch entry "${currentPath}" must be a regular file`,
						});
					}
					yield* fs
						.remove(currentPath, { force: true })
						.pipe(Effect.mapError((error) => sandboxFailure(error, "infrastructure")));
					uploads.delete(upload.name);
					reservedBytes -= upload.bytes;
					return undefined;
				});

				const rollbackUpload = (upload: ScratchUpload) =>
					Effect.gen(function* () {
						if (uploads.get(upload.name) !== upload) {
							return;
						}
						const currentPath = upload.complete ? upload.targetPath : upload.temporaryPath;
						const removal = yield* Effect.exit(fs.remove(currentPath, { force: true }));
						if (removal._tag === "Success") {
							uploads.delete(upload.name);
							reservedBytes -= upload.bytes;
						} else {
							upload.valid = false;
						}
					});

				const artifactReadRange = Effect.fn("SandboxFileService.artifactReadRange")(function* (
					unknownArgs: typeof artifactReadRangeArgsSchema.Type,
				): Effect.fn.Return<typeof artifactReadRangeResultSchema.Type, SandboxHostError> {
					const args = yield* decodeArtifactReadRangeArgs(unknownArgs).pipe(
						Effect.mapError((error) => failedHostRequest(unknownToMessage(error))),
					);
					if (args.offset > Number.MAX_SAFE_INTEGER - args.length) {
						return yield* Effect.fail(
							failedHostRequest("Artifact range offset and length exceed safe integer bounds"),
						);
					}
					const pinned = args.key === undefined ? artifact : namedArtifacts.get(args.key);
					if (pinned === undefined) {
						return yield* Effect.fail(
							missingArtifactGrant(
								args.key === undefined ? "artifactReadRange" : "readNamedArtifact",
							),
						);
					}
					const info = yield* Effect.tryPromise({
						catch: hostFailure,
						try: () => pinned.handle.stat(),
					});
					if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size < 0) {
						return yield* Effect.fail(failedHostRequest("Pinned artifact has an unsupported size"));
					}
					const bytes = new Uint8Array(args.length);
					const read = yield* Effect.tryPromise({
						catch: hostFailure,
						try: () => pinned.handle.read(bytes, 0, args.length, args.offset),
					});
					if (read.bytesRead < 0 || read.bytesRead > args.length) {
						return yield* Effect.fail(
							failedHostRequest("Pinned artifact returned an invalid range length"),
						);
					}
					return {
						size: info.size,
						offset: args.offset,
						data: encodeBase64(bytes.subarray(0, read.bytesRead)),
					} satisfies typeof artifactReadRangeResultSchema.Type;
				});

				const scratchWrite = Effect.fn("SandboxFileService.scratchWrite")(function* (
					unknownArgs: typeof scratchWriteArgsSchema.Type,
				): Effect.fn.Return<null, SandboxHostError> {
					const args = yield* decodeScratchWriteArgs(unknownArgs).pipe(
						Effect.mapError((error) => failedHostRequest(unknownToMessage(error))),
					);
					if (scratchDirectory === undefined) {
						return yield* Effect.fail(missingArtifactGrant("scratchWrite"));
					}
					if (!isPlainFileName(args.name)) {
						return yield* Effect.fail(
							failedHostRequest("Sandbox scratch chunk name must be a plain file name"),
						);
					}
					if (harvested) {
						return yield* Effect.fail(failedHostRequest("Sandbox scratch execution has ended"));
					}
					const decodedBytes = decodedBase64Length(args.data);
					if (
						!base64Pattern.test(args.data) ||
						decodedBytes < 0 ||
						decodedBytes > maxScratchChunkBytes
					) {
						return yield* Effect.fail(
							failedHostRequest("Scratch data exceeds 256 KiB or is not base64"),
						);
					}

					return yield* semaphore.withPermits(1)(
						Effect.uninterruptibleMask((restore) =>
							Effect.gen(function* () {
								if (harvested) {
									return yield* Effect.fail(
										failedHostRequest("Sandbox scratch execution has ended"),
									);
								}
								let upload = uploads.get(args.name);
								if (args.offset === 0) {
									if (upload !== undefined) {
										yield* removeUpload(upload).pipe(
											Effect.mapError((error) => hostFailure(error)),
										);
									} else {
										const targetPath = path.join(scratchDirectory, args.name);
										const linked = yield* fs.readLink(targetPath).pipe(
											Effect.as(true),
											Effect.orElseSucceed(() => false),
										);
										if (linked || (yield* fs.exists(targetPath))) {
											return yield* Effect.fail(
												failedHostRequest("Sandbox scratch target already exists"),
											);
										}
									}
									if (uploads.size >= SANDBOX_LIMITS.scratch.maxEntries) {
										return yield* Effect.fail(
											failedHostRequest("Sandbox scratch directory exceeds 4096 entries"),
										);
									}
									if (reservedBytes + decodedBytes > SANDBOX_LIMITS.scratch.totalBytes) {
										return yield* Effect.fail(
											failedHostRequest("Sandbox scratch write exceeds its 5 MiB quota"),
										);
									}
									temporaryIndex += 1;
									const targetPath = path.join(scratchDirectory, args.name);
									upload = {
										bytes: 0,
										targetPath,
										valid: true,
										started: false,
										name: args.name,
										complete: false,
										temporaryPath: path.join(scratchDirectory, `.upload-${temporaryIndex}.partial`),
									};
									uploads.set(args.name, upload);
								} else if (
									upload === undefined ||
									upload.complete ||
									!upload.valid ||
									args.offset !== upload.bytes
								) {
									return yield* Effect.fail(
										failedHostRequest("Sandbox scratch write offset is not sequential"),
									);
								}
								if (reservedBytes + decodedBytes > SANDBOX_LIMITS.scratch.totalBytes) {
									if (args.offset !== 0) {
										yield* rollbackUpload(upload);
									}
									return yield* Effect.fail(
										failedHostRequest("Sandbox scratch write exceeds its 5 MiB quota"),
									);
								}
								upload.bytes += decodedBytes;
								reservedBytes += decodedBytes;

								const activeUpload = upload;
								const write = Effect.gen(function* () {
									const bytes = yield* Effect.try({
										catch: hostFailure,
										try: () => decodeBase64(args.data),
									});
									yield* fs
										.writeFile(activeUpload.temporaryPath, bytes, {
											mode: 0o600,
											flag: activeUpload.started ? "a" : "wx",
										})
										.pipe(Effect.mapError(hostFailure));
									activeUpload.started = true;
									if (args.final) {
										const info = yield* fs
											.stat(activeUpload.temporaryPath)
											.pipe(Effect.mapError(hostFailure));
										const linked = yield* fs.readLink(activeUpload.targetPath).pipe(
											Effect.as(true),
											Effect.orElseSucceed(() => false),
										);
										if (
											info.type !== "File" ||
											Number(info.size) !== activeUpload.bytes ||
											linked ||
											(yield* fs.exists(activeUpload.targetPath))
										) {
											return yield* Effect.fail(
												failedHostRequest("Sandbox scratch file failed final validation"),
											);
										}
										yield* fs
											.rename(activeUpload.temporaryPath, activeUpload.targetPath)
											.pipe(Effect.mapError(hostFailure));
										activeUpload.complete = true;
									}
									yield* restore(Effect.yieldNow);
									return null;
								});
								return yield* write.pipe(
									Effect.onExit((exit) =>
										Exit.isFailure(exit) ? rollbackUpload(activeUpload) : Effect.void,
									),
								);
							}),
						),
					);
				});

				const harvest = Effect.fn("SandboxFileService.harvest")(function* (
					output: unknown,
				): Effect.fn.Return<
					{ readonly chunkHandles: ReadonlyArray<string> } | null,
					SandboxRunError
				> {
					if (harvested || scratchDirectory === undefined) {
						return null;
					}
					harvested = true;
					const manifest = decodeSandboxScratchManifest(output);
					if (Option.isNone(manifest)) {
						return yield* Effect.ensuring(
							Effect.succeed(null),
							fs.remove(scratchDirectory, { force: true, recursive: true }).pipe(Effect.ignore),
						);
					}
					const harvestOperation = Effect.scoped(
						Effect.gen(function* () {
							const chunkFiles = manifest.value.chunkFiles;
							const seen = new Set<string>();
							for (const name of chunkFiles) {
								if (!isPlainFileName(name) || seen.has(name)) {
									return yield* new SandboxRunError({
										kind: "script-failure",
										message: "Sandbox scratch manifest contains an invalid or duplicate file name",
									});
								}
								seen.add(name);
								const upload = uploads.get(name);
								if (!upload?.complete || !upload.valid) {
									return yield* new SandboxRunError({
										kind: "script-failure",
										message: `Sandbox scratch manifest names a missing or incomplete file "${name}"`,
									});
								}
							}
							const usedBytes = yield* measureSandboxScratchBytes(scratchDirectory).pipe(
								Effect.provideService(FileSystem.FileSystem, fs),
								Effect.provideService(Path.Path, path),
								Effect.mapError((error) => sandboxFailure(error, "script-failure")),
							);
							if (usedBytes > SANDBOX_LIMITS.scratch.totalBytes) {
								return yield* new SandboxRunError({
									kind: "script-failure",
									message: `Sandbox scratch directory exceeds ${SANDBOX_LIMITS.scratch.totalBytes} bytes`,
								});
							}
							const entries = yield* fs
								.readDirectory(scratchDirectory)
								.pipe(Effect.mapError((error) => sandboxFailure(error, "script-failure")));
							if (
								entries.length !== chunkFiles.length ||
								entries.some((entry) => !seen.has(entry))
							) {
								return yield* new SandboxRunError({
									kind: "script-failure",
									message: "Sandbox scratch directory contains unlisted or incomplete files",
								});
							}

							const harvestDirectory = yield* Effect.acquireRelease(
								fs
									.makeTempDirectory({
										directory: localTempRoot,
										prefix: `${SANDBOX_HARVEST_DIRECTORY_PREFIX}${serverRun.id}-${sanitizeSandboxExecutionSegment(input.executionId)}-`,
									})
									.pipe(Effect.mapError((error) => sandboxFailure(error, "infrastructure"))),
								(directory) =>
									fs.remove(directory, { force: true, recursive: true }).pipe(Effect.ignore),
							);
							const sources: string[] = [];
							for (const name of chunkFiles) {
								const upload = uploads.get(name);
								if (upload === undefined) {
									return yield* new SandboxRunError({
										kind: "script-failure",
										message: `Sandbox scratch manifest names a missing file "${name}"`,
									});
								}
								const bytes = yield* readPinnedFile(
									upload.targetPath,
									`Sandbox scratch file "${name}"`,
									upload.bytes,
								).pipe(Effect.mapError((error) => sandboxFailure(error, "script-failure")));
								const target = path.join(harvestDirectory, name);
								yield* fs
									.writeFile(target, bytes, { flag: "wx", mode: 0o600 })
									.pipe(Effect.mapError((error) => sandboxFailure(error, "infrastructure")));
								sources.push(target);
							}

							const stageOutputs = Option.isSome(staging)
								? yield* staging.value.prepare(input)
								: null;
							const ownerExecutionId =
								input.grants?.artifactOwnerExecutionId ?? input.workflowExecutionId;
							if (stageOutputs !== null) {
								return { chunkHandles: yield* stageOutputs(sources) };
							}
							if (ownerExecutionId === undefined) {
								return null;
							}
							const chunkHandles = yield* artifacts
								.materializeOutputs(ownerExecutionId, sources)
								.pipe(Effect.mapError((error) => sandboxFailure(error, "infrastructure")));
							return { chunkHandles };
						}),
					);
					return yield* harvestOperation.pipe(
						Effect.ensuring(
							fs.remove(scratchDirectory, { force: true, recursive: true }).pipe(Effect.ignore),
						),
					);
				});

				return {
					harvest,
					scratchWrite,
					artifactReadRange,
					filesystem: {
						artifact: artifact !== undefined,
						scratch: scratchDirectory !== undefined,
						namedArtifacts: [...namedArtifacts.keys()],
					},
				};
			});
			return { open } satisfies SandboxFileServiceApi;
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(SandboxArtifactStore.layer),
	);
}
