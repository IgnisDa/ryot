import { expect, layer } from "@effect/vitest";
import type { RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

import { type RequestFillInput, TranslationsService } from "#modules/entities/localization/service";
import { EntityPopulationTrigger } from "#modules/entities/population-trigger";
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
	readonly entitySchemaPluginId: string | null;
	readonly userId: string | null;
	readonly populationStatus: "none" | "pending" | "ready" | "failed";
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
	userId: "user-1",
	providerId: "provider-1",
	properties: { title: id },
	populationStatus: "ready",
	entitySchemaSlug: "record",
	translationStatus: "ready",
	externalId: `external-${id}`,
	entitySchemaPluginId: "private-plugin",
	...overrides,
});

class FakeInterestFollowUps extends Context.Service<
	FakeInterestFollowUps,
	{
		readonly populationRequests: Effect.Effect<ReadonlyArray<unknown>>;
		readonly translationRequests: Effect.Effect<ReadonlyArray<RequestFillInput>>;
	}
>()("test/FakeInterestFollowUps") {}

const reconcilerLayer = (items: readonly InterestItem[]) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const populationRequests = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const translationRequests = yield* Ref.make<ReadonlyArray<RequestFillInput>>([]);
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
							requestFill: (input) => Ref.update(translationRequests, (all) => [...all, input]),
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
				{
					userId: "user-1",
					entitySchemaPluginId: "private-plugin",
					command: {
						writeContext: null,
						causation: { lane: "interactive", initiator: { id: "user-1", kind: "user" } },
					},
				},
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
				expect(yield* (yield* FakeInterestFollowUps).translationRequests).toMatchObject([
					{ lane: "interactive", entityId: "entity-2", entitySchemaPluginId: "private-plugin" },
				]);
			}),
		);
	},
);

layer(
	reconcilerLayer([
		row("entity-1", { translationStatus: "none", populationStatus: "failed" }),
		row("entity-2", { populationStatus: "failed", translationStatus: "pending" }),
	]),
)((test) => {
	test.effect("completes failed populations without requesting population or translation", () =>
		Effect.gen(function* () {
			const reconciler = yield* InterestReconciler;
			const result = yield* reconciler.reconcile(principal, ["entity-1", "entity-2"]);

			expect(result.terminal).toEqual([
				{ entityId: "entity-1", reason: "population-failed" },
				{ entityId: "entity-2", reason: "population-failed" },
			]);
			const followUps = yield* FakeInterestFollowUps;
			expect(yield* followUps.populationRequests).toEqual([]);
			expect(yield* followUps.translationRequests).toEqual([]);
		}),
	);
});
