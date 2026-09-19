import { expect, layer } from "@effect/vitest";
import { ImportRunId, IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Context, Effect, Layer, Ref } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { makeWorkflowActivityEngine } from "#lib/test-utils/effect";
import { mutationAdmissionTestLayer } from "#lib/test-utils/mutation-admission";
import type { IngestionRecoveryCursor } from "#modules/imports/runtime/recovery-cursor";

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
	recovery?: ReadonlyArray<IntegrationSyncRun>;
	page?: IntegrationsService["Service"]["prepareRecoveryRuns"];
	release?: (run: IntegrationSyncRun) => Effect.Effect<boolean>;
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
						releaseRecoveryRun: options.release ?? (() => Effect.succeed(true)),
						prepareYankRuns: (userId) =>
							Ref.update(preparedFor, (all) => [...all, userId]).pipe(Effect.as([...options.runs])),
						prepareRecoveryRuns:
							options.page ??
							(() => Effect.succeed({ next: null, runs: [...(options.recovery ?? [])] })),
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

const blockedFront = Array.from({ length: 105 }, (_unused, index) =>
	run({
		userId: "user-1",
		integrationId: "integration-1",
		runId: `blocked-${index.toString().padStart(3, "0")}`,
	}),
);
const recoveryTail = [
	run({ userId: "user-1", runId: "ready-tail", integrationId: "integration-1" }),
	run({ userId: "user-1", runId: "cancelling-tail", integrationId: "integration-1" }),
];
const fairnessCalls: { before: string; after: IngestionRecoveryCursor | null }[] = [];
const fairnessReleases: string[] = [];
layer(
	makeSyncLayer({
		runs: [],
		release: (owner) =>
			Effect.sync(() => {
				fairnessReleases.push(owner.runId);
				return owner.runId === "ready-tail";
			}),
		page: (input) =>
			Effect.sync(() => {
				fairnessCalls.push(input);
				expect(fairnessCalls.length).toBeLessThanOrEqual(2);
				const rows = [...blockedFront, ...recoveryTail];
				const start = input.after
					? rows.findIndex((owner) => owner.runId === input.after?.id) + 1
					: 0;
				const page = rows.slice(start, start + 100);
				const last = page.at(-1);
				return {
					runs: page,
					next:
						page.length === 100 && last
							? { id: last.runId, createdAt: IsoUtcString.make(input.before) }
							: null,
				};
			}),
	}),
)((test) => {
	test.effect(
		"passes more than 100 unreleasable owners to reach ready and cancelling tails with a fixed finite snapshot",
		() =>
			Effect.gen(function* () {
				yield* runIntegrationSyncWorkflow(payload, payload.executionId);
				expect(fairnessCalls).toHaveLength(2);
				expect(fairnessCalls[1]?.before).toBe(fairnessCalls[0]?.before);
				expect(fairnessCalls[1]?.after?.id).toBe("blocked-099");
				expect(fairnessReleases).toEqual(
					[...blockedFront, ...recoveryTail].map((owner) => owner.runId),
				);
				expect(
					(yield* (yield* FakeIntegrationSync).executions).map((owner) => owner.executionId),
				).toEqual(["ready-tail"]);
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

layer(
	makeSyncLayer({
		recovery: runs,
		release: (owner) => Effect.succeed(owner.runId === "run-1"),
		runs: [run({ runId: "run-1", userId: "user-1", integrationId: "integration-1" })],
	}),
)((test) => {
	test.effect(
		"dispatches a released recovery owner once using its original execution identity",
		() =>
			Effect.gen(function* () {
				yield* runIntegrationSyncWorkflow(payload, payload.executionId);
				expect(
					(yield* (yield* FakeIntegrationSync).executions).map(({ executionId }) => executionId),
				).toEqual(["run-1"]);
			}),
	);
});
