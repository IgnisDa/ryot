import { ascending, column, document, eq, field, literal, rows, table } from "@ryot/ryotql";

export const buildAllCollectionsDocument = (
	input: { readonly page?: number | undefined; readonly limit?: number | undefined } = {},
) => {
	const collection = table("entity", "collection");
	return document({
		collections: rows(collection, {
			page: input.page,
			limit: input.limit,
			orderBy: [ascending(column(collection, "name"))],
			where: eq(column(collection, "entitySchemaSlug"), literal("collection")),
			fields: [field("id", column(collection, "id")), field("name", column(collection, "name"))],
		}),
	});
};
