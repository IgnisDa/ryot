import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot/contract/errors";
import { BackupRunId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { Database } from "#lib/infrastructure/db/service";
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

it.effect("runs export side effects only through backup workflow operations", () => {
	const calls: string[] = [];
	const payload = { runId, userId };
	const instance = WorkflowInstance.initial(ExportBackupWorkflow, runId);
	const engine = makeWorkflowActivityEngine(instance);
	const layer = Layer.mergeAll(
		Layer.succeed(WorkflowInstance, instance),
		Layer.succeed(WorkflowEngine, engine),
		Layer.mock(ExportBackupWorkflowOperations, {
			begin: () => Effect.sync(() => (calls.push("begin"), true)),
			build: () =>
				Effect.sync(() => {
					calls.push("build");
					return {
						provider: "local" as const,
						key: "temporary/run-1.zip",
						expiresAt: "2026-08-24T12:00:00.000Z",
					};
				}),
			complete: () => Effect.sync(() => void calls.push("complete")),
			fail: () => Effect.sync(() => void calls.push("fail")),
		}),
	);
	return Effect.gen(function* () {
		yield* runExportBackupWorkflow(payload, runId);
		expect(calls).toEqual(["begin", "build", "complete"]);
	}).pipe(Effect.provide(layer));
});

it.effect("preserves an artifact after an ambiguous export completion", () => {
	let deletes = 0;
	let failures = 0;
	let completed = false;
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
	const layer = ExportBackupWorkflowOperationsLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				makeAppConfigLayer(),
				BunFileSystem.layer,
				Layer.succeed(Database, Object.create(null)),
				Layer.mock(BackupExportSnapshot, {}),
				Layer.mock(ObjectStorageService, {
					deleteObject: () => Effect.sync(() => void (deletes += 1)),
				}),
				Layer.mock(BackupsRepository, {
					completeRun: () =>
						Effect.sync(() => {
							completed = true;
						}).pipe(
							Effect.andThen(Effect.fail(new DbError({ message: "completion response was lost" }))),
						),
					getRunById: () => Effect.succeed(completed ? completedRun : null),
					getArtifactById: () =>
						Effect.succeed(
							completed
								? {
										...completedRun,
										userId,
										artifactKey: artifact.key,
										artifactProvider: artifact.provider,
									}
								: null,
						),
					failRun: () => Effect.sync(() => ((failures += 1), null)),
				}),
			),
		),
	);

	return Effect.gen(function* () {
		const operations = yield* ExportBackupWorkflowOperations;
		const error = yield* operations.complete({ runId, userId }, artifact).pipe(Effect.flip);
		expect(error._tag).toBe("InternalError");
		yield* operations.fail({ runId, userId }, error, artifact);
		expect(deletes).toBe(0);
		expect(failures).toBe(0);
	}).pipe(Effect.provide(layer));
});
