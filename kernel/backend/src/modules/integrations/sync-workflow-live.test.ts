import { expect, it } from "@effect/vitest";
import { ImportRunId, IntegrationId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { databaseLayer, makeWorkflowActivityEngine } from "#lib/test-utils/effect";

import type { IntegrationSyncRun } from "./jobs";
import { IntegrationsService } from "./service";
import { IntegrationSyncWorkflow } from "./sync-workflow";
import { runIntegrationSyncWorkflow } from "./sync-workflow-live";

const payload = { userId: null, executionId: "integrations-sync-run" };

const run = (input: {
	runId: string;
	userId: string;
	integrationId: string;
}): IntegrationSyncRun => ({
	userId: UserId.make(input.userId),
	runId: ImportRunId.make(input.runId),
	integrationId: IntegrationId.make(input.integrationId),
});

type ExecuteStub = (
	...args: Parameters<WorkflowEngine["Service"]["execute"]>
) => Effect.Effect<unknown, unknown>;

const integrationsServiceMock = Layer.mock(IntegrationsService);

const makeIntegrationsService = (
	runs: ReadonlyArray<IntegrationSyncRun>,
	onPrepare?: (userId: UserId | null) => void,
) =>
	integrationsServiceMock({
		prepareYankRuns: (userId) => {
			onPrepare?.(userId);
			return Effect.succeed([...runs]);
		},
	});

const withEngine = <A, E, R>(
	options: {
		runs: ReadonlyArray<IntegrationSyncRun>;
		execute?: ExecuteStub;
		onPrepare?: (userId: UserId | null) => void;
	},
	effect: Effect.Effect<A, E, R>,
) => {
	const instance = WorkflowInstance.initial(IntegrationSyncWorkflow, payload.executionId);
	const engine = makeWorkflowActivityEngine(instance, {
		execute: options.execute ?? (() => Effect.void),
	});
	return effect.pipe(
		Effect.provideService(WorkflowInstance, instance),
		Effect.provideService(WorkflowEngine, engine),
		Effect.provide(
			Layer.mergeAll(databaseLayer, makeIntegrationsService(options.runs, options.onPrepare)),
		),
	);
};

it.effect("prepares runs for the requested user", () => {
	const preparedFor: Array<UserId | null> = [];
	const userId = UserId.make("user-1");

	return withEngine(
		{ runs: [], onPrepare: (preparedUserId) => preparedFor.push(preparedUserId) },
		Effect.gen(function* () {
			yield* runIntegrationSyncWorkflow({ ...payload, userId }, payload.executionId);

			expect(preparedFor).toEqual([userId]);
		}),
	);
});

it.effect("dispatches a process run for every eligible integration from the body", () => {
	const captured: Array<Parameters<WorkflowEngine["Service"]["execute"]>[1]> = [];
	const runs = [
		run({ runId: "run-1", userId: "user-1", integrationId: "integration-1" }),
		run({ runId: "run-2", userId: "user-2", integrationId: "integration-2" }),
	];

	return withEngine(
		{
			runs,
			execute: (_workflow, options) => {
				captured.push(options);
				return Effect.succeed(options.executionId);
			},
		},
		Effect.gen(function* () {
			yield* runIntegrationSyncWorkflow(payload, payload.executionId);

			expect(captured).toMatchObject([
				{
					discard: true,
					executionId: "run-1",
					payload: { runId: "run-1", userId: "user-1", integrationId: "integration-1" },
				},
				{
					discard: true,
					executionId: "run-2",
					payload: { runId: "run-2", userId: "user-2", integrationId: "integration-2" },
				},
			]);
		}),
	);
});

it.effect("swallows a run dispatch failure and continues to the remaining runs", () => {
	const dispatched: string[] = [];
	const runs = [
		run({ runId: "run-1", userId: "user-1", integrationId: "integration-1" }),
		run({ runId: "run-2", userId: "user-2", integrationId: "integration-2" }),
	];

	return withEngine(
		{
			runs,
			execute: (_workflow, options) => {
				dispatched.push(options.executionId);
				return options.executionId === "run-1"
					? Effect.die("dispatch boom")
					: Effect.succeed(options.executionId);
			},
		},
		Effect.gen(function* () {
			const exit = yield* Effect.exit(runIntegrationSyncWorkflow(payload, payload.executionId));
			expect(exit._tag).toBe("Success");
			expect(dispatched).toEqual(["run-1", "run-2"]);
		}),
	);
});
