import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest } from "@ryot/contract/errors";
import { EntityId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { InterestReconciler } from "./reconciler";
import { InterestService } from "./service";
import { EntityInterestStore } from "./store";

const user = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-1"),
	preferences: { allowNsfw: false, language: "es", disableIntegrations: false },
} satisfies CurrentUserValue;

it.effect("reconciles only pending IDs and marks each chunk after its enqueues", () => {
	const events: string[] = [];
	const pendingEntityIds = Array.from({ length: 101 }, (_, index) => `entity-${index}`);
	const store = Layer.mock(EntityInterestStore)({
		replaceInterest: () => Effect.succeed({ generation: 4, pendingEntityIds }),
		hasInterest: (_streamId: string, entityId: string) => Effect.succeed(entityId !== "entity-100"),
		markReconciled: ({ entityIds }: { entityIds: readonly string[] }) =>
			Effect.sync(() => {
				events.push(`mark:${entityIds.length}`);
				return true;
			}),
	});
	const reconciler = Layer.mock(InterestReconciler)({
		reconcile: (_user: CurrentUserValue, entityIds: readonly string[]) =>
			Effect.sync(() => {
				events.push(`reconcile:${entityIds.length}`);
				return {
					reconciledEntityIds: entityIds.map((entityId) => EntityId.make(entityId)),
					terminal: entityIds.map((entityId) => ({
						reason: "populated" as const,
						entityId: EntityId.make(entityId),
					})),
				};
			}),
	});
	const layer = InterestService.layer.pipe(Layer.provide(Layer.mergeAll(store, reconciler)));

	return Effect.gen(function* () {
		const service = yield* InterestService;
		const result = yield* service.declareInterest(user, {
			streamId: "stream-1",
			entityIds: ["already-reconciled"],
		});

		expect(events).toEqual(["reconcile:100", "mark:100", "reconcile:1", "mark:1"]);
		expect(result.terminal).toHaveLength(100);
	}).pipe(Effect.provide(layer));
});

it.effect("stops reconciling remaining chunks when the declaration generation is stale", () => {
	let interestChecks = 0;
	const reconciledChunks: number[] = [];
	const pendingEntityIds = Array.from({ length: 101 }, (_, index) => `entity-${index}`);
	const store = Layer.mock(EntityInterestStore)({
		replaceInterest: () => Effect.succeed({ generation: 4, pendingEntityIds }),
		markReconciled: () => Effect.succeed(false),
		hasInterest: () =>
			Effect.sync(() => {
				interestChecks += 1;
				return true;
			}),
	});
	const reconciler = Layer.mock(InterestReconciler)({
		reconcile: (_user: CurrentUserValue, entityIds: readonly string[]) =>
			Effect.sync(() => {
				reconciledChunks.push(entityIds.length);
				return {
					reconciledEntityIds: entityIds.map((entityId) => EntityId.make(entityId)),
					terminal: entityIds.map((entityId) => ({
						reason: "populated" as const,
						entityId: EntityId.make(entityId),
					})),
				};
			}),
	});
	const layer = InterestService.layer.pipe(Layer.provide(Layer.mergeAll(store, reconciler)));

	return Effect.gen(function* () {
		const service = yield* InterestService;
		const result = yield* service.declareInterest(user, {
			streamId: "stream-1",
			entityIds: ["entity-1"],
		});

		expect(result.terminal).toEqual([]);
		expect(interestChecks).toBe(0);
		expect(reconciledChunks).toEqual([100]);
	}).pipe(Effect.provide(layer));
});

it.effect("does not catch reconciliation failures", () => {
	const error = new BadRequest({ message: "reconciliation failed" });
	const store = Layer.mock(EntityInterestStore)({
		replaceInterest: () => Effect.succeed({ generation: 4, pendingEntityIds: ["entity-1"] }),
	});
	const reconciler = Layer.mock(InterestReconciler)({
		reconcile: () => Effect.fail(error),
	});
	const layer = InterestService.layer.pipe(Layer.provide(Layer.mergeAll(store, reconciler)));

	return Effect.gen(function* () {
		const service = yield* InterestService;
		expect(
			yield* Effect.flip(
				service.declareInterest(user, { streamId: "stream-1", entityIds: ["entity-1"] }),
			),
		).toBe(error);
	}).pipe(Effect.provide(layer));
});
