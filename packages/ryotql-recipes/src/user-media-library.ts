import type { PluginIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import { EntityId } from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	defineRecipe,
	entitySchemaPredicate,
	isNotNull,
	selectedField,
	selectedRow,
	table,
} from "@ryot-app/ryotql";
import { Result } from "effect";

const entityMediaLibrary = table("entity", "mediaLibrary");

export const userMediaLibraryRecipe = defineRecipe((reference: PluginIdentityReference) => ({
	map: ({ mediaLibrary }) => Result.succeed(mediaLibrary),
	queries: {
		mediaLibrary: selectedRow(entityMediaLibrary, {
			orderBy: [ascending(column(entityMediaLibrary, "id"))],
			selection: { entityId: selectedField(column(entityMediaLibrary, "id"), EntityId) },
			where: and(
				entitySchemaPredicate(entityMediaLibrary, "media-library", reference),
				isNotNull(column(entityMediaLibrary, "userId")),
			),
		}),
	},
}));
