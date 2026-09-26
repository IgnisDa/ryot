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

const entityFitnessLibrary = table("entity", "fitnessLibrary");

export const userFitnessLibraryRecipe = defineRecipe(() => ({
	map: ({ fitnessLibrary }) => Result.succeed(fitnessLibrary),
	queries: {
		fitnessLibrary: selectedRow(entityFitnessLibrary, {
			orderBy: [ascending(column(entityFitnessLibrary, "id"))],
			selection: { entityId: selectedField(column(entityFitnessLibrary, "id"), EntityId) },
			where: and(
				eq(column(entityFitnessLibrary, "entitySchemaSlug"), literal("fitness-library")),
				isNotNull(column(entityFitnessLibrary, "userId")),
			),
		}),
	},
}));
