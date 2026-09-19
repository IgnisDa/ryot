import { layer } from "@effect/vitest";
import type {
	ImportRunFailureReason,
	ImportRunStatus,
} from "@ryot-app/contract/modules/imports/schemas";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import { Context, DateTime, Effect, Layer, Ref } from "effect";
import { expect as vitestExpect } from "vitest";

import { databaseLayer } from "#lib/test-utils/effect";
import { ImportsRepository } from "#modules/imports/repository";

import { IntegrationsRepository } from "./repository";
import { IntegrationsService } from "./service";
import { makeIntegration, makeRun } from "./test-support";
import { finalizeIntegrationRun } from "./worker";

const mockImportsRepository = Layer.mock(ImportsRepository);
const mockIntegrationsService = Layer.mock(IntegrationsService);

class FakeIntegrationUpdates extends Context.Service<
	FakeIntegrationUpdates,
	{ readonly updates: Effect.Effect<ReadonlyArray<Record<string, unknown>>> }
>()("test/FakeIntegrationUpdates") {}

const makeWorkerLayer = (input: {
	disableWins?: boolean;
	runStatus: ImportRunStatus;
	failureReason?: ImportRunFailureReason;
	recentStatuses?: ReadonlyArray<{ status: "completed" | "failed" }>;
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
	test.effect("updates lastFinishedAt after a completed integration run", () =>
		Effect.gen(function* () {
			const wasDisabled = yield* finalizeIntegrationRun(
				makeIntegration(),
				ImportRunId.make("run_1"),
			);
			const updates = yield* (yield* FakeIntegrationUpdates).updates;

			vitestExpect(wasDisabled).toBe(false);
			vitestExpect(updates).toHaveLength(1);
			vitestExpect(updates[0]).toMatchObject({
				userId: "user_1",
				integrationId: "int_1",
				lastFinishedAt: DateTime.toDateUtc(DateTime.makeUnsafe("2026-06-17T12:00:00.000Z")),
			});
		}),
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
					vitestExpect(
						yield* finalizeIntegrationRun(makeIntegration(), ImportRunId.make("run_1")),
					).toBe(false);
					vitestExpect(
						(yield* (yield* FakeIntegrationUpdates).updates).some((update) => update["isDisabled"]),
					).toBe(false);
				}),
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
		test.effect(`does not count ${failureReason.code} as a source failure`, () =>
			Effect.gen(function* () {
				vitestExpect(
					yield* finalizeIntegrationRun(makeIntegration(), ImportRunId.make("run_1")),
				).toBe(false);
				vitestExpect(yield* (yield* FakeIntegrationUpdates).updates).toEqual([]);
			}),
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
	test.effect("disables the integration after 5 consecutive failures", () =>
		Effect.gen(function* () {
			const wasDisabled = yield* finalizeIntegrationRun(
				makeIntegration(),
				ImportRunId.make("run_1"),
			);

			vitestExpect(wasDisabled).toBe(true);
			vitestExpect(yield* (yield* FakeIntegrationUpdates).updates).toEqual([
				{ runId: "run_1", userId: "user_1", isDisabled: true, integrationId: "int_1" },
			]);
		}),
	);
});

layer(
	makeWorkerLayer({
		runStatus: "failed",
		recentStatuses: Array.from({ length: 5 }, () => ({ status: "failed" as const })),
	}),
)((test) => {
	test.effect("does not claim a second disable transition after a concurrent run wins", () =>
		Effect.gen(function* () {
			const wasDisabled = yield* finalizeIntegrationRun(
				makeIntegration(),
				ImportRunId.make("run_1"),
			);
			vitestExpect(wasDisabled).toBe(false);
		}),
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
	test.effect("does not disable integrations when recent runs are not all failures", () =>
		Effect.gen(function* () {
			const wasDisabled = yield* finalizeIntegrationRun(
				makeIntegration(),
				ImportRunId.make("run_1"),
			);

			vitestExpect(wasDisabled).toBe(false);
			vitestExpect(yield* (yield* FakeIntegrationUpdates).updates).toEqual([]);
		}),
	);
});
