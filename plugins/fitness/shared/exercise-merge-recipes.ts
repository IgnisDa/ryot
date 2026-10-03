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

export const exerciseMergeSubjectsRecipe = defineRecipe(
	(input: {
		readonly reference: PluginIdentityReference;
		readonly mergeFrom: string;
		readonly mergeInto: string;
	}) => {
		const exercise = table("entity", "mergeExercise");
		return {
			map: ({ exercises }) => Result.succeed(exercises.items),
			queries: {
				exercises: selectedRows(exercise, {
					limit: 2,
					orderBy: [ascending(column(exercise, "id"))],
					where: and(
						entitySchemaPredicate(exercise, "exercise", input.reference),
						inArray(column(exercise, "id"), [input.mergeFrom, input.mergeInto].map(literal)),
					),
					selection: {
						id: selectedField(column(exercise, "id"), EntityId),
						kind: selectedField(property(exercise, "kind"), Schema.NullOr(Schema.String)),
						userId: selectedField(column(exercise, "userId"), Schema.NullOr(Schema.String)),
					},
				}),
			},
		};
	},
);

export const exerciseMergeLinksRecipe = defineRecipe(
	(input: {
		readonly reference: PluginIdentityReference;
		readonly mergeFrom: string;
		readonly after?: string | undefined;
	}) => {
		const link = table("relationship", "mergeLink");
		return {
			map: ({ links }) => Result.succeed(links),
			queries: {
				links: selectedRows(link, {
					after: input.after,
					limit: WORKOUT_EDITOR_PAGE_SIZE,
					orderBy: [ascending(column(link, "id"))],
					selection: {
						targetEntityId: selectedField(column(link, "targetEntityId"), EntityId),
						slug: selectedField(column(link, "relationshipSchemaSlug"), Schema.String),
					},
					where: and(
						isNotNull(column(link, "userId")),
						eq(column(link, "sourceEntityId"), literal(input.mergeFrom)),
						inArray(
							column(link, "relationshipSchemaSlug"),
							exerciseMergeDetachedRelationshipSlugs.map(literal),
						),
						schemaOwnerPredicate(link, "relationshipSchemaPluginId", input.reference),
					),
				}),
			},
		};
	},
);

export const exerciseMergeTemplatesRecipe = defineRecipe(
	(input: { readonly reference: PluginIdentityReference; readonly after?: string | undefined }) => {
		const template = table("entity", "mergeTemplate");
		return {
			map: ({ templates }) => Result.succeed(templates),
			queries: {
				templates: selectedRows(template, {
					after: input.after,
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
						properties: selectedField(
							column(template, "properties"),
							WorkoutEditorPropertiesSchema,
						),
					},
				}),
			},
		};
	},
);
