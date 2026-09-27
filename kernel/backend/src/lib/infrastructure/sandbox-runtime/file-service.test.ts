import { BunServices } from "@effect/platform-bun";
import { layer } from "@effect/vitest";
import {
	AutomationExecutionId,
	AutomationRunId,
	AutomationTriggerId,
	SandboxScriptId,
} from "@ryot-app/contract/schema/brands";
import {
	Cause,
	Context,
	Deferred,
	Effect,
	Exit,
	Fiber,
	FileSystem,
	Layer,
	Option,
	Path,
} from "effect";
import { assert, describe, expect } from "vitest";

import { ServerRun } from "#lib/infrastructure/server-run";
import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { SandboxArtifactStore } from "./artifacts";
import { SandboxFileService } from "./file-service";
import { SANDBOX_HARVEST_DIRECTORY_PREFIX, measureSandboxScratchBytes } from "./filesystem-grants";
import { SANDBOX_LIMITS } from "./limits";
import type { SandboxRunInput } from "./shared";

const chunkBytes = 256 * 1024;
const MiB = 1024 * 1024;
const parentExecutionId = "parent-workflow-execution";
const scratchDirectoryPrefix = "ryot-sandbox-scratch-";

type SymlinkSwap = { readonly path: string; readonly target: string; readonly recursive: boolean };

type FileServiceTestControl = {
	failNextWrite: boolean;
	blockNextWrite: boolean;
	maxObservedBytes: number;
	symlinkAfterStat: SymlinkSwap | undefined;
	readonly writeStarted: Deferred.Deferred<void>;
	readonly releaseWrite: Deferred.Deferred<void>;
};

class FileServiceRoot extends Context.Service<FileServiceRoot, string>()(
	"test/SandboxFileServiceRoot",
) {}
class FileServiceControl extends Context.Service<FileServiceControl, FileServiceTestControl>()(
	"test/SandboxFileServiceControl",
) {}
class ScratchEntryFileService extends Context.Service<
	ScratchEntryFileService,
	SandboxFileService["Service"]
>()("test/ScratchEntryFileService") {}

const fileServiceLayer = Layer.unwrap(
	Effect.gen(function* () {
		const realFs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const temporaryRoot = yield* realFs.makeTempDirectoryScoped({ prefix: "ryot-file-service-" });
		const root = yield* realFs.realPath(temporaryRoot);
		const control: FileServiceTestControl = {
			maxObservedBytes: 0,
			failNextWrite: false,
			blockNextWrite: false,
			symlinkAfterStat: undefined,
			writeStarted: yield* Deferred.make<void>(),
			releaseWrite: yield* Deferred.make<void>(),
		};
		const fs: FileSystem.FileSystem = {
			...realFs,
			stat: (candidate) =>
				realFs.stat(candidate).pipe(
					Effect.tap(() => {
						const swap = control.symlinkAfterStat;
						if (!swap || swap.path !== candidate) {
							return Effect.void;
						}
						control.symlinkAfterStat = undefined;
						return realFs
							.remove(candidate, { force: true, recursive: swap.recursive })
							.pipe(Effect.andThen(realFs.symlink(swap.target, candidate)));
					}),
				),
			writeFile: (filePath, data, options) => {
				const trackPhysicalBytes = (write: ReturnType<typeof realFs.writeFile>) =>
					write.pipe(
						Effect.tap(() =>
							scratchBytesIn(root).pipe(
								Effect.provideService(FileSystem.FileSystem, realFs),
								Effect.provideService(Path.Path, path),
								Effect.tap((bytes) =>
									Effect.sync(() => {
										control.maxObservedBytes = Math.max(control.maxObservedBytes, bytes);
									}),
								),
								Effect.orDie,
							),
						),
					);
				if (control.failNextWrite && filePath.endsWith(".partial")) {
					control.failNextWrite = false;
					return realFs.writeFile(`${root}/missing-directory/file`, data, options);
				}
				if (control.blockNextWrite && filePath.endsWith(".partial")) {
					control.blockNextWrite = false;
					return trackPhysicalBytes(
						Deferred.succeed(control.writeStarted, undefined).pipe(
							Effect.andThen(Deferred.await(control.releaseWrite)),
							Effect.andThen(realFs.writeFile(filePath, data, options)),
						),
					);
				}
				return trackPhysicalBytes(realFs.writeFile(filePath, data, options));
			},
		};
		const services = Layer.mergeAll(SandboxFileService.layer, SandboxArtifactStore.layer).pipe(
			Layer.provide(
				Layer.mergeAll(
					makeAppConfigLayer({ fileStorage: { localTempDir: root } }),
					Layer.succeed(ServerRun, { id: "file-service-test-run" }),
					Layer.succeed(FileSystem.FileSystem, fs),
				),
			),
		);
		return Layer.mergeAll(
			services,
			Layer.effect(ScratchEntryFileService, SandboxFileService.make).pipe(
				Layer.provide(SandboxArtifactStore.layer),
				Layer.provide(
					Layer.mergeAll(
						makeAppConfigLayer({ fileStorage: { localTempDir: root } }),
						Layer.succeed(FileSystem.FileSystem, realFs),
						Layer.succeed(ServerRun, { id: "scratch-entry-test-run" }),
					),
				),
			),
			Layer.succeed(FileServiceRoot, root),
			Layer.succeed(FileServiceControl, control),
		);
	}),
).pipe(Layer.provideMerge(BunServices.layer));

