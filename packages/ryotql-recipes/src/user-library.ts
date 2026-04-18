import { EntityId } from "@ryot/contract/schema/brands";
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
} from "@ryot/ryotql";
import { Result } from "effect";

const entityLibrary = table("entity", "library");

export const userLibraryRecipe = defineRecipe(() => ({
	queries: {
		library: selectedRow(entityLibrary, {
			orderBy: [ascending(column(entityLibrary, "id"))],
			selection: { entityId: selectedField(column(entityLibrary, "id"), EntityId) },
			where: and(
				eq(column(entityLibrary, "entitySchemaSlug"), literal("library")),
				isNotNull(column(entityLibrary, "userId")),
			),
		}),
	},
	map: ({ library }) => Result.succeed(library),
}));
