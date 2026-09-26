import { and, column, eq, exists, join, literal, table } from "@ryot-app/plugin-kit/ryotql";

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
