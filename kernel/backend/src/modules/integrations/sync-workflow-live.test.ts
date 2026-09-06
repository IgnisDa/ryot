import { expect, layer } from "@effect/vitest";
import { ImportRunId, IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { makeWorkflowActivityEngine } from "#lib/test-utils/effect";
import { mutationAdmissionTestLayer } from "#lib/test-utils/mutation-admission";

import type { IntegrationSyncRun } from "./jobs";
import { IntegrationsService } from "./service";
import { IntegrationSyncWorkflow } from "./sync-workflow";
import { runIntegrationSyncWorkflow } from "./sync-workflow-live";

const payload = { userId: null, accountGeneration: null, executionId: "integrations-sync-run" };

const run = (input: {
	runId: string;
	userId: string;
	integrationId: string;
}): IntegrationSyncRun => ({
	userId: UserId.make(input.userId),
	runId: ImportRunId.make(input.runId),
	integrationId: IntegrationId.make(input.integrationId),
	accountGeneration: { token: "test-account-generation", userId: UserId.make(input.userId) },
});

type ExecuteOptions = Parameters<WorkflowEngine["Service"]["execute"]>[1];

class FakeIntegrationSync extends Context.Service<
	FakeIntegrationSync,
	{
		readonly executions: Effect.Effect<ReadonlyArray<ExecuteOptions>>;
		readonly preparedFor: Effect.Effect<ReadonlyArray<UserId | null>>;
	}
>()("test/FakeIntegrationSync") {}

const makeSyncLayer = (options: {
	runs: ReadonlyArray<IntegrationSyncRun>;
	execute?: (options: ExecuteOptions) => Effect.Effect<unknown>;
}) =>
	Layer.mergeAll(
		mutationAdmissionTestLayer,
		Layer.unwrap(
			Effect.gen(function* () {
				const executions = yield* Ref.make<ReadonlyArray<ExecuteOptions>>([]);
				const preparedFor = yield* Ref.make<ReadonlyArray<UserId | null>>([]);
				const instance = WorkflowInstance.initial(IntegrationSyncWorkflow, payload.executionId);
				const execute = options.execute ?? (() => Effect.void);
				return Layer.mergeAll(
					Layer.succeed(FakeIntegrationSync, {
						executions: Ref.get(executions),
						preparedFor: Ref.get(preparedFor),
					}),
					Layer.succeed(WorkflowInstance, instance),
					Layer.succeed(
						WorkflowEngine,
						makeWorkflowActivityEngine(instance, {
							execute: (_workflow, executeOptions) =>
								Ref.update(executions, (all) => [...all, executeOptions]).pipe(
									Effect.andThen(execute(executeOptions)),
								),
						}),
					),
					Layer.mock(IntegrationsService)({
						settleImportDispatchFailure: () => Effect.void,
						prepareYankRuns: (userId) =>
							Ref.update(preparedFor, (all) => [...all, userId]).pipe(Effect.as([...options.runs])),
					}),
				);
			}),
		),
	);

const runs = [
	run({ runId: "run-1", userId: "user-1", integrationId: "integration-1" }),
	run({ runId: "run-2", userId: "user-2", integrationId: "integration-2" }),
];

layer(makeSyncLayer({ runs: [] }))((test) => {
	test.effect("prepares runs for the requested user", () =>
		Effect.gen(function* () {
			const userId = UserId.make("user-1");
			yield* runIntegrationSyncWorkflow(
				{ ...payload, userId, accountGeneration: { userId, token: "test-account-generation" } },
				payload.executionId,
			);

			expect(yield* (yield* FakeIntegrationSync).preparedFor).toEqual([userId]);
		}),
	);
});

layer(makeSyncLayer({ runs, execute: (options) => Effect.succeed(options.executionId) }))(
	(test) => {
		test.effect("dispatches a process run for every eligible integration from the body", () =>
			Effect.gen(function* () {
				yield* runIntegrationSyncWorkflow(payload, payload.executionId);

				expect(yield* (yield* FakeIntegrationSync).executions).toMatchObject([
					{
						discard: true,
						executionId: "run-1",
						payload: {
							runId: "run-1",
							userId: "user-1",
							integrationId: "integration-1",
							accountGeneration: {
								userId: UserId.make("user-1"),
								token: "test-account-generation",
							},
						},
					},
					{
						discard: true,
						executionId: "run-2",
						payload: {
							runId: "run-2",
							userId: "user-2",
							integrationId: "integration-2",
							accountGeneration: {
								userId: UserId.make("user-2"),
								token: "test-account-generation",
							},
						},
					},
				]);
			}),
		);
	},
);

layer(
	makeSyncLayer({
		runs,
		execute: (options) =>
			options.executionId === "run-1"
				? Effect.die("dispatch boom")
				: Effect.succeed(options.executionId),
	}),
)((test) => {
	test.effect("swallows a run dispatch failure and continues to the remaining runs", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(runIntegrationSyncWorkflow(payload, payload.executionId));
			expect(exit._tag).toBe("Success");
			expect(
				(yield* (yield* FakeIntegrationSync).executions).map(({ executionId }) => executionId),
			).toEqual(["run-1", "run-2"]);
		}),
	);
});
