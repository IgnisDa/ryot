import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import {
	type DeclareInterestBody,
	type EntityUpdatedReason,
	MAX_INTEREST_ENTITY_IDS,
} from "@ryot/contract/modules/entity-interest/messages";
import type { EntityId, UserId } from "@ryot/contract/schema/brands";
import {
	buildEntityInterestDocument,
	decodeEntityInterestResponse,
	type EntityInterestRow,
} from "@ryot/ryotql-recipes/entities";
import { Context, Effect, Layer, Result } from "effect";

import { EntityPopulationTrigger } from "#modules/entities/population-trigger";
import { TranslationsService } from "#modules/entity-translation/service";
import { RyotQLService } from "#modules/ryotql/service";
import { MAX_ROOT_PAGE_SIZE } from "#modules/ryotql/validator";

import { StreamRegistry } from "./registry";

const chunk = <T>(items: readonly T[], size: number): T[][] => {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
};

type TerminalUpdate = { readonly entityId: EntityId; readonly reason: EntityUpdatedReason };

export class InterestReconciler extends Context.Service<InterestReconciler>()(
	"InterestReconciler",
	{
		make: Effect.gen(function* () {
			const ryotql = yield* RyotQLService;
			const translations = yield* TranslationsService;
			const populationTrigger = yield* EntityPopulationTrigger;

			const handleRow = (
				user: CurrentUserValue,
				row: EntityInterestRow,
			): Effect.Effect<TerminalUpdate | null> =>
				Effect.gen(function* () {
					if (row.populatedAt === null) {
						if (row.externalId !== null && row.providerId !== null) {
							yield* populationTrigger.request({
								userId: user.id,
								entityId: row.id,
								origin: { kind: "api" },
								externalId: row.externalId,
								entitySchemaSlug: row.entitySchemaSlug,
								providerId: row.providerId,
							});
							return null;
						}
						return { entityId: row.id, reason: "populated" };
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
					};
				});

			const reconcile = Effect.fn("InterestReconciler.reconcile")(function* (
				user: CurrentUserValue,
				entityIds: readonly string[],
			) {
				if (entityIds.length === 0) {
					return [] as TerminalUpdate[];
				}
				const terminal: TerminalUpdate[] = [];
				for (const ids of chunk(entityIds, MAX_ROOT_PAGE_SIZE)) {
					const [firstId, ...restIds] = ids;
					if (firstId === undefined) {
						continue;
					}
					const doc = buildEntityInterestDocument({ entityIds: [firstId, ...restIds] });
					const response = yield* ryotql.execute(user, doc);
					const rows = yield* Effect.sync(() =>
						Result.getOrThrow(decodeEntityInterestResponse(response)),
					);
					for (const row of rows) {
						const result = yield* handleRow(user, row);
						if (result) {
							terminal.push(result);
						}
					}
				}
				return terminal;
			});

			return { reconcile };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export class InterestService extends Context.Service<InterestService>()("InterestService", {
	make: Effect.gen(function* () {
		const registry = yield* StreamRegistry;
		const reconciler = yield* InterestReconciler;

		const setInterest = Effect.fn("InterestService.setInterest")(function* (input: {
			userId: UserId;
			streamId: string;
			entityIds: readonly string[];
		}) {
			const entityIds = input.entityIds.slice(0, MAX_INTEREST_ENTITY_IDS);
			if (entityIds.length < input.entityIds.length) {
				yield* Effect.logWarning("interest set truncated").pipe(
					Effect.annotateLogs({
						streamId: input.streamId,
						cap: MAX_INTEREST_ENTITY_IDS,
						declared: input.entityIds.length,
					}),
				);
			}
			yield* registry.setInterestIfOwner(input.streamId, input.userId, entityIds);
			return entityIds;
		});

		const declareInterest = Effect.fn("InterestService.declareInterest")(function* (
			user: CurrentUserValue,
			payload: DeclareInterestBody,
		) {
			const entityIds = yield* setInterest({
				userId: user.id,
				streamId: payload.streamId,
				entityIds: payload.entityIds,
			});
			const terminal = yield* reconciler
				.reconcile(user, entityIds)
				.pipe(
					Effect.catch((error) =>
						Effect.logWarning("interest reconcile failed", error).pipe(Effect.as([])),
					),
				);
			return {
				terminal: terminal.filter((update) =>
					registry.hasInterest(payload.streamId, update.entityId),
				),
			};
		});

		return { setInterest, declareInterest };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
