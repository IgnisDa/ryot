import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { RyotQLBadRequest } from "@ryot/contract/modules/ryotql/contract";
import { EntityId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { InterestReconciler } from "./reconciler";
import { InterestService } from "./service";
import { EntityInterestStore } from "./store";

const user = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-1"),
	preferences: { allowNsfw: false, language: "es", disableIntegrations: false },
} satisfies CurrentUserValue;

it.effect("removes filtered memberships and carries tokens for terminal updates", () => {
	const events: string[] = [];
	const pending = Array.from({ length: 101 }, (_, index) => ({
		revision: index === 100 ? 2 : 1,
		entityId: `entity-${index}`,
	}));
	const store = Layer.mock(EntityInterestStore)({
		removePending: ({ pending: chunk }) =>
			Effect.sync(() => {
				events.push(`remove:${chunk.map(({ entityId }) => entityId).join(",")}`);
				return chunk.map(({ entityId }) => entityId);
			}),
		markReconciled: ({ pending: chunk }) =>
			Effect.sync(() => {
				events.push(`mark:${chunk.length}`);
				return chunk.map(({ entityId }) => entityId);
			}),
	});
	const reconciler = Layer.mock(InterestReconciler)({
		reconcile: (_user: CurrentUserValue, entityIds: readonly string[]) =>
			Effect.sync(() => {
				events.push(`reconcile:${entityIds.length}`);
				return {
					reconciledEntityIds: entityIds
						.filter((entityId) => entityId !== "entity-99")
						.map((entityId) => EntityId.make(entityId)),
					terminal: entityIds
						.filter((entityId) => entityId !== "entity-99")
						.map((entityId) => ({
							reason: "populated" as const,
							entityId: EntityId.make(entityId),
						})),
				};
			}),
	});
	const layer = InterestService.layer.pipe(Layer.provide(Layer.mergeAll(store, reconciler)));

	return Effect.gen(function* () {
		const service = yield* InterestService;
		const result = yield* service.reconcile({ user, pending, sessionId: "session-1" });

		expect(events).toEqual([
			"reconcile:100",
			"remove:entity-99",
			"mark:0",
			"reconcile:1",
			"remove:",
			"mark:0",
		]);
		expect(result).toHaveLength(100);
		expect(result.some(({ message }) => message.entityId === "entity-99")).toBe(false);
		expect(result.at(-1)).toEqual({
			pending: { entityId: "entity-100", revision: 2 },
			message: { type: "entity-updated", entityId: "entity-100", reason: "populated" },
		});
	}).pipe(Effect.provide(layer));
});

it.effect("does not catch reconciliation failures", () => {
	const error = new RyotQLBadRequest({ reason: { code: "invalid-query" } });
	const store = Layer.mock(EntityInterestStore)({});
	const reconciler = Layer.mock(InterestReconciler)({ reconcile: () => Effect.fail(error) });
	const layer = InterestService.layer.pipe(Layer.provide(Layer.mergeAll(store, reconciler)));

	return Effect.gen(function* () {
		const service = yield* InterestService;
		expect(
			yield* Effect.flip(
				service.reconcile({
					user,
					sessionId: "session-1",
					pending: [{ entityId: "entity-1", revision: 1 }],
				}),
			),
		).toBe(error);
	}).pipe(Effect.provide(layer));
});

it.effect("sets test membership without reconciliation", () => {
	let reconciled: unknown;
	let replacement: unknown;
	const store = Layer.mock(EntityInterestStore)({
		getSessionMetadata: () =>
			Effect.succeed([
				{ sessionId: "session-1", revision: 3, userId: user.id, preferredLanguage: "es" },
			]),
		replaceInterest: (input) =>
			Effect.sync(() => {
				replacement = input;
				return {
					revision: 4,
					status: "applied" as const,
					pending: [{ entityId: "entity-1", revision: 4 }],
				};
			}),
		markReconciled: (input) =>
			Effect.sync(() => {
				reconciled = input;
				return [];
			}),
	});
	const reconciler = Layer.mock(InterestReconciler)({
		reconcile: () => Effect.die("must not reconcile"),
	});
	const layer = InterestService.layer.pipe(Layer.provide(Layer.mergeAll(store, reconciler)));

	return Effect.gen(function* () {
		const service = yield* InterestService;
		yield* service.setEntityInterestMembership({
			sessionId: "session-1",
			entityIds: ["entity-1"],
		});
		expect(reconciled).toEqual({
			sessionId: "session-1",
			pending: [{ entityId: "entity-1", revision: 4 }],
		});
		expect(replacement).toEqual({
			revision: 4,
			sessionId: "session-1",
			entityIds: ["entity-1"],
		});
	}).pipe(Effect.provide(layer));
});