const makeInput = (
	grants: NonNullable<SandboxRunInput["grants"]>,
	capabilities: ReadonlyArray<
		NonNullable<SandboxRunInput["principal"]["metadata"]["capabilities"]>[number]
	> = ["artifact-read", "scratch"],
	subject: SandboxRunInput["principal"]["subject"] = { type: "system" },
): SandboxRunInput => ({
	grants,
	context: {},
	compiledCode: "",
	compiledFormat: 1,
	lane: "interactive",
	executionId: "file-service-execution",
	workflowExecutionId: "child-workflow-execution",
	principal: {
		subject,
		contentHash: "",
		providerId: null,
		pluginRevision: null,
		scriptSlug: "file-service-script",
		scriptId: SandboxScriptId.make("file-service-script"),
		metadata: { kind: "script", runtimeImports: [], capabilities: [...capabilities] },
	},
});

const encodeBase64 = (bytes: Uint8Array) => {
	let binary = "";
	for (let index = 0; index < bytes.length; index += 32_768) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 32_768));
	}
	return btoa(binary);
};

const scratchBytesIn = (root: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		let total = 0;
		for (const entry of yield* fs.readDirectory(root)) {
			if (!entry.startsWith(scratchDirectoryPrefix)) {
				continue;
			}
			const directory = path.join(root, entry);
			total += yield* measureSandboxScratchBytes(directory);
		}
		return total;
	});

const scratchDirectoriesIn = (root: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		return (yield* fs.readDirectory(root)).filter(
			(entry) =>
				entry.startsWith(scratchDirectoryPrefix) ||
				entry.startsWith(SANDBOX_HARVEST_DIRECTORY_PREFIX),
		);
	});

type SandboxFileAccess = Effect.Success<ReturnType<SandboxFileService["Service"]["open"]>>;

