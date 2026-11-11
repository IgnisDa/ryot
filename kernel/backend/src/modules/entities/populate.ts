import type { PopulateEntitiesBody } from "@ryot-app/contract/modules/live-updates/messages";
import type { SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import {
	entityWatchRecipe,
	type EntityWatchResult,
	loadEntityWatches,
} from "@ryot-app/ryotql-recipes/entities";
import { Array as Arr, Context, DateTime, Effect, Layer } from "effect";

import { DefinitionRepository } from "#modules/definitions/repository";
import { RyotQLService } from "#modules/ryotql/service";

import { TranslationsService } from "./localization/service";
import {
	EntityPopulationTrigger,
	type PopulationExecution,
	userPopulationRequest,
} from "./population-trigger";
import { EntityRetentionRepository } from "./retention/repository";

type WatchedEntity = EntityWatchResult[number];

type ProvidedEntity = WatchedEntity & {
	readonly externalId: string;
	readonly providerId: SandboxProviderId;
};
type PopulatePrincipal = {
	readonly userId: UserId;
	readonly accountUserId: UserId;
	readonly preferredLanguage: null | string;
};

const missingData = (status: WatchedEntity["populationStatus"]) =>
	(status.availability === "missing" || status.availability === "partial") &&
	status.state === "idle";

/** A stale entity gets one refresh try per day, so a provider that keeps failing is not asked on every page view. */
const refreshAttempt = (populatedAt: string, now: DateTime.Utc) =>
	`stale:${populatedAt}:${DateTime.formatIsoDate(now)}`;

/**
 * Turns one page's ask into provider work. Missing data and data older than its schema's refresh interval queue a job per
 * entity; everything else costs nothing.
 */
export class EntityPopulation extends Context.Service<EntityPopulation>()(
	"@ryot-app/kernel-backend/modules/entities/populate/EntityPopulation",
	{
		make: Effect.gen(function* () {
			const ryotql = yield* RyotQLService;
			const definitions = yield* DefinitionRepository;
			const retention = yield* EntityRetentionRepository;
			const translations = yield* TranslationsService;
			const trigger = yield* EntityPopulationTrigger;

			const refreshIntervals = (rows: ReadonlyArray<WatchedEntity>) =>
				definitions.findEntitySchemaRefreshIntervals(
					Arr.dedupeWith(
						rows.flatMap(({ entitySchemaSlug, entitySchemaPluginId }) =>
							entitySchemaPluginId === null
								? []
								: [{ slug: entitySchemaSlug, pluginId: entitySchemaPluginId }],
						),
						(left, right) => left.slug === right.slug && left.pluginId === right.pluginId,
					),
				);

			const request = Effect.fn("EntityPopulation.request")(function* (
				principal: PopulatePrincipal,
				body: PopulateEntitiesBody,
			) {
				const [first, ...rest] = body.entityIds;
				if (first === undefined) {
					return;
				}
				const recipe = entityWatchRecipe;
				const rows = yield* loadEntityWatches([first, ...rest], (entityIds) =>
					Effect.gen(function* () {
						const response = yield* ryotql.executeForUser(
							principal.userId,
							principal.preferredLanguage,
							"kernel",
							{ arguments: { entityIds }, source: { kind: "inline", document: recipe.document } },
						);
						return yield* Effect.fromResult(recipe.decode(response)).pipe(Effect.orDie);
					}),
				);
				yield* retention.retain(rows.map(({ id }) => id));
				const intervals = yield* refreshIntervals(rows);
				const now = yield* DateTime.now;
				const interactive = body.priority === "interactive";

				const populate = (row: ProvidedEntity, execution: PopulationExecution) =>
					userPopulationRequest({
						execution,
						entityId: row.id,
						userId: row.userId,
						lane: body.priority,
						externalId: row.externalId,
						providerId: row.providerId,
						initiator: principal.userId,
						entitySchemaSlug: row.entitySchemaSlug,
						accountUserId: principal.accountUserId,
						entitySchemaPluginId: row.entitySchemaPluginId,
					}).pipe(Effect.flatMap(trigger.request));

				const staleSince = (row: WatchedEntity) => {
					const days = intervals.get(`${row.entitySchemaPluginId}:${row.entitySchemaSlug}`);
					if (days === undefined || row.populatedAt === null) {
						return null;
					}
					const expires = DateTime.add(DateTime.makeUnsafe(row.populatedAt), { days });
					return DateTime.isGreaterThan(now, expires) ? row.populatedAt : null;
				};

				yield* Effect.forEach(
					rows,
					(row) =>
						Effect.gen(function* () {
							const { externalId, providerId } = row;
							if (externalId !== null && providerId !== null) {
								const provided = { ...row, externalId, providerId };
								const populatedAt = staleSince(row);
								if (missingData(row.populationStatus)) {
									return yield* populate(provided, { level: interactive ? "full" : "base" });
								}
								if (populatedAt !== null && row.populationStatus.state === "idle") {
									return yield* populate(provided, {
										mode: "refresh",
										level: interactive ? "full" : "base",
										attempt: refreshAttempt(populatedAt, now),
									});
								}
								if (
									interactive &&
									row.populatedAt !== null &&
									missingData(row.relatedPopulationStatus)
								) {
									return yield* populate(provided, { level: "full" });
								}
							}
							if (
								principal.preferredLanguage !== null &&
								row.externalId !== null &&
								row.providerId !== null &&
								row.translationStatus.availability === "missing" &&
								row.translationStatus.state === "idle"
							) {
								return yield* translations
									.requestFill({
										entityId: row.id,
										lane: body.priority,
										userId: principal.userId,
										externalId: row.externalId,
										providerId: row.providerId,
										language: principal.preferredLanguage,
										entitySchemaSlug: row.entitySchemaSlug,
										entitySchemaPluginId: row.entitySchemaPluginId,
									})
									.pipe(
										Effect.catchTag("SandboxRunError", (error) =>
											error.kind === "missing-artifact" || error.kind === "invalid-input"
												? Effect.succeed(false)
												: Effect.fail(error),
										),
									);
							}
							return false;
						}),
					{ discard: true },
				);
			});

			return { request };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
