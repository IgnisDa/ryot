import { BunFileSystem } from "@effect/platform-bun";
import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { BackupRunId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import { makeAppConfigLayer, makeWorkflowActivityEngine } from "#lib/test-utils/effect";
import { ObjectStorageService } from "#modules/uploads/object-storage/service";

import { BackupsRepository } from "../runs/repository";
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
>()("test/FakeExportOperations") {}

class FakeExportCleanup extends Context.Service<
	FakeExportCleanup,
	{ readonly deletes: Effect.Effect<number>; readonly failures: Effect.Effect<number> }
>()("test/FakeExportCleanup") {}

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
});

const artifact = {
	provider: "local" as const,
	key: "temporary/run-1.zip",
	expiresAt: "2026-08-24T12:00:00.000Z",
};
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
