import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { reject } from "@ryot-app/plugin-backend-sdk/operation";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	executeRyotqlRecipe,
	literal,
	parameters,
	readAllRyotqlPages,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";

import { propertyText } from "../../shared/entity-selections";
import { mediaReviewConsumptionSlugs } from "../../shared/media-review-operations";
import { catalogMessage } from "../../shared/messages.generated";

const reviewConsumptionRecipe = (() => {
	const inputParameters = parameters({
		fields: {
			eventId: {
				type: "string",
				validation: { required: true },
				description: "Event Id for this selection",
				label: catalogMessage("query-parameter.event"),
			},
		},
	});
	const event = table("event", "reviewConsumption");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ consumption }) => Result.succeed(consumption),
		queries: {
			consumption: selectedOptionalRow(event, {
				orderBy: [ascending(column(event, "id"))],
				where: and(
					eq(column(event, "id"), inputParameters.value("eventId")),
					schemaOwnerPredicate(event, "eventSchemaPluginId", { kind: "self" }),
				),
				selection: {
					entityId: selectedField(column(event, "entityId"), Schema.String),
					eventSchemaSlug: selectedField(column(event, "eventSchemaSlug"), Schema.String),
				},
			}),
		},
	});
})();
const reviewableSlugs = new Set<string>(mediaReviewConsumptionSlugs);

/** A review may name one completion, progress or status record of the entity it is written on. */
export const requireReviewConsumption = (
	host: Pick<ScriptHost, "executeRyotql">,
	input: { readonly eventId: string; readonly entityId: string },
) =>
	Effect.gen(function* () {
		const consumption = yield* executeRyotqlRecipe(host.executeRyotql, reviewConsumptionRecipe, {
			eventId: input.eventId,
		});
		if (consumption === undefined) {
			return yield* reject(catalogMessage("rejection.review.consumption-not-found"));
		}
		if (!reviewableSlugs.has(consumption.eventSchemaSlug)) {
			return yield* reject(catalogMessage("rejection.review.consumption-not-reviewable"));
		}
		if (consumption.entityId !== input.entityId) {
			return yield* reject(catalogMessage("rejection.review.consumption-other-entity"));
		}
		return yield* Effect.void;
	});
const reviewsOfConsumptionRecipe = (() => {
	const inputParameters = parameters({
		fields: {
			eventId: {
				type: "string",
				validation: { required: true },
				description: "Event Id for this selection",
				label: catalogMessage("query-parameter.event"),
			},
		},
	});
	const review = table("event", "consumptionReview");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ reviews }) => Result.succeed(reviews),
		queries: {
			reviews: selectedRows(review, {
				limit: 100,
				orderBy: [ascending(column(review, "id"))],
				selection: { id: selectedField(column(review, "id"), Schema.String) },
				where: and(
					schemaOwnerPredicate(review, "eventSchemaPluginId", { kind: "self" }),
					eq(column(review, "eventSchemaSlug"), literal("review")),
					eq(propertyText(review, "consumptionEventId"), inputParameters.value("eventId")),
				),
			}),
		},
	});
})();
/** The reviews that name `eventId`, which must stop naming it once it is no longer a record of their entity. */
export const reviewsNamingConsumption = (
	host: Pick<ScriptHost, "executeRyotql">,
	eventId: string,
) =>
	readAllRyotqlPages((after) =>
		executeRyotqlRecipe(
			host.executeRyotql,
			reviewsOfConsumptionRecipe,
			{ eventId: eventId },
			{ pages: { reviews: { after: after } } },
		),
	).pipe(Effect.map((reviews) => reviews.map(({ id }) => id)));
