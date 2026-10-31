import { BunFileSystem } from "@effect/platform-bun";
import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { UploadBadRequest } from "@ryot-app/contract/modules/assets/schemas";
import type { BackupRunFailure } from "@ryot-app/contract/modules/backups/schemas";
import { BackupRunId, UserId } from "@ryot-app/contract/schema/brands";
import { defaultUserPreferences } from "@ryot-app/contract/schema/user-preferences";
import { Context, Effect, Layer, Ref, Stream } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { ObjectStorageService } from "#modules/assets/storage/object-storage";
import { DatabaseSession } from "#platform/db/session";
import { databaseLayer, makeAppConfigLayer, makeWorkflowActivityEngine } from "#testing/effect";

import { ARCHIVE_LIMITS } from "../archive/archive";
import { BackupArchiveError } from "../archive/error";
import { STREAMED_SECTION_PATHS } from "../archive/sections";
import { IncrementalSha256 } from "../archive/streaming";
import { BackupsRepository } from "../runs/repository";
import { BackupStaging } from "../staging";
import { BackupExportSnapshot } from "./snapshot";
import {
	ExportBackupWorkflow,
	ExportBackupWorkflowOperations,
	ExportBackupWorkflowOperationsLive,
	runExportBackupWorkflow,
} from "./workflow";

const runId = BackupRunId.make("run-1");
const userId = UserId.make("user-1");

class FakeExportOperations extends Context.Service<
	FakeExportOperations,
	{ readonly calls: Effect.Effect<ReadonlyArray<string>> }
>()("@ryot-app/kernel-backend/modules/backups/export/workflow.test/FakeExportOperations") {}

class FakeExportCleanup extends Context.Service<
	FakeExportCleanup,
	{ readonly deletes: Effect.Effect<number>; readonly failures: Effect.Effect<number> }
>()("@ryot-app/kernel-backend/modules/backups/export/workflow.test/FakeExportCleanup") {}

const instance = WorkflowInstance.initial(ExportBackupWorkflow, runId);

const recordingOperationsLayer = Layer.mergeAll(
	Layer.succeed(WorkflowInstance, instance),
	Layer.succeed(WorkflowEngine, makeWorkflowActivityEngine(instance)),
	Layer.unwrap(
		Effect.gen(function* () {
			const calls = yield* Ref.make<ReadonlyArray<string>>([]);
			const record = (call: string) => Ref.update(calls, (all) => [...all, call]);
			return Layer.merge(
				Layer.succeed(FakeExportOperations, { calls: Ref.get(calls) }),
				Layer.mock(ExportBackupWorkflowOperations, {
					fail: () => record("fail"),
					complete: () => record("complete"),
					begin: () => record("begin").pipe(Effect.as(true)),
					build: () =>
						record("build").pipe(
							Effect.as({
								provider: "local" as const,
								key: "temporary/run-1.zip",
								expiresAt: "2026-08-24T12:00:00.000Z",
							}),
						),
				}),
			);
		}),
	),
);

layer(recordingOperationsLayer)((test) => {
	test.effect("runs export side effects only through backup workflow operations", () =>
		Effect.gen(function* () {
			yield* runExportBackupWorkflow({ runId, userId }, runId);
			expect(yield* (yield* FakeExportOperations).calls).toEqual(["begin", "build", "complete"]);
		}),
	);

	test.effect(
		"passes expected archive failures through workflow activities to failure recording",
		() =>
			Effect.gen(function* () {
				const operations = yield* ExportBackupWorkflowOperations;
				const calls = yield* FakeExportOperations;
				const before = yield* calls.calls;
				const failure = new BackupArchiveError({
					maxBytes: 4,
					actualBytes: 5,
					path: "entities.ndjson",
					reason: "entry_too_large",
					message: "Record exceeds the limit",
				});
				yield* runExportBackupWorkflow({ runId, userId }, runId).pipe(
					Effect.provideService(ExportBackupWorkflowOperations, {
						...operations,
						build: (payload) =>
							operations.build(payload).pipe(Effect.andThen(Effect.fail(failure))),
						fail: (payload, error) => {
							expect(error).toEqual(failure);
							return operations.fail(payload, error);
						},
					}),
				);
				expect(yield* calls.calls).toEqual([...before, "begin", "build", "fail"]);
			}),
	);
});

const artifact = {
	provider: "local" as const,
	key: "temporary/run-1.zip",
	expiresAt: "2026-08-24T12:00:00.000Z",
};
const stagingLayer = Layer.mock(BackupStaging, {
	begin: () => Effect.void,
	cleanup: () => Effect.void,
	recoverAbandoned: () => Effect.void,
});
const completedRun = {
	id: runId,
	failure: null,
	progress: 100,
	kind: "export" as const,
	status: "completed" as const,
	expiresAt: artifact.expiresAt,
	finishedAt: artifact.expiresAt,
	artifactProvider: artifact.provider,
	createdAt: "2026-08-23T12:00:00.000Z",
	startedAt: "2026-08-23T12:01:00.000Z",
};

