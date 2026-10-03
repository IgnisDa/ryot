import type { FieldSelection, OrderBy } from "@ryot-app/contract/modules/ryotql/language";
import { and, column, eq, exists, join, literal, table } from "@ryot-app/ryotql";
import { savedViewRecipe, type SavedViewTableMapping } from "@ryot-app/ryotql-recipes/saved-views";

export const defaultMediaSavedViewRecipe = (input: {
	readonly after?: string | undefined;
	readonly limit?: number | undefined;
	readonly fields: readonly FieldSelection[];
	readonly schemas: readonly [string, ...string[]];
	readonly orderBy?: readonly OrderBy[] | undefined;
	readonly layout: {
		readonly type: "table";
		readonly mapping: SavedViewTableMapping & { entityIdField: string };
	};
}) => {
	const entity = table("entity", "entity");
	const mediaLibrary = table("entity", "mediaLibrary");
	const membership = table("relationship", "inMediaLibrary");

	const source = {
		type: "generated",
		after: input.after,
		limit: input.limit,
		fields: input.fields,
		orderBy: input.orderBy,
		entitySchemaSlugs: input.schemas,
		where: exists(membership, {
			joins: [
				join(
					"inner",
					mediaLibrary,
					eq(column(membership, "targetEntityId"), column(mediaLibrary, "id")),
				),
			],
			where: and(
				eq(column(membership, "sourceEntityId"), column(entity, "id")),
				eq(column(membership, "relationshipSchemaSlug"), literal("in-media-library")),
				eq(column(mediaLibrary, "entitySchemaSlug"), literal("media-library")),
				eq(column(membership, "targetEntityId"), column(mediaLibrary, "id")),
			),
		}),
	} as const;
	return savedViewRecipe({ source, layout: input.layout });
};
