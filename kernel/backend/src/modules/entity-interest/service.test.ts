import { expect, layer } from "@effect/vitest";
import { RyotQLBadRequest } from "@ryot-app/contract/modules/ryotql/contract";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

import { InterestReconciler } from "./reconciler";
import { InterestService } from "./service";
import { EntityInterestStore } from "./store";

const principal = {
	preferredLanguage: "es",
	userId: UserId.make("user-1"),
	accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
};

type Store = EntityInterestStore["Service"];
type Reply<Method extends (...args: never) => Effect.Effect<unknown, unknown>> = (
	...args: Parameters<Method>
) => Effect.Success<ReturnType<Method>>;

class FakeInterestCalls extends Context.Service<
	FakeInterestCalls,
	{
		readonly events: Effect.Effect<ReadonlyArray<string>>;
		readonly reconciled: Effect.Effect<ReadonlyArray<Parameters<Store["markReconciled"]>[0]>>;
		readonly replacements: Effect.Effect<ReadonlyArray<Parameters<Store["replaceInterest"]>[0]>>;
	}
>()("test/FakeInterestCalls") {}

const serviceLayer = (replies: {
	readonly reconcile: InterestReconciler["Service"]["reconcile"];
	readonly markReconciled?: Reply<Store["markReconciled"]>;
	readonly removePending?: Reply<Store["removePending"]>;
	readonly replaceInterest?: Reply<Store["replaceInterest"]>;
	readonly getSessionMetadata?: Store["getSessionMetadata"];
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const events = yield* Ref.make<ReadonlyArray<string>>([]);
			const reconciled = yield* Ref.make<ReadonlyArray<Parameters<Store["markReconciled"]>[0]>>([]);
			const replacements = yield* Ref.make<ReadonlyArray<Parameters<Store["replaceInterest"]>[0]>>(
				[],
			);
			const event = (name: string) => Ref.update(events, (all) => [...all, name]);
			const { removePending, markReconciled, replaceInterest, getSessionMetadata } = replies;
			const store = Layer.mock(EntityInterestStore)({
				...(markReconciled && {
					markReconciled: (input) =>
						event(`mark:${input.pending.length}`).pipe(
							Effect.andThen(Ref.update(reconciled, (all) => [...all, input])),
							Effect.as(markReconciled(input)),
						),
				}),
				...(removePending && {
					removePending: (input) =>
						event(`remove:${input.pending.map(({ entityId }) => entityId).join(",")}`).pipe(
							Effect.as(removePending(input)),
						),
				}),
				...(replaceInterest && {
					replaceInterest: (input) =>
						Ref.update(replacements, (all) => [...all, input]).pipe(
							Effect.as(replaceInterest(input)),
						),
				}),
				...(getSessionMetadata && { getSessionMetadata }),
			});
			const reconciler = Layer.mock(InterestReconciler)({
				reconcile: (reconcilePrincipal, entityIds) =>
					event(`reconcile:${entityIds.length}`).pipe(
						Effect.andThen(replies.reconcile(reconcilePrincipal, entityIds)),
					),
			});
			return InterestService.layer.pipe(
				Layer.provide(Layer.mergeAll(store, reconciler)),
				Layer.merge(
					Layer.succeed(FakeInterestCalls, {
						events: Ref.get(events),
						reconciled: Ref.get(reconciled),
						replacements: Ref.get(replacements),
					}),
				),
			);
		}),
	);

const pending = Array.from({ length: 101 }, (_, index) => ({
	entityId: `entity-${index}`,
	revision: index === 100 ? 2 : 1,
}));

layer(
	serviceLayer({
		removePending: ({ pending: chunk }) => chunk.map(({ entityId }) => entityId),
		markReconciled: ({ pending: chunk }) => chunk.map(({ entityId }) => entityId),
		reconcile: (_principal, entityIds: readonly string[]) =>
			Effect.succeed({
				reconciledEntityIds: entityIds
					.filter((entityId) => entityId !== "entity-99")
					.map((entityId) => EntityId.make(entityId)),
				terminal: entityIds
					.filter((entityId) => entityId !== "entity-99")
					.map((entityId) => ({ reason: "populated" as const, entityId: EntityId.make(entityId) })),
			}),
	}),
)((test) => {
	test.effect("removes filtered memberships and carries tokens for terminal updates", () =>
		Effect.gen(function* () {
			const service = yield* InterestService;
			const result = yield* service.reconcile({ pending, principal, sessionId: "session-1" });

			expect(yield* (yield* FakeInterestCalls).events).toEqual([
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
				pending: { revision: 2, entityId: "entity-100" },
				message: { reason: "populated", type: "entity-updated", entityId: "entity-100" },
			});
		}),
	);
});

const reconciliationError = new RyotQLBadRequest({ reason: { code: "invalid-query" } });

layer(serviceLayer({ reconcile: () => Effect.fail(reconciliationError) }))((test) => {
	test.effect("does not catch reconciliation failures", () =>
		Effect.gen(function* () {
			const service = yield* InterestService;
			expect(
				yield* Effect.flip(
					service.reconcile({
						principal,
						sessionId: "session-1",
						pending: [{ revision: 1, entityId: "entity-1" }],
					}),
				),
			).toBe(reconciliationError);
		}),
	);
});

layer(
	serviceLayer({
		markReconciled: () => [],
		reconcile: () => Effect.die("must not reconcile"),
		replaceInterest: () => ({
			revision: 4,
			status: "applied" as const,
			pending: [{ revision: 4, entityId: "entity-1" }],
		}),
		getSessionMetadata: () =>
			Effect.succeed([
				{
					revision: 3,
					sessionId: "session-1",
					preferredLanguage: "es",
					userId: principal.userId,
					accountGeneration: principal.accountGeneration,
				},
			]),
	}),
)((test) => {
	test.effect("sets test membership without reconciliation", () =>
		Effect.gen(function* () {
			const service = yield* InterestService;
			yield* service.setEntityInterestMembership({
				sessionId: "session-1",
				entityIds: ["entity-1"],
			});
			const calls = yield* FakeInterestCalls;
			const [reconciled] = yield* calls.reconciled;
			const [replacement] = yield* calls.replacements;
			expect(reconciled).toEqual({
				sessionId: "session-1",
				pending: [{ revision: 4, entityId: "entity-1" }],
			});
			expect(replacement).toEqual({ revision: 4, sessionId: "session-1", entityIds: ["entity-1"] });
		}),
	);
});
