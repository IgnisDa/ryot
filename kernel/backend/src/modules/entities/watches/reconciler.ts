import type { EntityUpdatedReason } from "@ryot-app/contract/modules/entity-watches/messages";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import type { EntityId, SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import { entityWatchRecipe, type EntityWatchResult } from "@ryot-app/ryotql-recipes/entities";
import { Context, Effect, Layer, Result } from "effect";

import { TranslationsService } from "#modules/entities/localization/service";
import {
	EntityPopulationTrigger,
	type PopulationExecution,
	userPopulationRequest,
} from "#modules/entities/population-trigger";
import { RyotQLService } from "#modules/ryotql/service";

import type { InterestPriority } from "./store";

export type InterestPrincipal = {
	readonly userId: UserId;
	readonly preferredLanguage: null | string;
	readonly accountGeneration: AccountGeneration;
};

type TerminalUpdate = { readonly entityId: EntityId; readonly reason: EntityUpdatedReason };

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

			const requestPopulation = (
				principal: InterestPrincipal,
				row: EntityWatchResult[number] & { externalId: string; providerId: SandboxProviderId },
				execution: PopulationExecution,
			) =>
				userPopulationRequest({
					execution,
					entityId: row.id,
					userId: row.userId,
					externalId: row.externalId,
					providerId: row.providerId,
					initiator: principal.userId,
					entitySchemaSlug: row.entitySchemaSlug,
					entitySchemaPluginId: row.entitySchemaPluginId,
					accountGeneration: principal.accountGeneration,
				}).pipe(Effect.flatMap(populationTrigger.request));

			const handleRow = (
				principal: InterestPrincipal,
				row: EntityWatchResult[number],
				priority: InterestPriority,
			) =>
				Effect.gen(function* () {
					const { externalId, providerId } = row;
					if (externalId !== null && providerId !== null) {
						const provided = { ...row, externalId, providerId };
						if (
							(row.populationStatus.availability === "missing" ||
								row.populationStatus.availability === "partial") &&
							row.populationStatus.state === "idle"
						) {
							yield* requestPopulation(principal, provided, {
								level: priority === "foreground" ? "full" : "base",
							});
							return null;
						}
						if (
							priority === "foreground" &&
							row.populatedAt !== null &&
							(row.relatedPopulationStatus.availability === "missing" ||
								row.relatedPopulationStatus.availability === "partial") &&
							row.relatedPopulationStatus.state === "idle"
						) {
							yield* requestPopulation(principal, provided, { level: "full" });
						}
					}

					if (
						row.populationStatus.state === "failed" ||
						row.relatedPopulationStatus.state === "failed" ||
						row.translationStatus.state === "failed"
					) {
						return { entityId: row.id, reason: "enrichment-updated" } satisfies TerminalUpdate;
					}

					if (
						row.translationStatus.availability === "missing" &&
						row.translationStatus.state === "idle"
					) {
						if (
							principal.preferredLanguage !== null &&
							row.externalId !== null &&
							row.providerId !== null
						) {
							yield* translations
								.requestFill({
									entityId: row.id,
									lane: "interactive",
									userId: principal.userId,
									externalId: row.externalId,
									providerId: row.providerId,
									language: principal.preferredLanguage,
									entitySchemaSlug: row.entitySchemaSlug,
									entitySchemaPluginId: row.entitySchemaPluginId,
									accountGeneration: principal.accountGeneration,
								})
								.pipe(
									Effect.catchTag("SandboxRunError", (error) =>
										error.kind === "missing-artifact" || error.kind === "invalid-input"
											? Effect.void
											: Effect.fail(error),
									),
								);
						}
						return null;
					}

					return {
						entityId: row.id,
						reason:
							row.translationStatus.availability === "complete"
								? "translated"
								: "enrichment-updated",
					} satisfies TerminalUpdate;
				});

			const reconcile = Effect.fn("InterestReconciler.reconcile")(function* (
				principal: InterestPrincipal,
				interests: readonly { readonly entityId: string; readonly priority: InterestPriority }[],
			) {
				const [first, ...rest] = interests;
				if (first === undefined) {
					return { terminal: [], reconciledEntityIds: [] } satisfies ReconciliationResult;
				}
				const priorities = new Map(interests.map(({ entityId, priority }) => [entityId, priority]));

				const recipe = entityWatchRecipe({
					entityIds: [first.entityId, ...rest.map(({ entityId }) => entityId)],
				});
				const response = yield* ryotql.executeForUser(
					principal.userId,
					principal.preferredLanguage,
					"kernel",
					recipe.document,
				);
				const rows = yield* Effect.sync(() => Result.getOrThrow(recipe.decode(response)));
				const terminal: TerminalUpdate[] = [];
				for (const row of rows) {
					const result = yield* handleRow(principal, row, priorities.get(row.id) ?? "visible");
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
