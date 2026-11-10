import { and, average, column, eq, literal, table } from "@ryot-app/plugin-kit/ryotql";

import { propertyNumber, type Table } from "./entity-selections";

type Column = ReturnType<typeof column>;

export const reviewRating = (review: Table) => propertyNumber(review, "rating");

export const averageUserRating = (alias: string, entityId: Column, schemaPluginId: Column) => {
	const review = table("event", alias);
	return average(review, reviewRating(review), {
		where: and(
			eq(column(review, "entityId"), entityId),
			eq(column(review, "eventSchemaPluginId"), schemaPluginId),
			eq(column(review, "eventSchemaSlug"), literal("review")),
		),
	});
};
