import { expect, layer } from "@effect/vitest";
import type { RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

import { EntityPopulationTrigger } from "#modules/entities/population-trigger";
import { type RequestFillInput, TranslationsService } from "#modules/entity-translation/service";
import { RyotQLService } from "#modules/ryotql/service";

import { InterestReconciler } from "./reconciler";

const principal = {
	preferredLanguage: "es",
	userId: UserId.make("user-1"),
	accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
};

type InterestItem = {
	readonly id: string;
	readonly externalId: string;
	readonly providerId: string;
	readonly properties: object;
	readonly entitySchemaSlug: string;
	readonly populationStatus: "none" | "pending" | "ready";
	readonly translationStatus: "none" | "pending" | "ready";
};

const responseWithItems = (items: readonly InterestItem[]) =>
	({
		data: {
			entities: {
				items,
				type: "rows",
				pageInfo: { hasMore: false, nextCursor: null, limit: items.length },
			},
		},
	}) satisfies RyotQLResponse;

const row = (id: string, overrides: Partial<InterestItem> = {}): InterestItem => ({
	id,
	providerId: "provider-1",
	properties: { title: id },
	populationStatus: "ready",
	entitySchemaSlug: "record",
	translationStatus: "ready",
	externalId: `external-${id}`,
	...overrides,
});

class FakeInterestFollowUps extends Context.Service<
	FakeInterestFollowUps,
	{
		readonly populationRequests: Effect.Effect<ReadonlyArray<unknown>>;
		readonly translationRequests: Effect.Effect<
			ReadonlyArray<Pick<RequestFillInput, "entityId" | "lane">>
		>;
	}
>()("test/FakeInterestFollowUps") {}

const reconcilerLayer = (items: readonly InterestItem[]) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const populationRequests = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const translationRequests = yield* Ref.make<
				ReadonlyArray<Pick<RequestFillInput, "entityId" | "lane">>
			>([]);
			return InterestReconciler.layer.pipe(
				Layer.provide(
					Layer.mergeAll(
						Layer.mock(RyotQLService)({
							executeForUser: () => Effect.succeed(responseWithItems(items)),
						}),
						Layer.mock(EntityPopulationTrigger)({
							request: (input) => Ref.update(populationRequests, (all) => [...all, input]),
						}),
						Layer.mock(TranslationsService)({
							requestFill: ({ lane, entityId }) =>
								Ref.update(translationRequests, (all) => [...all, { lane, entityId }]),
						}),
					),
				),
				Layer.merge(
					Layer.succeed(FakeInterestFollowUps, {
						populationRequests: Ref.get(populationRequests),
						translationRequests: Ref.get(translationRequests),
					}),
				),
			);
		}),
	);

layer(
	reconcilerLayer([row("entity-1", { translationStatus: "none", populationStatus: "pending" })]),
)((test) => {
	test.effect("omits IDs filtered from the visible rows", () =>
		Effect.gen(function* () {
			const reconciler = yield* InterestReconciler;
			const result = yield* reconciler.reconcile(principal, ["entity-1", "missing-entity"]);

			expect(result).toEqual({ terminal: [], reconciledEntityIds: ["entity-1"] });
			expect(yield* (yield* FakeInterestFollowUps).populationRequests).toMatchObject([
				{ command: { causation: { lane: "interactive" } } },
			]);
		}),
	);
});

layer(reconcilerLayer([row("entity-1"), row("entity-2", { translationStatus: "pending" })]))(
	(test) => {
		test.effect("returns terminal rows and enqueues pending translations", () =>
			Effect.gen(function* () {
				const reconciler = yield* InterestReconciler;
				const result = yield* reconciler.reconcile(principal, ["entity-1", "entity-2"]);

				expect(result.terminal).toEqual([{ entityId: "entity-1", reason: "translated" }]);
				expect(yield* (yield* FakeInterestFollowUps).translationRequests).toEqual([
					{ lane: "interactive", entityId: "entity-2" },
				]);
			}),
		);
	},
);