const ambiguousCompletionLayer = ExportBackupWorkflowOperationsLive.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			makeAppConfigLayer(),
			BunFileSystem.layer,
			stagingLayer,
			Layer.mock(DatabaseSession)({}),
			Layer.mock(BackupExportSnapshot, {}),
			Layer.unwrap(
				Effect.gen(function* () {
					const deletes = yield* Ref.make(0);
					const failures = yield* Ref.make(0);
					const completed = yield* Ref.make(false);
					return Layer.mergeAll(
						Layer.succeed(FakeExportCleanup, {
							deletes: Ref.get(deletes),
							failures: Ref.get(failures),
						}),
						Layer.mock(ObjectStorageService, {
							deleteObject: () => Ref.update(deletes, (count) => count + 1),
						}),
						Layer.mock(BackupsRepository, {
							failRun: () => Ref.update(failures, (count) => count + 1).pipe(Effect.as(null)),
							getRunById: () =>
								Ref.get(completed).pipe(
									Effect.map((isCompleted) => (isCompleted ? completedRun : null)),
								),
							completeRun: () =>
								Ref.set(completed, true).pipe(
									Effect.andThen(
										Effect.fail(new DbError({ message: "completion response was lost" })),
									),
								),
							getArtifactById: () =>
								Ref.get(completed).pipe(
									Effect.map((isCompleted) =>
										isCompleted
											? {
													...completedRun,
													userId,
													artifactKey: artifact.key,
													artifactProvider: artifact.provider,
												}
											: null,
									),
								),
						}),
					);
				}),
			),
		),
	),
);

layer(ambiguousCompletionLayer)((test) => {
	test.effect("preserves an artifact after an ambiguous export completion", () =>
		Effect.gen(function* () {
			const operations = yield* ExportBackupWorkflowOperations;
			const cleanup = yield* FakeExportCleanup;
			const error = yield* operations.complete({ runId, userId }, artifact).pipe(Effect.flip);
			expect(error._tag).toBe("InternalError");
			yield* operations.fail({ runId, userId }, error, artifact);
			expect(yield* cleanup.deletes).toBe(0);
			expect(yield* cleanup.failures).toBe(0);
		}),
	);
});

class ExportFailureRecorder extends Context.Service<
	ExportFailureRecorder,
	{ readonly failure: Effect.Effect<null | BackupRunFailure> }
>()("@ryot-app/kernel-backend/modules/backups/export/workflow.test/ExportFailureRecorder") {}

const archiveFailureLayer = ExportBackupWorkflowOperationsLive.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			makeAppConfigLayer(),
			BunFileSystem.layer,
			databaseLayer,
			stagingLayer,
			Layer.mock(BackupExportSnapshot, {
				prepareExportSnapshot: (_userId, path) =>
					Effect.sync(() => {
						return {
							redactions: [],
							managedAssets: [],
							requiredPlugins: [],
							records: {
								installations: [],
								privatePlugins: [],
								profile: { image: null, name: "Owner", preferences: { ...defaultUserPreferences } },
							},
							sections: STREAMED_SECTION_PATHS.map((section) => ({
								count: 0,
								path: section,
								filePath: path,
								sha256: new IncrementalSha256().digest().sha256,
								bytes: section === "entities.ndjson" ? ARCHIVE_LIMITS.maxEntryBytes + 1 : 0,
							})),
						};
					}),
			}),
			Layer.mock(ObjectStorageService, {
				deleteObject: () => Effect.void,
				writeObject: (_locator, stream) =>
					Stream.runDrain(stream).pipe(
						Effect.mapError(() => new UploadBadRequest({ reason: { code: "upload-failed" } })),
					),
			}),
			Layer.unwrap(
				Effect.gen(function* () {
					const failure = yield* Ref.make<null | BackupRunFailure>(null);
					return Layer.mergeAll(
						Layer.succeed(ExportFailureRecorder, { failure: Ref.get(failure) }),
						Layer.mock(BackupsRepository, {
							updateProgress: () => Effect.succeed(null),
							getArtifactById: () => Effect.succeed(null),
							failRun: (input) => Ref.set(failure, input.failure).pipe(Effect.as(null)),
							getRunById: () => Effect.succeed({ ...completedRun, status: "running" as const }),
						}),
					);
				}),
			),
		),
	),
);

layer(archiveFailureLayer)((test) => {
	test.effect("preserves an archive limit failure when storage masks the stream error", () =>
		Effect.gen(function* () {
			const operations = yield* ExportBackupWorkflowOperations;
			const error = yield* operations.build({ runId, userId }).pipe(Effect.flip);
			expect(error).toBeInstanceOf(BackupArchiveError);
			yield* operations.fail({ runId, userId }, error);
			expect(yield* (yield* ExportFailureRecorder).failure).toEqual({
				code: "archive-invalid",
				path: "entities.ndjson",
				issue: "entry-too-large",
				maxBytes: ARCHIVE_LIMITS.maxEntryBytes,
				actualBytes: ARCHIVE_LIMITS.maxEntryBytes + 1,
			});
		}),
	);
});
