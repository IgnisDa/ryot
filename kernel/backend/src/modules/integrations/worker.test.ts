import { expect } from "bun:test";

import type {
	ImportRunFailureReason,
	ImportRunStatus,
} from "@ryot-app/contract/modules/imports/schemas";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, DateTime, Effect, Layer, Ref } from "effect";

import { ImportsRepository } from "#modules/imports/repository";
import { databaseLayer } from "#testing/effect";

import { IntegrationsRepository } from "./repository";
import { IntegrationsService } from "./service";
import { makeIntegration, makeRun } from "./test-support";
import { finalizeIntegrationRun } from "./worker";

const mockImportsRepository = Layer.mock(ImportsRepository);
const mockIntegrationsService = Layer.mock(IntegrationsService);

class FakeIntegrationUpdates extends Context.Service<
	FakeIntegrationUpdates,
	{ readonly updates: Effect.Effect<ReadonlyArray<Record<string, unknown>>> }
>()("@ryot-app/kernel-backend/modules/integrations/worker.test/FakeIntegrationUpdates") {}

const makeWorkerLayer = (input: {
	disableWins?: boolean;
	runStatus: ImportRunStatus;
	failureReason?: ImportRunFailureReason;
	recentStatuses?: ReadonlyArray<{ status: "failed" | "completed" }>;
}) =>
	Layer.mergeAll(
		databaseLayer,
		mockImportsRepository({
			getRunById: () =>
				Effect.succeed({
					...makeRun("completed"),
					status: input.runStatus,
					finishedAt: "2026-06-17T12:00:00.000Z",
					failureReason: input.failureReason ?? null,
				}),
		}),
		Layer.mock(IntegrationsRepository)({
			listRecentHealthStatuses: () => Effect.succeed([...(input.recentStatuses ?? [])]),
		}),
		Layer.unwrap(
			Effect.gen(function* () {
				const updates = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([]);
				const record = (update: Record<string, unknown>) =>
					Ref.update(updates, (all) => [...all, update]);
				return Layer.merge(
					Layer.succeed(FakeIntegrationUpdates, { updates: Ref.get(updates) }),
					mockIntegrationsService({
						recordRunFinished: ({ userId, finishedAt, integrationId }) =>
							record({ userId, integrationId, lastFinishedAt: finishedAt }),
						disableIfEnabled: (userId, integrationId, runId) =>
							input.disableWins
								? record({ runId, userId, integrationId, isDisabled: true }).pipe(Effect.as(true))
								: Effect.succeed(false),
					}),
				);
			}),
		),
	);

layer(makeWorkerLayer({ runStatus: "completed" }))((test) => {
	test.effect(
		"updates lastFinishedAt after a completed integration run",
		() =>
			Effect.gen(function* () {
				const wasDisabled = yield* finalizeIntegrationRun(
					makeIntegration(),
					ImportRunId.make("run_1"),
				);
				const updates = yield* (yield* FakeIntegrationUpdates).updates;

				expect(wasDisabled).toBe(false);
				expect(updates).toHaveLength(1);
				expect(updates[0]).toMatchObject({
					userId: "user_1",
					integrationId: "int_1",
					lastFinishedAt: DateTime.toDateUtc(DateTime.makeUnsafe("2026-06-17T12:00:00.000Z")),
				});
			}),
		testTimeout,
	);
});

for (const runStatus of [
	"pending",
	"running",
	"blocked",
	"expired",
	"cancelling",
	"cancelled",
	"completed",
] as const) {
	layer(
		makeWorkerLayer({
			runStatus,
			disableWins: true,
			recentStatuses: Array.from({ length: 5 }, () => ({ status: "failed" as const })),
		}),
	)((test) => {
		test.effect(
			`does not auto-disable from a ${runStatus} run even after older source failures`,
			() =>
				Effect.gen(function* () {
					expect(yield* finalizeIntegrationRun(makeIntegration(), ImportRunId.make("run_1"))).toBe(
						false,
					);
					expect(
						(yield* (yield* FakeIntegrationUpdates).updates).some((update) => update["isDisabled"]),
					).toBe(false);
				}),
			testTimeout,
		);
	});
}

for (const failureReason of [
	{ code: "integration-disabled" },
	{ code: "integrations-disabled" },
	{ code: "integration-not-found" },
	{ code: "pro-key-required" },
	{ code: "queue-unavailable", operation: "integration-webhook" },
] satisfies ImportRunFailureReason[]) {
	layer(
		makeWorkerLayer({
			failureReason,
			disableWins: true,
			runStatus: "failed",
			recentStatuses: Array.from({ length: 5 }, () => ({ status: "failed" as const })),
		}),
	)((test) => {
		test.effect(
			`does not count ${failureReason.code} as a source failure`,
			() =>
				Effect.gen(function* () {
					expect(yield* finalizeIntegrationRun(makeIntegration(), ImportRunId.make("run_1"))).toBe(
						false,
					);
					expect(yield* (yield* FakeIntegrationUpdates).updates).toEqual([]);
				}),
			testTimeout,
		);
	});
}

layer(
	makeWorkerLayer({
		disableWins: true,
		runStatus: "failed",
		recentStatuses: [
			{ status: "failed" },
			{ status: "failed" },
			{ status: "failed" },
			{ status: "failed" },
			{ status: "failed" },
		],
	}),
)((test) => {
	test.effect(
		"disables the integration after 5 consecutive failures",
		() =>
			Effect.gen(function* () {
				const wasDisabled = yield* finalizeIntegrationRun(
					makeIntegration(),
					ImportRunId.make("run_1"),
				);

				expect(wasDisabled).toBe(true);
				expect(yield* (yield* FakeIntegrationUpdates).updates).toEqual([
					{ runId: "run_1", userId: "user_1", isDisabled: true, integrationId: "int_1" },
				]);
			}),
		testTimeout,
	);
});

layer(
	makeWorkerLayer({
		runStatus: "failed",
		recentStatuses: Array.from({ length: 5 }, () => ({ status: "failed" as const })),
	}),
)((test) => {
	test.effect(
		"does not claim a second disable transition after a concurrent run wins",
		() =>
			Effect.gen(function* () {
				const wasDisabled = yield* finalizeIntegrationRun(
					makeIntegration(),
					ImportRunId.make("run_1"),
				);
				expect(wasDisabled).toBe(false);
			}),
		testTimeout,
	);
});

layer(
	makeWorkerLayer({
		runStatus: "failed",
		recentStatuses: [
			{ status: "failed" },
			{ status: "failed" },
			{ status: "completed" },
			{ status: "failed" },
			{ status: "failed" },
		],
	}),
)((test) => {
	test.effect(
		"does not disable integrations when recent runs are not all failures",
		() =>
			Effect.gen(function* () {
				const wasDisabled = yield* finalizeIntegrationRun(
					makeIntegration(),
					ImportRunId.make("run_1"),
				);

				expect(wasDisabled).toBe(false);
				expect(yield* (yield* FakeIntegrationUpdates).updates).toEqual([]);
			}),
		testTimeout,
	);
});
