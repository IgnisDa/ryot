import { ReviewProperties } from "@ryot-app/contract/modules/events/review";
import { EntityId, EventId } from "@ryot-app/contract/schema/brands";
import {
	and,
	column,
	defineRecipe,
	descending,
	eq,
	isNull,
	literal,
	type Recipe,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

export const collectionReviewsRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			collectionId: {
				type: "string",
				label: "collectionId",
				description: "Query argument",
				validation: { required: true },
			},
		},
	});

	const event = table("event", "collectionReview");
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ reviews }) => Result.succeed(reviews),
		queries: {
			reviews: selectedRows(event, {
				limit: 20,
				maxLimit: 1000,
				orderBy: [
					descending(column(event, "occurredAt")),
					descending(column(event, "orderCreatedAt")),
					descending(column(event, "orderKey")),
				],
				where: and(
					eq(column(event, "entityId"), recipeParameters.value("collectionId")),
					eq(column(event, "eventSchemaSlug"), literal("review")),
					isNull(column(event, "eventSchemaPluginId")),
				),
				selection: {
					id: selectedField(column(event, "id"), EventId),
					entityId: selectedField(column(event, "entityId"), EntityId),
					occurredAt: selectedField(column(event, "occurredAt"), IsoDateString),
					properties: selectedField(column(event, "properties"), ReviewProperties),
					sessionEntityId: selectedField(column(event, "sessionEntityId"), Schema.NullOr(EntityId)),
				},
			}),
		},
	});
})();

export type CollectionReviewsResult = Recipe.Success<typeof collectionReviewsRecipe>;
