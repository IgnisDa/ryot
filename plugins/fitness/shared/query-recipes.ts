import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	column,
	defineRecipe,
	descending,
	eq,
	gte,
	join,
	JsonValue,
	jsonPath,
	literal,
	selectedField,
	selectedInclude,
	selectedOptionalRow,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/plugin-kit/ryotql";

import {
	entityIdentitySelection,
	property,
	propertyNumber,
	workoutDatesSelection,
} from "./entity-selections";
import { exerciseEquipmentInclude } from "./taxonomy-recipes";

type Table = ReturnType<typeof table>;
type EntityFilterInput = { entityId?: string | undefined; name?: string | undefined };
type EntityListInput = Pick<Parameters<typeof selectedRows>[1], "after" | "limit"> &
	Pick<EntityFilterInput, "entityId">;

const entityWhere = (entity: Table, schemaSlug: string, input: EntityFilterInput) =>
	and(
		eq(column(entity, "entitySchemaSlug"), literal(schemaSlug)),
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

export const workoutListRecipe = defineRecipe((input: EntityListInput) => {
	const entity = table("entity", "entity");
	return {
		map: ({ workouts }) => Result.succeed(workouts),
		queries: {
			workouts: selectedRows(entity, {
				after: input.after,
				limit: input.limit,
				selection: workoutSelection(entity),
				where: entityWhere(entity, "workout", input),
				orderBy: [ascending(column(entity, "name"))],
			}),
		},
	};
});

export const measurementReadingListRecipe = defineRecipe(
	(
		input: Pick<Parameters<typeof selectedRows>[1], "after" | "limit"> & {
			startAt?: string | undefined;
		},
	) => {
		const event = table("event", "reading");
		const metric = table("entity", "metric");
		return {
			map: ({ readings }) => Result.succeed(readings),
			queries: {
				readings: selectedRows(event, {
					after: input.after,
					limit: input.limit,
					joins: [join("inner", metric, eq(column(event, "entityId"), column(metric, "id")))],
					orderBy: [
						descending(column(event, "occurredAt")),
						ascending(property(metric, "key")),
						ascending(column(event, "id")),
					],
					where: and(
						eq(column(event, "eventSchemaSlug"), literal("measurement-reading")),
						eq(column(metric, "entitySchemaSlug"), literal("measurement-metric")),
						...(input.startAt === undefined
							? []
							: [gte(column(event, "occurredAt"), castDate(literal(input.startAt)))]),
					),
					selection: {
						id: selectedField(column(event, "id"), Schema.String),
						metricId: selectedField(column(metric, "id"), Schema.String),
						metricName: selectedField(column(metric, "name"), Schema.String),
						value: selectedField(propertyNumber(event, "value"), Schema.Finite),
						occurredAt: selectedField(column(event, "occurredAt"), Schema.String),
						unit: selectedField(property(metric, "unit"), Schema.NullOr(Schema.String)),
						metricKey: selectedField(property(metric, "key"), Schema.NullOr(Schema.String)),
						comment: selectedField(property(event, "comment"), Schema.NullOr(Schema.String)),
					},
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
	(input: { entityId: string; templateLimit: number }) => {
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
	(input: { entityId: string; workoutLimit: number }) => {
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
export type WorkoutListResult = Recipe.Success<typeof workoutListRecipe>;
export type MeasurementReadingListResult = Recipe.Success<typeof measurementReadingListRecipe>;
export type WorkoutTemplateListResult = Recipe.Success<typeof workoutTemplateListRecipe>;
export type WorkoutDetailResult = Recipe.Success<typeof workoutDetailRecipe>;
export type WorkoutTemplateDetailResult = Recipe.Success<typeof workoutTemplateDetailRecipe>;
