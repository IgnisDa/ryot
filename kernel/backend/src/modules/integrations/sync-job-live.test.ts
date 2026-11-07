import { expect } from "bun:test";

import { ImportRunId, IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import type { IngestionRecoveryCursor } from "#modules/imports/runtime/recovery-cursor";
import { makeWorkflowEngine } from "#testing/effect";

import type { IntegrationSyncRun } from "./jobs";
import { IntegrationsService } from "./service";
import { runIntegrationSyncJob } from "./sync-job-live";

const payload = { userId: null };
const job = { attempt: 1, id: "integration-sync-job" };
const cutoff = "2026-10-24T12:00:00.000Z";

const run = (input: {
	runId: string;
	userId: string;
	integrationId: string;
}): IntegrationSyncRun => ({
	userId: UserId.make(input.userId),
	runId: ImportRunId.make(input.runId),
	accountUserId: UserId.make(input.userId),
	integrationId: IntegrationId.make(input.integrationId),
});

type ExecuteOptions = Parameters<WorkflowEngine["Service"]["execute"]>[1];

class FakeIntegrationSync extends Context.Service<
	FakeIntegrationSync,
	{
		readonly executions: Effect.Effect<ReadonlyArray<ExecuteOptions>>;
		readonly preparedFor: Effect.Effect<ReadonlyArray<null | UserId>>;
	}
>()("@ryot-app/kernel-backend/modules/integrations/sync-job-live.test/FakeIntegrationSync") {}

const makeSyncLayer = (options: {
	recovery?: ReadonlyArray<IntegrationSyncRun>;
	prepare?: IntegrationsService["Service"]["prepareYankRuns"];
	page?: IntegrationsService["Service"]["prepareRecoveryRuns"];
	release?: (run: IntegrationSyncRun) => Effect.Effect<boolean>;
	execute?: (options: ExecuteOptions) => Effect.Effect<unknown>;
	cutoff?: IntegrationsService["Service"]["captureRecoveryCutoff"];
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const executions = yield* Ref.make<ReadonlyArray<ExecuteOptions>>([]);
			const preparedFor = yield* Ref.make<ReadonlyArray<null | UserId>>([]);
			const execute = options.execute ?? (() => Effect.void);
			return Layer.mergeAll(
				Layer.succeed(FakeIntegrationSync, {
					executions: Ref.get(executions),
					preparedFor: Ref.get(preparedFor),
				}),
				Layer.succeed(
					WorkflowEngine,
					makeWorkflowEngine({
						execute: (_workflow, executeOptions) =>
							Ref.update(executions, (all) => [...all, executeOptions]).pipe(
								Effect.andThen(execute(executeOptions)),
							),
					}),
				),
				Layer.mock(IntegrationsService)({
					releaseRecoveryRun: options.release ?? (() => Effect.succeed(true)),
					captureRecoveryCutoff: options.cutoff ?? (() => Effect.succeed(cutoff)),
					prepareRecoveryRuns:
						options.page ??
						(() => Effect.succeed({ next: null, runs: [...(options.recovery ?? [])] })),
					prepareYankRuns: (userId) =>
						Ref.update(preparedFor, (all) => [...all, userId]).pipe(
							Effect.andThen(options.prepare?.(userId) ?? Effect.void),
						),
				}),
			);
		}),
	);

const runs = [
	run({ runId: "run-1", userId: "user-1", integrationId: "integration-1" }),
	run({ runId: "run-2", userId: "user-2", integrationId: "integration-2" }),
];

layer(makeSyncLayer({}))((test) => {
	test.effect(
		"prepares runs for the requested user",
		() =>
			Effect.gen(function* () {
				const userId = UserId.make("user-1");
				yield* runIntegrationSyncJob({ userId }, job);

				expect(yield* (yield* FakeIntegrationSync).preparedFor).toEqual([userId]);
			}),
		testTimeout,
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
const fairnessCalls: { before: string; after: null | IngestionRecoveryCursor }[] = [];
const fairnessReleases: string[] = [];
layer(
	makeSyncLayer({
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
				yield* runIntegrationSyncJob(payload, job);
				expect(fairnessCalls).toHaveLength(2);
				expect(fairnessCalls[1]?.before).toBe(fairnessCalls[0]?.before);
				expect(fairnessCalls[1]?.after?.id).toBe<unknown>("blocked-099");
				expect(fairnessReleases).toEqual(
					[...blockedFront, ...recoveryTail].map((owner) => owner.runId),
				);
				expect(
					(yield* (yield* FakeIntegrationSync).executions).map((owner) => owner.executionId),
				).toEqual(["ready-tail"]);
			}),
		testTimeout,
	);
});

layer(makeSyncLayer({ recovery: runs, execute: (options) => Effect.succeed(options.executionId) }))(
	(test) => {
		test.effect(
			"dispatches a process run for every eligible integration from the body",
			() =>
				Effect.gen(function* () {
					yield* runIntegrationSyncJob(payload, job);

					expect(yield* (yield* FakeIntegrationSync).executions).toMatchObject([
						{
							discard: true,
							executionId: "run-1",
							payload: {
								runId: "run-1",
								userId: "user-1",
								integrationId: "integration-1",
								accountUserId: UserId.make("user-1"),
							},
						},
						{
							discard: true,
							executionId: "run-2",
							payload: {
								runId: "run-2",
								userId: "user-2",
								integrationId: "integration-2",
								accountUserId: UserId.make("user-2"),
							},
						},
					]);
				}),
			testTimeout,
		);
	},
);

layer(
	makeSyncLayer({
		recovery: runs,
		execute: (options) =>
			options.executionId === "run-1"
				? Effect.die("dispatch boom")
				: Effect.succeed(options.executionId),
	}),
)((test) => {
	test.effect(
		"swallows a run dispatch failure and continues to the remaining runs",
		() =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(runIntegrationSyncJob(payload, job));
				expect(exit._tag).toBe("Success");
				expect(
					(yield* (yield* FakeIntegrationSync).executions).map(({ executionId }) => executionId),
				).toEqual(["run-1", "run-2"]);
			}),
		testTimeout,
	);
});

