import type { FieldSelection } from "@ryot/contract/modules/ryotql/language";
import { ascending, column, document, eq, field, literal, rows, table } from "@ryot/ryotql";

export const buildAllCollectionsDocument = (
	input: {
		readonly after?: string | undefined;
		readonly limit?: number | undefined;
		readonly fields?: readonly FieldSelection[] | undefined;
	} = {},
) => {
	const collection = table("entity", "collection");
	return document({
		collections: rows(collection, {
			after: input.after,
			limit: input.limit,
			orderBy: [ascending(column(collection, "name"))],
			where: eq(column(collection, "entitySchemaSlug"), literal("collection")),
			fields: input.fields ?? [
				field("id", column(collection, "id")),
				field("name", column(collection, "name")),
			],
		}),
	});
};
