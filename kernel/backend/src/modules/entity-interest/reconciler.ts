import type { EntityUpdatedReason } from "@ryot-app/contract/modules/entity-interest/messages";
import {
	AutomationExecutionId,
	type EntityId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { entityInterestRecipe, type EntityInterestResult } from "@ryot-app/ryotql-recipes/entities";
import { Context, DateTime, Effect, Layer, Result } from "effect";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { EntityPopulationTrigger } from "#modules/entities/population-trigger";
import { TranslationsService } from "#modules/entity-translation/service";
import { RyotQLService } from "#modules/ryotql/service";

type TerminalUpdate = { readonly entityId: EntityId; readonly reason: EntityUpdatedReason };

type ReconciliationResult = {
	readonly terminal: readonly TerminalUpdate[];
	readonly reconciledEntityIds: readonly EntityId[];
};

export type InterestPrincipal = {
	readonly userId: UserId;
	readonly preferredLanguage: string | null;
};

export class InterestReconciler extends Context.Service<InterestReconciler>()(
	"InterestReconciler",
	{
		make: Effect.gen(function* () {
			const ryotql = yield* RyotQLService;
			const translations = yield* TranslationsService;
			const populationTrigger = yield* EntityPopulationTrigger;

			const handleRow = (principal: InterestPrincipal, row: EntityInterestResult[number]) =>
				Effect.gen(function* () {
					if (
						row.populationStatus === "pending" &&
						row.externalId !== null &&
						row.providerId !== null
					) {
						const executionId = `populate-${row.id}`;
						yield* populationTrigger.request({
							entityId: row.id,
							userId: principal.userId,
							externalId: row.externalId,
							providerId: row.providerId,
							entitySchemaSlug: row.entitySchemaSlug,
							command: rootLifecycleCommand({
								source: "api",
								itemIdentity: executionId,
								initiator: { kind: "user", id: principal.userId },
								executionId: AutomationExecutionId.make(executionId),
								occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
							}),
						});
						return null;
					}

					if (row.translationStatus === "pending") {
						if (
							principal.preferredLanguage !== null &&
							row.externalId !== null &&
							row.providerId !== null
						) {
							yield* translations.requestFill({
								entityId: row.id,
								userId: principal.userId,
								externalId: row.externalId,
								properties: row.properties,
								providerId: row.providerId,
								language: principal.preferredLanguage,
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
				principal: InterestPrincipal,
				entityIds: readonly string[],
			) {
				const [firstId, ...restIds] = entityIds;
				if (firstId === undefined) {
					return { terminal: [], reconciledEntityIds: [] } satisfies ReconciliationResult;
				}

				const recipe = entityInterestRecipe({ entityIds: [firstId, ...restIds] });
				const response = yield* ryotql.executeForUser(
					principal.userId,
					principal.preferredLanguage,
					"kernel",
					recipe.document,
				);
				const rows = yield* Effect.sync(() => Result.getOrThrow(recipe.decode(response)));
				const terminal: TerminalUpdate[] = [];
				for (const row of rows) {
					const result = yield* handleRow(principal, row);
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
