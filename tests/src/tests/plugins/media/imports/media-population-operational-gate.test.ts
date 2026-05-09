import { randomUUID } from "node:crypto";

import { MediaImportPopulationWorkflowOutput } from "@ryot/media-plugin/workflows/schemas";
import { Clock, Effect, Schema } from "effect";

import {
	createAuthenticatedClient,
	fakeProviderDetailsResult,
	findBuiltinSchemaBySlug,
	getMediaPopulationGateResult,
	installTestProvider,
	sampleOperationalPressure,
	startMediaPopulationGate,
} from "~/fixtures";
import { describe, expect, it } from "~/support/effect-test";

const ITEM_COUNT = 1_001;
const GATE_TIMEOUT_MS = 900_000;
const POLL_INTERVAL = "1 second";
const EXPECTED_MINIMUM_SANDBOX_EXECUTIONS = 4_008;
const RUN_OPERATIONAL_GATES =
	process.env.RUN_OPERATIONAL_GATES === "1" || process.env.RUN_OPERATIONAL_GATES === "true";

describe.skipIf(!RUN_OPERATIONAL_GATES)("media population operational gate", () => {
	it.live(
		"completes two concurrent full-size imports through durable infrastructure",
		() =>
			Effect.gen(function* () {
				const firstUser = yield* createAuthenticatedClient();
				const secondUser = yield* createAuthenticatedClient();
				const { schema } = yield* findBuiltinSchemaBySlug(firstUser.client, "book");
				const provider = yield* installTestProvider({
					client: firstUser.client,
					linkToEntitySchemaSlug: schema.id,
					details: fakeProviderDetailsResult({
						properties: {},
						name: "Phase 3 Operational Gate Book",
					}),
				});
				const baseline = yield* sampleOperationalPressure([`phase-3-baseline-${randomUUID()}`]);
				const startedAt = yield* Clock.currentTimeMillis;
				const prefix = randomUUID();
				const runs = yield* Effect.all(
					[
						{ executingUserId: firstUser.userId, identifierPrefix: `${prefix}-first` },
						{ executingUserId: secondUser.userId, identifierPrefix: `${prefix}-second` },
					].map((run) =>
						startMediaPopulationGate({
							...run,
							itemCount: ITEM_COUNT,
							entitySchemaSlug: schema.id,
							providerId: provider.providerId,
						}),
					),
					{ concurrency: "unbounded" },
				);
				const deadline = startedAt + GATE_TIMEOUT_MS;
				const executionIds = runs.flatMap((run) => run.executionIds);
				let finalPressure = baseline;
				let maxWaitingAdvisoryLocks = 0;
				let maxConcurrentPendingRuns = 0;
				let maxAppPoolWaitingRequests = 0;
				let maxActiveSandboxExecutions = 0;
				let finalResults = yield* Effect.all(runs.map(getMediaPopulationGateResult), {
					concurrency: "unbounded",
				});

				for (;;) {
					const now = yield* Clock.currentTimeMillis;
					if (now >= deadline) {
						return yield* Effect.die(
							new Error(`Phase 3 operational gate exceeded ${GATE_TIMEOUT_MS}ms`),
						);
					}
					const [pressure, results] = yield* Effect.all(
						[
							sampleOperationalPressure(executionIds),
							Effect.all(runs.map(getMediaPopulationGateResult), { concurrency: "unbounded" }),
						],
						{ concurrency: "unbounded" },
					);
					finalPressure = pressure;
					finalResults = results;
					maxWaitingAdvisoryLocks = Math.max(
						maxWaitingAdvisoryLocks,
						pressure.locks.waitingAdvisoryLocks,
					);
					maxAppPoolWaitingRequests = Math.max(
						maxAppPoolWaitingRequests,
						pressure.database.appPoolWaitingRequests,
					);
					maxActiveSandboxExecutions = Math.max(
						maxActiveSandboxExecutions,
						pressure.sandbox.activeExecutions,
					);
					const pendingRuns = results.filter((result) =>
						result.executions.some(({ status }) => status === "pending"),
					).length;
					maxConcurrentPendingRuns = Math.max(maxConcurrentPendingRuns, pendingRuns);
					if (
						results.every((result) => result.executions.every(({ status }) => status !== "pending"))
					) {
						break;
					}
					yield* Effect.sleep(POLL_INTERVAL);
				}

				const resultCounts = finalResults.map((run) => {
					const outputs = run.executions.map((execution) => {
						expect(execution.status).toBe("completed");
						return Schema.decodeUnknownSync(MediaImportPopulationWorkflowOutput)(execution.output);
					});
					const results = outputs.flatMap((output) => output.results);
					expect(results).toHaveLength(ITEM_COUNT);
					expect(results.every(({ status }) => status === "completed")).toBe(true);
					return results.length;
				});
				const sandboxExecutionCount =
					finalPressure.sandbox.totalExecutions - baseline.sandbox.totalExecutions;
				const deadlockCount = finalPressure.database.deadlocks - baseline.database.deadlocks;

				expect(resultCounts).toEqual([ITEM_COUNT, ITEM_COUNT]);
				expect(maxConcurrentPendingRuns).toBe(2);
				expect(maxActiveSandboxExecutions).toBeGreaterThanOrEqual(2);
				expect(maxAppPoolWaitingRequests).toBe(0);
				expect(maxWaitingAdvisoryLocks).toBe(0);
				expect(deadlockCount).toBe(0);
				expect(finalPressure.redis.projectionErrors).toBe(0);
				expect(finalPressure.redis.projectionCount).toBeGreaterThanOrEqual(4);
				expect(finalPressure.redis.maxHighWater).toBeGreaterThan(0);
				expect(sandboxExecutionCount).toBeGreaterThanOrEqual(EXPECTED_MINIMUM_SANDBOX_EXECUTIONS);
				return resultCounts;
			}),
		GATE_TIMEOUT_MS + 30_000,
	);
});
