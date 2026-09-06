import { Result } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	exists,
	isNotNull,
	join,
	literal,
	selectedField,
	selectedRow,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId } from "@ryot-app/plugin-kit/schema";

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

type Table = ReturnType<typeof table>;

export const fitnessLibraryLinkExists = (entity: Table, alias: string) => {
	const fitnessLibrary = table("entity", alias);
	const relationship = table("relationship", `${alias}Relationship`);
	return exists(fitnessLibrary, {
		joins: [
			join(
				"inner",
				relationship,
				eq(column(relationship, "targetEntityId"), column(fitnessLibrary, "id")),
			),
		],
		where: and(
			eq(column(fitnessLibrary, "entitySchemaSlug"), literal("fitness-library")),
			eq(column(relationship, "sourceEntityId"), column(entity, "id")),
			eq(column(relationship, "relationshipSchemaSlug"), literal("in-fitness-library")),
		),
	});
};
