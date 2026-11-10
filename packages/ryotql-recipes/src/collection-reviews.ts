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
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

export const collectionReviewsRecipe = defineRecipe(
	(input: {
		readonly collectionId: string;
		readonly after?: string | undefined;
		readonly limit?: number | undefined;
	}) => {
		const event = table("event", "collectionReview");
		return {
			map: ({ reviews }) => Result.succeed(reviews),
			queries: {
				reviews: selectedRows(event, {
					after: input.after,
					limit: input.limit ?? 20,
					orderBy: [
						descending(column(event, "occurredAt")),
						descending(column(event, "orderCreatedAt")),
						descending(column(event, "orderKey")),
					],
					where: and(
						eq(column(event, "entityId"), literal(input.collectionId)),
						eq(column(event, "eventSchemaSlug"), literal("review")),
						isNull(column(event, "eventSchemaPluginId")),
					),
					selection: {
						id: selectedField(column(event, "id"), EventId),
						entityId: selectedField(column(event, "entityId"), EntityId),
						occurredAt: selectedField(column(event, "occurredAt"), IsoDateString),
						properties: selectedField(column(event, "properties"), ReviewProperties),
						sessionEntityId: selectedField(
							column(event, "sessionEntityId"),
							Schema.NullOr(EntityId),
						),
					},
				}),
			},
		};
	},
);

export type CollectionReviewsResult = Recipe.Success<typeof collectionReviewsRecipe>;
