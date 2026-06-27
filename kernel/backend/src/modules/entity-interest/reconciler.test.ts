import { expect, it } from "@effect/vitest";
import type { RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { EntityPopulationTrigger } from "#modules/entities/population-trigger";
import { TranslationsService } from "#modules/entity-translation/service";
import { RyotQLService } from "#modules/ryotql/service";

import { InterestReconciler } from "./reconciler";

const principal = { preferredLanguage: "es", userId: UserId.make("user-1") };

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
				pageInfo: { hasMore: false, limit: items.length, nextCursor: null },
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

it.effect("omits IDs filtered from the visible rows", () => {
	const populationRequests: unknown[] = [];
	const layer = InterestReconciler.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.mock(RyotQLService)({
					executeForUser: () =>
						Effect.succeed(
							responseWithItems([
								row("entity-1", { populationStatus: "pending", translationStatus: "none" }),
							]),
						),
				}),
				Layer.mock(EntityPopulationTrigger)({
					request: (input) =>
						Effect.sync(() => {
							populationRequests.push(input);
						}),
				}),
				Layer.mock(TranslationsService)({ requestFill: () => Effect.void }),
			),
		),
	);

	return Effect.gen(function* () {
		const reconciler = yield* InterestReconciler;
		const result = yield* reconciler.reconcile(principal, ["entity-1", "missing-entity"]);

		expect(result).toEqual({ terminal: [], reconciledEntityIds: ["entity-1"] });
		expect(populationRequests).toHaveLength(1);
	}).pipe(Effect.provide(layer));
});

it.effect("returns terminal rows and enqueues pending translations", () => {
	const translationEntityIds: EntityId[] = [];
	const layer = InterestReconciler.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.mock(RyotQLService)({
					executeForUser: () =>
						Effect.succeed(
							responseWithItems([
								row("entity-1"),
								row("entity-2", { translationStatus: "pending" }),
							]),
						),
				}),
				Layer.mock(EntityPopulationTrigger)({ request: () => Effect.void }),
				Layer.mock(TranslationsService)({
					requestFill: ({ entityId }) =>
						Effect.sync(() => {
							translationEntityIds.push(entityId);
						}),
				}),
			),
		),
	);

	return Effect.gen(function* () {
		const reconciler = yield* InterestReconciler;
		const result = yield* reconciler.reconcile(principal, ["entity-1", "entity-2"]);

		expect(result.terminal).toEqual([{ entityId: "entity-1", reason: "translated" }]);
		expect(translationEntityIds).toEqual(["entity-2"]);
	}).pipe(Effect.provide(layer));
});
