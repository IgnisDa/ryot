import type { PluginIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import type { FieldSelection, Include, OrderBy } from "@ryot-app/contract/modules/ryotql/language";
import {
	and,
	column,
	document,
	entitySchemaPredicate,
	eq,
	exists,
	join,
	relationshipSchemaPredicate,
	rows,
	table,
} from "@ryot-app/ryotql";

export const mediaSavedViewDataSources = (input: {
	readonly schema: string;
	readonly orderBy: readonly OrderBy[];
	readonly fields: readonly FieldSelection[];
	readonly reference: PluginIdentityReference;
	readonly include?: undefined | readonly [Include, ...Include[]];
}) => {
	const entity = table("entity", "entity");
	const mediaLibrary = table("entity", "mediaLibrary");
	const membership = table("relationship", "inMediaLibrary");

	return document({
		savedView: rows(entity, {
			fields: input.fields,
			include: input.include,
			orderBy: input.orderBy,
			where: and(
				entitySchemaPredicate(entity, input.schema, input.reference),
				exists(membership, {
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
			),
		}),
	});
};
