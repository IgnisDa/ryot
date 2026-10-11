import type { PluginIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import type { FieldSelection, Include, OrderBy } from "@ryot-app/contract/modules/ryotql/language";
import {
	entitySchemaPredicate,
	relationshipSchemaPredicate,
	and,
	column,
	eq,
	exists,
	join,
	table,
} from "@ryot-app/ryotql";
import { savedViewRecipe, type SavedViewTableMapping } from "@ryot-app/ryotql-recipes/saved-views";

export const defaultMediaSavedViewRecipe = (input: {
	readonly reference: PluginIdentityReference;
	readonly after?: string | undefined;
	readonly limit?: number | undefined;
	readonly fields: readonly FieldSelection[];
	readonly include?: readonly [Include, ...Include[]] | undefined;
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
		owner: input.reference,
		include: input.include,
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
				relationshipSchemaPredicate(membership, "in-media-library", input.reference),
				entitySchemaPredicate(mediaLibrary, "media-library", input.reference),
				eq(column(membership, "targetEntityId"), column(mediaLibrary, "id")),
			),
		}),
	} as const;
	return savedViewRecipe({ source, layout: input.layout });
};
