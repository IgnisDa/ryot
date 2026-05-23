import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import type { EntityUpdatedReason } from "@ryot/contract/modules/entity-interest/messages";
import type { EntityId } from "@ryot/contract/schema/brands";
import { entityInterestRecipe, type EntityInterestResult } from "@ryot/ryotql-recipes/entities";
import { Context, Effect, Layer, Result } from "effect";

import { EntityPopulationTrigger } from "#modules/entities/population-trigger";
import { TranslationsService } from "#modules/entity-translation/service";
import { RyotQLService } from "#modules/ryotql/service";

type TerminalUpdate = {
	readonly entityId: EntityId;
	readonly reason: EntityUpdatedReason;
};

type ReconciliationResult = {
	readonly terminal: readonly TerminalUpdate[];
	readonly reconciledEntityIds: readonly EntityId[];
};

export class InterestReconciler extends Context.Service<InterestReconciler>()(
	"InterestReconciler",
	{
		make: Effect.gen(function* () {
			const ryotql = yield* RyotQLService;
			const translations = yield* TranslationsService;
			const populationTrigger = yield* EntityPopulationTrigger;

			const handleRow = (user: CurrentUserValue, row: EntityInterestResult[number]) =>
				Effect.gen(function* () {
					if (row.populatedAt === null) {
						if (row.externalId !== null && row.providerId !== null) {
							yield* populationTrigger.request({
								userId: user.id,
								entityId: row.id,
								origin: { kind: "api" },
								externalId: row.externalId,
								providerId: row.providerId,
								entitySchemaSlug: row.entitySchemaSlug,
							});
							return null;
						}
						return { entityId: row.id, reason: "populated" } satisfies TerminalUpdate;
					}

					if (row.translationStatus === "pending") {
						if (
							user.preferences.language !== null &&
							row.externalId !== null &&
							row.providerId !== null
						) {
							yield* translations.requestFill({
								entityId: row.id,
								externalId: row.externalId,
								properties: row.properties,
								providerId: row.providerId,
								language: user.preferences.language,
								entitySchemaSlug: row.entitySchemaSlug,
							});
						}
						return null;
					}

					return {
						entityId: row.id,
						reason: row.translationStatus === "ready" ? "translated" : "populated",
					} satisfies TerminalUpdate;
				});

			const reconcile = Effect.fn("InterestReconciler.reconcile")(function* (
				user: CurrentUserValue,
				entityIds: readonly string[],
			) {
				const [firstId, ...restIds] = entityIds;
				if (firstId === undefined) {
					return {
						terminal: [],
						reconciledEntityIds: [],
					} satisfies ReconciliationResult;
				}

				const recipe = entityInterestRecipe({ entityIds: [firstId, ...restIds] });
				const response = yield* ryotql.execute(user, recipe.document);
				const rows = yield* Effect.sync(() => Result.getOrThrow(recipe.decode(response)));
				const terminal: TerminalUpdate[] = [];
				for (const row of rows) {
					const result = yield* handleRow(user, row);
					if (result) {
						terminal.push(result);
					}
				}
				return {
					terminal,
					reconciledEntityIds: rows.map(({ id }) => id),
				} satisfies ReconciliationResult;
			});

			return { reconcile };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