const committed: IntegrationSyncRun[] = [];
const admissionOrder: string[] = [];
const concurrent = run({
	userId: "user-1",
	runId: "postcutoff-delivery",
	integrationId: "integration-1",
});
layer(
	makeSyncLayer({
		prepare: () =>
			Effect.sync(() => {
				admissionOrder.push("admission");
				committed.push(...runs);
			}),
		cutoff: () =>
			Effect.sync(() => {
				expect(committed).toEqual(runs);
				admissionOrder.push("cutoff");
				return cutoff;
			}),
		page: (input) =>
			Effect.sync(() => {
				admissionOrder.push("scan");
				expect(input.before).toBe(cutoff);
				const rows = [
					...committed.map((owner) => ({ owner, createdAt: cutoff })),
					{ owner: concurrent, createdAt: "2026-10-24T12:00:01.000Z" },
				];
				return {
					next: null,
					runs: rows.filter((row) => row.createdAt <= input.before).map((row) => row.owner),
				};
			}),
	}),
)((test) => {
	test.effect(
		"discovers committed yank runs only through the post-admission snapshot",
		() =>
			Effect.gen(function* () {
				yield* runIntegrationSyncJob(payload, job);
				expect(admissionOrder).toEqual(["admission", "cutoff", "scan"]);
				expect(
					(yield* (yield* FakeIntegrationSync).executions).map((owner) => owner.executionId),
				).toEqual(runs.map((owner) => owner.runId));
			}),
		testTimeout,
	);
});

const partialAdmissions: IntegrationSyncRun[] = [];
let admissionAttempts = 0;
let partialCutoffs = 0;
layer(
	makeSyncLayer({
		page: () => Effect.sync(() => ({ next: null, runs: [...partialAdmissions] })),
		cutoff: () =>
			Effect.sync(() => {
				partialCutoffs++;
				return cutoff;
			}),
		prepare: () =>
			Effect.gen(function* () {
				admissionAttempts++;
				for (const owner of runs) {
					if (!partialAdmissions.some((stored) => stored.runId === owner.runId)) {
						partialAdmissions.push(owner);
					}
					if (admissionAttempts === 1) {
						return yield* Effect.die("admission failed after first commit");
					}
				}
				return yield* Effect.void;
			}),
	}),
)((test) => {
	test.effect(
		"recovers earlier committed owners after partial admission fails and retries",
		() =>
			Effect.gen(function* () {
				const first = yield* Effect.exit(runIntegrationSyncJob(payload, job));
				expect(first._tag).toBe("Failure");
				expect(partialAdmissions.map((owner) => owner.runId)).toEqual<unknown>(["run-1"]);
				expect(partialCutoffs).toBe(0);
				expect(yield* (yield* FakeIntegrationSync).executions).toEqual([]);
				yield* runIntegrationSyncJob(payload, job);
				expect(admissionAttempts).toBe(2);
				expect(partialCutoffs).toBe(1);
				expect(
					(yield* (yield* FakeIntegrationSync).executions).map((owner) => owner.executionId),
				).toEqual(["run-1", "run-2"]);
			}),
		testTimeout,
	);
});

layer(
	makeSyncLayer({
		recovery: runs,
		release: (owner) =>
			owner.runId === "run-1" ? Effect.die("release failed") : Effect.succeed(true),
	}),
)((test) => {
	test.effect(
		"continues past a failed release without dispatching that owner",
		() =>
			Effect.gen(function* () {
				yield* runIntegrationSyncJob(payload, job);
				expect(
					(yield* (yield* FakeIntegrationSync).executions).map((owner) => owner.executionId),
				).toEqual(["run-2"]);
			}),
		testTimeout,
	);
});

layer(
	makeSyncLayer({ recovery: runs, release: (owner) => Effect.succeed(owner.runId === "run-1") }),
)((test) => {
	test.effect(
		"dispatches a released recovery owner once using its original execution identity",
		() =>
			Effect.gen(function* () {
				yield* runIntegrationSyncJob(payload, job);
				expect(
					(yield* (yield* FakeIntegrationSync).executions).map(({ executionId }) => executionId),
				).toEqual(["run-1"]);
			}),
		testTimeout,
	);
});
