import { AssetLocator, PopulationStatus, TranslationStatus } from "@ryot-app/client-sdk";
import { Result, Schema } from "@ryot-app/client-sdk/effect";
import {
	and,
	ascending,
	castDate,
	castJson,
	castText,
	column,
	defineRecipe,
	eq,
	inArray,
	jsonPath,
	literal,
	selectedField,
	selectedRows,
	table,
	titleCase,
	type Recipe,
} from "@ryot-app/client-sdk/ryotql";

const nullableText = Schema.NullOr(Schema.String);

export const fitnessPresentationRecipe = defineRecipe(
	(input: { readonly slug: string; readonly entityIds: readonly string[] }) => {
		const entity = table("entity", "presentationFitness");
		const property = (key: string) => jsonPath(column(entity, "properties"), key);
		const isExercise = input.slug === "exercise";
		const recordedAt =
			input.slug === "workout-template" ? column(entity, "createdAt") : property("recordedAt");
		return {
			map: ({ entities }) => Result.succeed(entities.items),
			queries: {
				entities: selectedRows(entity, {
					limit: 100,
					orderBy: [ascending(column(entity, "id"))],
					where: and(
						eq(column(entity, "entitySchemaSlug"), literal(input.slug)),
						inArray(
							column(entity, "id"),
							input.entityIds.map((entityId) => literal(entityId)),
						),
					),
					selection: {
						id: selectedField(column(entity, "id"), Schema.String),
						name: selectedField(column(entity, "name"), Schema.String),
						schemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
						populationStatus: selectedField(column(entity, "populationStatus"), PopulationStatus),
						translationStatus: selectedField(
							column(entity, "translationStatus"),
							TranslationStatus,
						),
						callout: selectedField(
							isExercise ? titleCase(property("level")) : literal(null),
							nullableText,
						),
						primary: selectedField(
							isExercise ? titleCase(property("kind")) : castDate(recordedAt),
							nullableText,
						),
						secondary: selectedField(
							isExercise ? titleCase(property("equipment")) : castText(property("comment")),
							nullableText,
						),
						images: selectedField(
							isExercise ? castJson(property("images")) : literal(null),
							Schema.NullOr(Schema.Array(AssetLocator)),
						),
					},
				}),
			},
		};
	},
);

export type FitnessPresentationData = Recipe.Success<typeof fitnessPresentationRecipe>[number];
