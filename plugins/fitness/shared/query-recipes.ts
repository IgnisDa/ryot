import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	descending,
	entitySchemaPredicate,
	eq,
	isNotNull,
	join,
	jsonPath,
	JsonValue,
	literal,
	parameters,
	type Recipe,
	reportingParameterFields,
	reportingPeriodPredicate,
	selectedField,
	selectedInclude,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import {
	entityIdentitySelection,
	property,
	propertyDate,
	propertyNumber,
	workoutDatesSelection,
} from "./entity-selections";
import { exerciseEquipmentInclude } from "./taxonomy-recipes";

type Table = Parameters<typeof column>[0];
export const workoutSelection = (entity: Table) => ({
	...entityIdentitySelection(entity),
	...workoutDatesSelection(entity),
	comment: selectedField(property(entity, "comment"), Schema.NullOr(Schema.String)),
	caloriesBurnt: selectedField(
		propertyNumber(entity, "caloriesBurnt"),
		Schema.NullOr(Schema.Finite),
	),
});

const workoutTemplateSelection = (entity: Table) => ({
	...entityIdentitySelection(entity),
	createdAt: selectedField(column(entity, "createdAt"), Schema.String),
	comment: selectedField(property(entity, "comment"), Schema.NullOr(Schema.String)),
});

export const workoutTemplateInclude = (parent: Table, limit: number) => {
	const template = table("entity", "template");
	const relationship = table("relationship", "templateRelationship");
	return selectedInclude(relationship, {
		limit,
		selection: workoutTemplateSelection(template),
		orderBy: [ascending(column(template, "name"))],
		joins: [
			join("inner", template, eq(column(relationship, "targetEntityId"), column(template, "id"))),
		],
		where: and(
			eq(column(template, "entitySchemaPluginId"), column(parent, "entitySchemaPluginId")),
			eq(
				column(relationship, "relationshipSchemaPluginId"),
				column(parent, "entitySchemaPluginId"),
			),
			eq(column(relationship, "sourceEntityId"), column(parent, "id")),
			eq(column(relationship, "relationshipSchemaSlug"), literal("workout-to-workout-template")),
			eq(column(template, "entitySchemaSlug"), literal("workout-template")),
		),
	});
};

