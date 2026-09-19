import { layer } from "@effect/vitest";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
import { expect as vitestExpect } from "vitest";

import { databaseLayer } from "#lib/test-utils/effect";
import { ImportsRepository } from "#modules/imports/repository";

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
	runStatus: "completed" | "failed";
	recentStatuses?: ReadonlyArray<{ status: "completed" | "failed" }>;
}) =>
	Layer.mergeAll(
		databaseLayer,
		mockImportsRepository({
			updateRun: () => Effect.void,
			getRunById: () => Effect.succeed(makeRun(input.runStatus)),
			listRecentStatusesByIntegrationId: () => Effect.succeed([...(input.recentStatuses ?? [])]),
		}),
		Layer.unwrap(
			Effect.gen(function* () {
				const updates = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([]);
				const record = (update: Record<string, unknown>) =>
					Ref.update(updates, (all) => [...all, update]);
				return Layer.merge(
					Layer.succeed(FakeIntegrationUpdates, { updates: Ref.get(updates) }),
					mockIntegrationsService({
						update: (userId, integrationId, body) =>
							record({ userId, integrationId, ...body }).pipe(Effect.as(makeIntegration())),
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
				lastFinishedAt: vitestExpect.any(Date),
			});
		}),
	);
});

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
