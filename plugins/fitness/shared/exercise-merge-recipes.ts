import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	inArray,
	isNotNull,
	literal,
	parameters,
	schemaOwnerPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId, type PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import { property } from "./entity-selections";
import { WORKOUT_EDITOR_PAGE_SIZE, WorkoutEditorPropertiesSchema } from "./workout-editor-recipes";

const exerciseMergeDetachedRelationshipSlugs = [
	"in-fitness-library",
	"exercise-targets",
	"exercise-uses-equipment",
] as const;
export const exerciseMergeSubjectsRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const inputParameters = parameters({
		fields: {
			mergeFrom: {
				type: "string",
				label: "mergeFrom",
				validation: { required: true },
				description: "mergeFrom for this selection",
			},
			mergeInto: {
				type: "string",
				label: "mergeInto",
				validation: { required: true },
				description: "mergeInto for this selection",
			},
		},
	});
	const exercise = table("entity", "mergeExercise");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ exercises }) => Result.succeed(exercises.items),
		queries: {
			exercises: selectedRows(exercise, {
				limit: 2,
				orderBy: [ascending(column(exercise, "id"))],
				selection: {
					id: selectedField(column(exercise, "id"), EntityId),
					kind: selectedField(property(exercise, "kind"), Schema.NullOr(Schema.String)),
				},
				where: and(
					entitySchemaPredicate(exercise, "exercise", input.reference),
					inArray(column(exercise, "id"), [
						inputParameters.value("mergeFrom"),
						inputParameters.value("mergeInto"),
					]),
				),
			}),
		},
	});
};
export const exerciseMergeLinksRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const inputParameters = parameters({
		fields: {
			mergeFrom: {
				type: "string",
				label: "Merge From",
				validation: { required: true },
				description: "Merge From for this selection",
			},
		},
	});
	const link = table("relationship", "mergeLink");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ links }) => Result.succeed(links),
		queries: {
			links: selectedRows(link, {
				limit: WORKOUT_EDITOR_PAGE_SIZE,
				orderBy: [ascending(column(link, "id"))],
				selection: {
					targetEntityId: selectedField(column(link, "targetEntityId"), EntityId),
					slug: selectedField(column(link, "relationshipSchemaSlug"), Schema.String),
				},
				where: and(
					isNotNull(column(link, "userId")),
					eq(column(link, "sourceEntityId"), inputParameters.value("mergeFrom")),
					inArray(
						column(link, "relationshipSchemaSlug"),
						exerciseMergeDetachedRelationshipSlugs.map(literal),
					),
					schemaOwnerPredicate(link, "relationshipSchemaPluginId", input.reference),
				),
			}),
		},
	});
};
export const exerciseMergeTemplatesRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const template = table("entity", "mergeTemplate");
	return defineRecipe({
		map: ({ templates }) => Result.succeed(templates),
		queries: {
			templates: selectedRows(template, {
				limit: WORKOUT_EDITOR_PAGE_SIZE,
				orderBy: [ascending(column(template, "id"))],
				where: and(
					entitySchemaPredicate(template, "workout-template", input.reference),
					isNotNull(column(template, "userId")),
				),
				selection: {
					id: selectedField(column(template, "id"), EntityId),
					name: selectedField(column(template, "name"), Schema.String),
					updatedAt: selectedField(column(template, "updatedAt"), Schema.String),
					properties: selectedField(column(template, "properties"), WorkoutEditorPropertiesSchema),
				},
			}),
		},
	});
};