const workoutInclude = (parent: Table, limit: number) => {
	const workout = table("entity", "workout");
	const relationship = table("relationship", "workoutRelationship");
	return selectedInclude(relationship, {
		limit,
		selection: workoutSelection(workout),
		orderBy: [ascending(column(workout, "name"))],
		joins: [
			join("inner", workout, eq(column(relationship, "sourceEntityId"), column(workout, "id"))),
		],
		where: and(
			eq(column(workout, "entitySchemaPluginId"), column(parent, "entitySchemaPluginId")),
			eq(
				column(relationship, "relationshipSchemaPluginId"),
				column(parent, "entitySchemaPluginId"),
			),
			eq(column(relationship, "targetEntityId"), column(parent, "id")),
			eq(column(relationship, "relationshipSchemaSlug"), literal("workout-to-workout-template")),
			eq(column(workout, "entitySchemaSlug"), literal("workout")),
		),
	});
};
export const exerciseListRecipe = (input: { readonly reference: PluginIdentityReference }) => {
	const inputParameters = parameters({
		fields: {
			name: { label: "name", type: "string", description: "name for this selection" },
			entityId: { type: "string", label: "entityId", description: "entityId for this selection" },
		},
	});
	const entity = table("entity", "entity");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ exercises }) =>
			Result.succeed({
				...exercises,
				items: exercises.items.map(({ equipment, ...exercise }) => ({
					...exercise,
					equipment: equipment.items,
				})),
			}),
		queries: {
			exercises: selectedRows(entity, {
				limit: 100,
				orderBy: [ascending(column(entity, "name"))],
				include: { equipment: exerciseEquipmentInclude(entity) },
				where: and(
					entitySchemaPredicate(entity, "exercise", input.reference),
					inputParameters.whenSet(
						"entityId",
						eq(column(entity, "id"), inputParameters.value("entityId")),
					),
					inputParameters.whenSet(
						"name",
						eq(column(entity, "name"), inputParameters.value("name")),
					),
				),
				selection: {
					...entityIdentitySelection(entity),
					kind: selectedField(property(entity, "kind"), Schema.NullOr(Schema.String)),
					level: selectedField(property(entity, "level"), Schema.NullOr(Schema.String)),
					image: selectedField(
						jsonPath(column(entity, "properties"), "images", 0),
						Schema.NullOr(JsonValue),
					),
				},
			}),
		},
	});
};
export const measurementEntryListRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const inputParameters = parameters({ fields: reportingParameterFields });
	const entry = table("entity", "entry");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ entries }) => Result.succeed(entries),
		queries: {
			entries: selectedRows(entry, {
				limit: 100,
				orderBy: [descending(propertyDate(entry, "occurredAt")), ascending(column(entry, "id"))],
				where: and(
					entitySchemaPredicate(entry, "measurement-entry", input.reference),
					isNotNull(column(entry, "userId")),
					reportingPeriodPredicate(propertyDate(entry, "occurredAt")),
				),
				selection: {
					id: selectedField(column(entry, "id"), Schema.String),
					occurredAt: selectedField(propertyDate(entry, "occurredAt"), Schema.String),
					comment: selectedField(property(entry, "comment"), Schema.NullOr(Schema.String)),
				},
			}),
		},
	});
};
export const workoutTemplateListRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const inputParameters = parameters({
		fields: {
			entityId: { type: "string", label: "entityId", description: "entityId for this selection" },
		},
	});
	const entity = table("entity", "entity");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ workoutTemplates }) => Result.succeed(workoutTemplates),
		queries: {
			workoutTemplates: selectedRows(entity, {
				limit: 100,
				selection: workoutTemplateSelection(entity),
				orderBy: [descending(column(entity, "createdAt"))],
				where: and(
					entitySchemaPredicate(entity, "workout-template", input.reference),
					inputParameters.whenSet(
						"entityId",
						eq(column(entity, "id"), inputParameters.value("entityId")),
					),
				),
			}),
		},
	});
};
export const workoutDetailRecipe = (input: { readonly reference: PluginIdentityReference }) => {
	const inputParameters = parameters({
		fields: {
			entityId: {
				type: "string",
				label: "entityId",
				validation: { required: true },
				description: "entityId for this selection",
			},
		},
	});
	const entity = table("entity", "entity");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ workout }) => Result.succeed(workout ?? null),
		queries: {
			workout: selectedOptionalRow(entity, {
				selection: workoutSelection(entity),
				orderBy: [ascending(column(entity, "id"))],
				include: { template: workoutTemplateInclude(entity, 100) },
				where: and(
					entitySchemaPredicate(entity, "workout", input.reference),
					eq(column(entity, "id"), inputParameters.value("entityId")),
				),
			}),
		},
	});
};
export const workoutTemplateDetailRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const inputParameters = parameters({
		fields: {
			entityId: {
				type: "string",
				label: "entityId",
				validation: { required: true },
				description: "entityId for this selection",
			},
		},
	});
	const entity = table("entity", "entity");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ workoutTemplate }) => Result.succeed(workoutTemplate ?? null),
		queries: {
			workoutTemplate: selectedOptionalRow(entity, {
				orderBy: [ascending(column(entity, "id"))],
				selection: workoutTemplateSelection(entity),
				include: { workouts: workoutInclude(entity, 100) },
				where: and(
					entitySchemaPredicate(entity, "workout-template", input.reference),
					eq(column(entity, "id"), inputParameters.value("entityId")),
				),
			}),
		},
	});
};
export type ExerciseListResult = Recipe.Success<ReturnType<typeof exerciseListRecipe>>;
export type WorkoutDetailResult = Recipe.Success<ReturnType<typeof workoutDetailRecipe>>;
export type WorkoutTemplateListResult = Recipe.Success<
	ReturnType<typeof workoutTemplateListRecipe>
>;
export type MeasurementEntryListResult = Recipe.Success<
	ReturnType<typeof measurementEntryListRecipe>
>;
export type WorkoutTemplateDetailResult = Recipe.Success<
	ReturnType<typeof workoutTemplateDetailRecipe>
>;
