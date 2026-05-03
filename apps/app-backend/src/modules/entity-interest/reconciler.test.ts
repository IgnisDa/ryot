import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import type { RyotQLResponse } from "@ryot/contract/modules/ryotql/language";
import type { EntityId } from "@ryot/contract/schema/brands";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { EntityPopulationTrigger } from "#modules/entities/population-trigger";
import { TranslationsService } from "#modules/entity-translation/service";
import { RyotQLService } from "#modules/ryotql/service";

import { InterestReconciler } from "./reconciler";

const user = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-1"),
	preferences: { isNsfw: false, language: "es", disableIntegrations: false },
} satisfies CurrentUserValue;

type InterestItem = {
	readonly id: { readonly kind: "text"; readonly value: string };
	readonly externalId: { readonly kind: "text"; readonly value: string };
	readonly providerId: { readonly kind: "text"; readonly value: string };
	readonly properties: { readonly kind: "json"; readonly value: unknown };
	readonly entitySchemaSlug: { readonly kind: "text"; readonly value: string };
	readonly populatedAt:
		| { readonly kind: "date"; readonly value: string }
		| { readonly kind: "null"; readonly value: null };
	readonly translationStatus: {
		readonly kind: "text";
		readonly value: "none" | "pending" | "ready";
	};
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
	id: { kind: "text", value: id },
	entitySchemaSlug: { kind: "text", value: "book" },
	providerId: { kind: "text", value: "provider-1" },
	properties: { kind: "json", value: { title: id } },
	translationStatus: { kind: "text", value: "ready" },
	externalId: { kind: "text", value: `external-${id}` },
	populatedAt: { kind: "date", value: "2026-08-14T00:00:00.000Z" },
	...overrides,
});

it.effect("reconciles missing IDs after all visible rows have been handled", () => {
	const populationRequests: unknown[] = [];
	const layer = InterestReconciler.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.mock(RyotQLService)({
					execute: () =>
						Effect.succeed(
							responseWithItems([
								row("entity-1", {
									populatedAt: { kind: "null", value: null },
									translationStatus: { kind: "text", value: "none" },
								}),
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
		const result = yield* reconciler.reconcile(user, ["entity-1", "missing-entity"]);

		expect(result).toEqual({
			terminal: [],
			reconciledEntityIds: ["entity-1", "missing-entity"],
		});
		expect(populationRequests).toHaveLength(1);
	}).pipe(Effect.provide(layer));
});

it.effect("returns terminal rows and enqueues pending translations", () => {
	const translationEntityIds: EntityId[] = [];
	const layer = InterestReconciler.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.mock(RyotQLService)({
					execute: () =>
						Effect.succeed(
							responseWithItems([
								row("entity-1"),
								row("entity-2", {
									translationStatus: { kind: "text", value: "pending" },
								}),
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
		const result = yield* reconciler.reconcile(user, ["entity-1", "entity-2"]);

		expect(result.terminal).toEqual([{ entityId: "entity-1", reason: "translated" }]);
		expect(translationEntityIds).toEqual(["entity-2"]);
	}).pipe(Effect.provide(layer));
});