describe("sandbox file service", () => {
	layer(fileServiceLayer)((test) => {
		test.effect("scratch_entry_admission_caps_partial_uploads_and_allows_replacement", () =>
			Effect.gen(function* () {
				const root = yield* FileServiceRoot;
				const service = yield* ScratchEntryFileService;
				yield* Effect.scoped(
					Effect.gen(function* () {
						const files = yield* service.open(makeInput({}));
						for (let index = 0; index < SANDBOX_LIMITS.scratch.maxEntries; index++) {
							yield* files.scratchWrite({
								data: "",
								offset: 0,
								final: false,
								name: `chunk-${index}`,
							});
						}
						expect(
							yield* Effect.flip(
								files.scratchWrite({ data: "", offset: 0, final: true, name: "overflow" }),
							),
						).toEqual({ message: "Sandbox scratch directory exceeds 4096 entries" });
						expect(
							yield* files.scratchWrite({ data: "", offset: 0, final: true, name: "chunk-0" }),
						).toBeNull();
					}),
				);
				expect(yield* scratchDirectoriesIn(root)).toEqual([]);
			}),
		);

		test.effect("file_service_enforces_write_time_quota_and_named_harvest", () =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				const root = yield* FileServiceRoot;
				const fs = yield* FileSystem.FileSystem;
				const service = yield* SandboxFileService;
				const artifacts = yield* SandboxArtifactStore;
				const input = makeInput({ artifactOwnerExecutionId: parentExecutionId });
				const replacement = path.join(root, "harvest-symlink-target");
				yield* fs.writeFileString(replacement, "not a chunk");
				const peak = { bytes: 0 };
				const recordScratchBytes = Effect.fnUntraced(function* () {
					const bytes = yield* scratchBytesIn(root);
					peak.bytes = Math.max(peak.bytes, bytes);
					expect(bytes).toBeLessThanOrEqual(SANDBOX_LIMITS.scratch.totalBytes);
				});
				const writeBytes = Effect.fnUntraced(function* (
					files: SandboxFileAccess,
					name: string,
					contents: Uint8Array,
					final: boolean,
				) {
					if (contents.byteLength === 0) {
						yield* files.scratchWrite({ name, final, data: "", offset: 0 });
						yield* recordScratchBytes();
						return;
					}
					for (let offset = 0; offset < contents.byteLength; offset += chunkBytes) {
						const end = Math.min(contents.byteLength, offset + chunkBytes);
						const last = end === contents.byteLength;
						yield* files.scratchWrite({
							name,
							offset,
							final: final && last,
							data: encodeBase64(contents.subarray(offset, end)),
						});
						yield* recordScratchBytes();
					}
				});

				const result = yield* Effect.scoped(
					Effect.gen(function* () {
						const files = yield* service.open(input);
						for (const name of [
							".",
							"..",
							"../escape",
							"nested/name",
							"back\\slash",
							"nul\0name",
						]) {
							const invalidName = yield* Effect.flip(
								files.scratchWrite({ name, data: "", offset: 0, final: true }),
							);
							expect(invalidName).toEqual({
								message: "Sandbox scratch chunk name must be a plain file name",
							});
						}
						expect(yield* scratchBytesIn(root)).toBe(0);
						yield* writeBytes(files, "large.bin", new Uint8Array(4 * MiB).fill(0x61), true);
						yield* writeBytes(files, "pending.bin", new Uint8Array(MiB).fill(0x62), false);
						expect(yield* scratchBytesIn(root)).toBe(5 * MiB);

						const overQuota = yield* Effect.exit(
							files.scratchWrite({
								offset: 0,
								final: true,
								name: "overflow.bin",
								data: encodeBase64(new Uint8Array([1])),
							}),
						);
						expect(Exit.isFailure(overQuota)).toBe(true);
						expect(yield* scratchBytesIn(root)).toBe(5 * MiB);

						yield* files.scratchWrite({
							offset: 0,
							final: false,
							name: "large.bin",
							data: encodeBase64(new Uint8Array(chunkBytes).fill(0x63)),
						});
						yield* recordScratchBytes();
						for (let offset = chunkBytes; offset < 4 * MiB; offset += chunkBytes) {
							const end = Math.min(4 * MiB, offset + chunkBytes);
							yield* files.scratchWrite({
								offset,
								name: "large.bin",
								final: end === 4 * MiB,
								data: encodeBase64(new Uint8Array(end - offset).fill(0x63)),
							});
							yield* recordScratchBytes();
						}
						yield* files.scratchWrite({ data: "", final: true, offset: MiB, name: "pending.bin" });
						yield* recordScratchBytes();

						const harvested = yield* files.harvest({ chunkFiles: ["large.bin", "pending.bin"] });
						assert(harvested !== null);
						expect(Object.keys(harvested)).toEqual(["chunkHandles"]);
						expect(harvested.chunkHandles).toHaveLength(2);
						expect(harvested.chunkHandles.every((handle) => !handle.includes(root))).toBe(true);
						const [largePath, pendingPath] = yield* artifacts.resolveOutputs(
							parentExecutionId,
							harvested.chunkHandles,
						);
						assert(largePath !== undefined && pendingPath !== undefined);
						expect((yield* fs.readFile(largePath)).byteLength).toBe(4 * MiB);
						expect((yield* fs.readFile(pendingPath)).byteLength).toBe(MiB);
						expect(
							(yield* Effect.exit(
								artifacts.resolveOutputs("child-workflow-execution", harvested.chunkHandles),
							))._tag,
						).toBe("Failure");
						return harvested;
					}),
				);
				expect(result.chunkHandles).toHaveLength(2);
				expect(yield* scratchDirectoriesIn(root)).toEqual([]);
				expect(peak.bytes).toBeLessThanOrEqual(5 * MiB);

				const rejectHarvest = Effect.fnUntraced(function* (
					populate: (files: SandboxFileAccess) => Effect.Effect<unknown, unknown>,
					output: unknown,
				) {
					const outcome = yield* Effect.scoped(
						Effect.gen(function* () {
							const files = yield* service.open(input);
							yield* populate(files);
							return yield* Effect.exit(files.harvest(output));
						}),
					);
					expect(Exit.isFailure(outcome)).toBe(true);
					expect(yield* scratchDirectoriesIn(root)).toEqual([]);
				});
				yield* rejectHarvest(() => Effect.void, { chunkFiles: ["missing.bin"] });
				yield* rejectHarvest(
					(files) =>
						files.scratchWrite({ offset: 0, final: true, data: "AQ==", name: "duplicate.bin" }),
					{ chunkFiles: ["duplicate.bin", "duplicate.bin"] },
				);
				yield* rejectHarvest(
					(files) =>
						Effect.gen(function* () {
							yield* files.scratchWrite({
								offset: 0,
								final: true,
								data: "AQ==",
								name: "listed.bin",
							});
							yield* files.scratchWrite({
								offset: 0,
								final: true,
								data: "Ag==",
								name: "unlisted.bin",
							});
						}),
					{ chunkFiles: ["listed.bin"] },
				);
				yield* rejectHarvest(
					(files) =>
						Effect.gen(function* () {
							yield* files.scratchWrite({
								offset: 0,
								final: true,
								data: "AQ==",
								name: "incomplete.bin",
							});
							yield* files.scratchWrite({
								offset: 0,
								data: "Ag==",
								final: false,
								name: "incomplete.bin",
							});
						}),
					{ chunkFiles: ["incomplete.bin"] },
				);
				yield* rejectHarvest(
					(files) =>
						Effect.gen(function* () {
							yield* files.scratchWrite({
								offset: 0,
								final: true,
								data: "AQ==",
								name: "linked.bin",
							});
							const scratchEntry = (yield* fs.readDirectory(root)).find((entry) =>
								entry.startsWith(scratchDirectoryPrefix),
							);
							assert(scratchEntry !== undefined);
							const scratchDirectory = path.join(root, scratchEntry);
							yield* fs.remove(path.join(scratchDirectory, "linked.bin"));
							yield* fs.symlink(replacement, path.join(scratchDirectory, "linked.bin"));
						}),
					{ chunkFiles: ["linked.bin"] },
				);

				const controls = yield* FileServiceControl;
				const concurrent = yield* Effect.scoped(
					Effect.gen(function* () {
						const files = yield* service.open(input);
						const upload = (name: string) =>
							Effect.gen(function* () {
								for (let offset = 0; offset < 4 * MiB; offset += chunkBytes) {
									const end = offset + chunkBytes;
									yield* files.scratchWrite({
										name,
										offset,
										final: end === 4 * MiB,
										data: encodeBase64(
											new Uint8Array(chunkBytes).fill(name === "first.bin" ? 1 : 2),
										),
									});
								}
							});
						const outcomes = yield* Effect.all(
							[Effect.exit(upload("first.bin")), Effect.exit(upload("second.bin"))],
							{ concurrency: 2 },
						);
						return outcomes;
					}),
				);
				expect(concurrent.some(Exit.isSuccess)).toBe(true);
				expect(concurrent.some(Exit.isFailure)).toBe(true);
				expect(yield* scratchBytesIn(root)).toBeLessThanOrEqual(5 * MiB);
				expect(controls.maxObservedBytes).toBeLessThanOrEqual(5 * MiB);

				yield* Effect.scoped(
					Effect.gen(function* () {
						const files = yield* service.open(input);
						controls.failNextWrite = true;
						const failed = yield* Effect.exit(
							files.scratchWrite({
								offset: 0,
								final: true,
								name: "retry.bin",
								data: encodeBase64(new Uint8Array([5, 6, 7])),
							}),
						);
						expect(Exit.isFailure(failed)).toBe(true);
						expect(yield* scratchBytesIn(root)).toBe(0);
						yield* files.scratchWrite({
							offset: 0,
							final: true,
							name: "retry.bin",
							data: encodeBase64(new Uint8Array([5, 6, 7])),
						});
						expect(yield* scratchBytesIn(root)).toBe(3);
					}),
				);

				yield* Effect.scoped(
					Effect.gen(function* () {
						const files = yield* service.open(input);
						controls.blockNextWrite = true;
						const writeFiber = yield* Effect.forkChild(
							files.scratchWrite({
								offset: 0,
								final: true,
								name: "interrupted.bin",
								data: encodeBase64(new Uint8Array([8, 9])),
							}),
						);
						yield* Deferred.await(controls.writeStarted);
						const interruptFiber = yield* Effect.forkChild(Fiber.interrupt(writeFiber));
						yield* Effect.yieldNow;
						yield* Deferred.succeed(controls.releaseWrite, undefined);
						const outcome = yield* Fiber.await(writeFiber);
						yield* Fiber.await(interruptFiber);
						assert(Exit.isFailure(outcome));
						expect(Cause.hasInterrupts(outcome.cause)).toBe(true);
						expect(yield* scratchBytesIn(root)).toBe(0);
					}),
				);
			}),
		);

		test.effect("files_and_http_require_execution_bound_grants", () =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				const root = yield* FileServiceRoot;
				const fs = yield* FileSystem.FileSystem;
				const service = yield* SandboxFileService;
				const source = path.join(root, "artifact.json");
				const namedSource = path.join(root, "named.json");
				const replacement = path.join(root, "replacement.json");
				const parentDirectory = path.join(root, "parent");
				const outsideDirectory = path.join(root, "outside");
				yield* fs.writeFileString(source, "trusted");
				yield* fs.writeFileString(namedSource, "named-data");
				yield* fs.writeFileString(replacement, "spoofed");
				yield* fs.makeDirectory(parentDirectory);
				yield* fs.makeDirectory(outsideDirectory);
				yield* fs.writeFileString(path.join(parentDirectory, "file.json"), "inside");
				yield* fs.writeFileString(path.join(outsideDirectory, "file.json"), "outside");

				const pinnedRead = yield* Effect.scoped(
					Effect.gen(function* () {
						const files = yield* service.open(
							makeInput({ artifactPath: source, namedArtifactPaths: { history: namedSource } }),
						);
						yield* fs.rename(source, path.join(root, "original.json"));
						yield* fs.writeFileString(source, "spoofed");
						const artifact = yield* files.artifactReadRange({ length: 7, offset: 0 });
						const named = yield* files.artifactReadRange({ offset: 0, length: 10, key: "history" });
						const forged = yield* Effect.exit(
							files.artifactReadRange({ length: 1, offset: 0, key: "forged" }),
						);
						assert(Exit.isFailure(forged));
						const error = Cause.findErrorOption(forged.cause);
						assert(Option.isSome(error));
						expect(error.value.data).toEqual({
							code: "missing-artifact-grant",
							operation: "readNamedArtifact",
						});
						return [artifact.data, named.data];
					}),
				);
				expect(pinnedRead).toEqual([btoa("trusted"), btoa("named-data")]);

				const traversal = yield* Effect.scoped(
					Effect.exit(service.open(makeInput({ artifactPath: `${root}/../replacement.json` }))),
				);
				expect(Exit.isFailure(traversal)).toBe(true);

				const linkedFile = path.join(root, "linked.json");
				yield* fs.symlink(replacement, linkedFile);
				const symlinkGrant = yield* Effect.scoped(
					Effect.exit(service.open(makeInput({ artifactPath: linkedFile }))),
				);
				expect(Exit.isFailure(symlinkGrant)).toBe(true);
				const namedSymlinkGrant = yield* Effect.scoped(
					Effect.exit(service.open(makeInput({ namedArtifactPaths: { forged: linkedFile } }))),
				);
				expect(Exit.isFailure(namedSymlinkGrant)).toBe(true);
				yield* fs.remove(linkedFile);

				const linkedParent = path.join(root, "linked-parent");
				yield* fs.symlink(parentDirectory, linkedParent);
				const parentGrant = yield* Effect.scoped(
					Effect.exit(
						service.open(makeInput({ artifactPath: path.join(linkedParent, "file.json") })),
					),
				);
				expect(Exit.isFailure(parentGrant)).toBe(true);
				yield* fs.remove(linkedParent);

				const control = yield* FileServiceControl;
				const raceDirectory = path.join(root, "race-parent");
				const raceFile = path.join(raceDirectory, "file.json");
				yield* fs.makeDirectory(raceDirectory);
				yield* fs.writeFileString(raceFile, "original");
				control.symlinkAfterStat = {
					recursive: true,
					path: raceDirectory,
					target: outsideDirectory,
				};
				const racedParent = yield* Effect.scoped(
					Effect.exit(service.open(makeInput({ artifactPath: raceFile }))),
				);
				expect(Exit.isFailure(racedParent)).toBe(true);
				yield* fs.remove(raceDirectory);

				const beforePolicy = yield* Effect.scoped(
					Effect.gen(function* () {
						const files = yield* service.open(
							makeInput({ artifactPath: namedSource }, ["artifact-read", "scratch"], {
								pluginId: null,
								stage: "before",
								delivery: "policy",
								executionUserId: null,
								type: "automation-run",
								pluginRevisionId: null,
								accountGeneration: null,
								pluginConfigRevisionId: null,
								runId: AutomationRunId.make("before-run"),
								triggerId: AutomationTriggerId.make("before-trigger"),
								causation: {
									depth: 0,
									source: "api",
									parentRunId: null,
									lane: "interactive",
									parentTriggerId: null,
									initiator: { id: null, kind: "system" },
									executionId: AutomationExecutionId.make("before-execution"),
									rootExecutionId: AutomationExecutionId.make("before-execution"),
								},
							}),
						);
						const read = yield* Effect.exit(files.artifactReadRange({ length: 1, offset: 0 }));
						const write = yield* Effect.exit(
							files.scratchWrite({ offset: 0, final: true, data: "AQ==", name: "blocked.bin" }),
						);
						return [read, write] as const;
					}),
				);
				expect(beforePolicy.every(Exit.isFailure)).toBe(true);
			}),
		);
	});
});
