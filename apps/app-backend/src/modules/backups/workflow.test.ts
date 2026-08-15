import { expect, it } from "@effect/vitest";
import { BackupRunId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { makeWorkflowActivityEngine } from "#lib/test-utils/effect";

import {
	ExportBackupWorkflow,
	ExportBackupWorkflowOperations,
	runExportBackupWorkflow,
} from "./export-workflow";
import {
	RestoreBackupWorkflow,
	RestoreBackupWorkflowOperations,
	runRestoreBackupWorkflow,
} from "./restore-workflow";

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

it.effect("runs restore claim, direct writes, and cleanup without application hooks", () => {
	const calls: string[] = [];
	const payload = { runId, userId, uploadToken: "token" };
	const instance = WorkflowInstance.initial(RestoreBackupWorkflow, runId);
	const engine = makeWorkflowActivityEngine(instance);
	const layer = Layer.mergeAll(
		Layer.succeed(WorkflowInstance, instance),
		Layer.succeed(WorkflowEngine, engine),
		Layer.mock(RestoreBackupWorkflowOperations, {
			begin: () => Effect.sync(() => (calls.push("begin"), true)),
			claim: () =>
				Effect.sync(() => {
					calls.push("claim");
					return { intentId: "intent", provider: "local" as const, key: "temporary/input.zip" };
				}),
			restore: () => Effect.sync(() => void calls.push("restore")),
			cleanup: () => Effect.sync(() => void calls.push("cleanup")),
			fail: () => Effect.sync(() => void calls.push("fail")),
		}),
	);
	return Effect.gen(function* () {
		yield* runRestoreBackupWorkflow(payload, runId);
		expect(calls).toEqual(["begin", "claim", "restore", "cleanup"]);
	}).pipe(Effect.provide(layer));
});
