import { Result } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	entitySchemaPredicate,
	isNotNull,
	parameters,
	selectedField,
	selectedRow,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId, type PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

const entityMediaLibrary = table("entity", "mediaLibrary");

export const userMediaLibraryRecipe = (reference: PluginIdentityReference) => {
	const recipeParameters = parameters({ fields: {} });
	return defineRecipe({
		parameters: recipeParameters.schema,
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
	});
};
