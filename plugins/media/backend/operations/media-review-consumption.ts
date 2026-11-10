import { EVENT_MUTATION_SANDBOX_LIMITS, type ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { OperationRejectedError } from "@ryot-app/plugin-backend-sdk/operation";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	executeRyotqlRecipe,
	literal,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";

import { propertyText } from "../../shared/entity-selections";
import { mediaReviewConsumptionSlugs } from "../../shared/media-review-operations";

const reviewConsumptionRecipe = defineRecipe((eventId: string) => {
	const event = table("event", "reviewConsumption");
	return {
		map: ({ consumption }) => Result.succeed(consumption),
		queries: {
			consumption: selectedOptionalRow(event, {
				orderBy: [ascending(column(event, "id"))],
				where: and(
					eq(column(event, "id"), literal(eventId)),
					schemaOwnerPredicate(event, "eventSchemaPluginId", { kind: "self" }),
				),
				selection: {
					entityId: selectedField(column(event, "entityId"), Schema.String),
					eventSchemaSlug: selectedField(column(event, "eventSchemaSlug"), Schema.String),
				},
			}),
		},
	};
});

const reviewableSlugs = new Set<string>(mediaReviewConsumptionSlugs);

/** A review may name one completion, progress or status record of the entity it is written on. */
export const requireReviewConsumption = (
	host: Pick<ScriptHost, "executeRyotql">,
	input: { readonly eventId: string; readonly entityId: string },
) =>
	Effect.gen(function* () {
		const consumption = yield* executeRyotqlRecipe(
			host.executeRyotql,
			reviewConsumptionRecipe(input.eventId),
		);
		if (consumption === undefined) {
			return yield* new OperationRejectedError({
				message: "The record this review is about no longer exists.",
			});
		}
		if (!reviewableSlugs.has(consumption.eventSchemaSlug)) {
			return yield* new OperationRejectedError({
				message: "A review can only be about a completion, progress or status record.",
			});
		}
		if (consumption.entityId !== input.entityId) {
			return yield* new OperationRejectedError({
				message: "A review can only be about a record of what it reviews.",
			});
		}
		return yield* Effect.void;
	});

const reviewsOfConsumptionRecipe = defineRecipe((eventId: string) => {
	const review = table("event", "consumptionReview");
	return {
		map: ({ reviews }) =>
			Result.succeed({ hasMore: reviews.pageInfo.hasMore, ids: reviews.items.map(({ id }) => id) }),
		queries: {
			reviews: selectedRows(review, {
				orderBy: [ascending(column(review, "id"))],
				limit: EVENT_MUTATION_SANDBOX_LIMITS.items - 1,
				selection: { id: selectedField(column(review, "id"), Schema.String) },
				where: and(
					schemaOwnerPredicate(review, "eventSchemaPluginId", { kind: "self" }),
					eq(column(review, "eventSchemaSlug"), literal("review")),
					eq(propertyText(review, "consumptionEventId"), literal(eventId)),
				),
			}),
		},
	};
});

/** The reviews that name `eventId`, which must stop naming it once it is no longer a record of their entity. */
export const reviewsNamingConsumption = (
	host: Pick<ScriptHost, "executeRyotql">,
	eventId: string,
) =>
	Effect.gen(function* () {
		const { ids, hasMore } = yield* executeRyotqlRecipe(
			host.executeRyotql,
			reviewsOfConsumptionRecipe(eventId),
		);
		if (hasMore) {
			return yield* new OperationRejectedError({
				message: "Too many reviews are about this record to move it.",
			});
		}
		return ids;
	});
