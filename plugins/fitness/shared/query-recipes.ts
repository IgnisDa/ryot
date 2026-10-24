import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	column,
	defineRecipe,
	descending,
	entitySchemaPredicate,
	eq,
	gte,
	isNotNull,
	join,
	jsonPath,
	JsonValue,
	literal,
	type Recipe,
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

type Table = ReturnType<typeof table>;
type EntityFilterInput = {
	readonly reference: PluginIdentityReference;
	entityId?: string | undefined;
	name?: string | undefined;
};
type EntityListInput = Pick<Parameters<typeof selectedRows>[1], "after" | "limit"> &
	Pick<EntityFilterInput, "entityId" | "reference">;

const entityWhere = (entity: Table, schemaSlug: string, input: EntityFilterInput) =>
	and(
		entitySchemaPredicate(entity, schemaSlug, input.reference),
		...(input.entityId ? [eq(column(entity, "id"), literal(input.entityId))] : []),
		...(input.name ? [eq(column(entity, "name"), literal(input.name))] : []),
	);

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

export const exerciseListRecipe = defineRecipe(
	(input: EntityListInput & Pick<EntityFilterInput, "name">) => {
		const entity = table("entity", "entity");
		return {
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
					after: input.after,
					limit: input.limit,
					orderBy: [ascending(column(entity, "name"))],
					where: entityWhere(entity, "exercise", input),
					include: { equipment: exerciseEquipmentInclude(entity) },
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
		};
	},
);

export const measurementEntryListRecipe = defineRecipe(
	(
		input: Pick<Parameters<typeof selectedRows>[1], "after" | "limit"> & {
			readonly reference: PluginIdentityReference;
			startAt?: string | undefined;
		},
	) => {
		const entry = table("entity", "entry");
		return {
			map: ({ entries }) => Result.succeed(entries),
			queries: {
				entries: selectedRows(entry, {
					after: input.after,
					limit: input.limit,
					orderBy: [descending(propertyDate(entry, "occurredAt")), ascending(column(entry, "id"))],
					selection: {
						id: selectedField(column(entry, "id"), Schema.String),
						occurredAt: selectedField(propertyDate(entry, "occurredAt"), Schema.String),
						comment: selectedField(property(entry, "comment"), Schema.NullOr(Schema.String)),
					},
					where: and(
						entitySchemaPredicate(entry, "measurement-entry", input.reference),
						isNotNull(column(entry, "userId")),
						...(input.startAt === undefined
							? []
							: [gte(propertyDate(entry, "occurredAt"), castDate(literal(input.startAt)))]),
					),
				}),
			},
		};
	},
);

export const workoutTemplateListRecipe = defineRecipe((input: EntityListInput) => {
	const entity = table("entity", "entity");
	return {
		map: ({ workoutTemplates }) => Result.succeed(workoutTemplates),
		queries: {
			workoutTemplates: selectedRows(entity, {
				after: input.after,
				limit: input.limit,
				selection: workoutTemplateSelection(entity),
				orderBy: [descending(column(entity, "createdAt"))],
				where: entityWhere(entity, "workout-template", input),
			}),
		},
	};
});

export const workoutDetailRecipe = defineRecipe(
	(input: {
		readonly reference: PluginIdentityReference;
		entityId: string;
		templateLimit: number;
	}) => {
		const entity = table("entity", "entity");
		return {
			map: ({ workout }) => Result.succeed(workout ?? null),
			queries: {
				workout: selectedOptionalRow(entity, {
					selection: workoutSelection(entity),
					orderBy: [ascending(column(entity, "id"))],
					where: entityWhere(entity, "workout", input),
					include: { template: workoutTemplateInclude(entity, input.templateLimit) },
				}),
			},
		};
	},
);

export const workoutTemplateDetailRecipe = defineRecipe(
	(input: {
		readonly reference: PluginIdentityReference;
		entityId: string;
		workoutLimit: number;
	}) => {
		const entity = table("entity", "entity");
		return {
			map: ({ workoutTemplate }) => Result.succeed(workoutTemplate ?? null),
			queries: {
				workoutTemplate: selectedOptionalRow(entity, {
					orderBy: [ascending(column(entity, "id"))],
					selection: workoutTemplateSelection(entity),
					where: entityWhere(entity, "workout-template", input),
					include: { workouts: workoutInclude(entity, input.workoutLimit) },
				}),
			},
		};
	},
);

export type ExerciseListResult = Recipe.Success<typeof exerciseListRecipe>;
export type MeasurementEntryListResult = Recipe.Success<typeof measurementEntryListRecipe>;
export type WorkoutTemplateListResult = Recipe.Success<typeof workoutTemplateListRecipe>;
export type WorkoutDetailResult = Recipe.Success<typeof workoutDetailRecipe>;
export type WorkoutTemplateDetailResult = Recipe.Success<typeof workoutTemplateDetailRecipe>;
