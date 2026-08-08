import { EntityId } from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	eq,
	isNotNull,
	literal,
	defineRecipe,
	selectedField,
	selectedRow,
	table,
} from "@ryot-app/ryotql";
import { Result } from "effect";

const entityMediaLibrary = table("entity", "mediaLibrary");

export const userMediaLibraryRecipe = defineRecipe(() => ({
	map: ({ mediaLibrary }) => Result.succeed(mediaLibrary),
	queries: {
		mediaLibrary: selectedRow(entityMediaLibrary, {
			orderBy: [ascending(column(entityMediaLibrary, "id"))],
			selection: { entityId: selectedField(column(entityMediaLibrary, "id"), EntityId) },
			where: and(
				eq(column(entityMediaLibrary, "entitySchemaSlug"), literal("media-library")),
				isNotNull(column(entityMediaLibrary, "userId")),
			),
		}),
	},
}));
