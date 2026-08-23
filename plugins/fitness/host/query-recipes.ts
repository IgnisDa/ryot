import { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import { EntityId, EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import type { Recipe } from "@ryot-app/ryotql";
import {
	and,
	ascending,
	castDate,
	castNumber,
	castText,
	column,
	defineRecipe,
	descending,
	eq,
	join,
	jsonPath,
	literal,
	selectedField,
	selectedInclude,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

type Table = ReturnType<typeof table>;

const entityIdentitySelection = (entity: Table) => ({
	id: selectedField(column(entity, "id"), EntityId),
	name: selectedField(column(entity, "name"), Schema.String),
	schemaSlug: selectedField(column(entity, "entitySchemaSlug"), EntitySchemaSlug),
});

const entityWhere = (
	entity: Table,
	schemaSlug: string,
	input: { entityId?: string | undefined; name?: string | undefined },
) =>
	and(
		eq(column(entity, "entitySchemaSlug"), literal(schemaSlug)),
		...(input.entityId ? [eq(column(entity, "id"), literal(input.entityId))] : []),
		...(input.name ? [eq(column(entity, "name"), literal(input.name))] : []),
	);

const property = (entity: Table, path: string) =>
	castText(jsonPath(column(entity, "properties"), path));

const propertyDate = (entity: Table, path: string) =>
	castDate(jsonPath(column(entity, "properties"), path));

const propertyNumber = (entity: Table, path: string) =>
	castNumber(jsonPath(column(entity, "properties"), path));

const workoutSelection = (entity: Table) => ({
	...entityIdentitySelection(entity),
	comment: selectedField(property(entity, "comment"), Schema.NullOr(Schema.String)),
	endedAt: selectedField(propertyDate(entity, "endedAt"), Schema.NullOr(Schema.String)),
	startedAt: selectedField(propertyDate(entity, "startedAt"), Schema.NullOr(Schema.String)),
	caloriesBurnt: selectedField(
		propertyNumber(entity, "caloriesBurnt"),
		Schema.NullOr(Schema.Number),
	),
});

const workoutTemplateSelection = (entity: Table) => ({
	...entityIdentitySelection(entity),
	createdAt: selectedField(column(entity, "createdAt"), Schema.String),
	comment: selectedField(property(entity, "comment"), Schema.NullOr(Schema.String)),
});

const workoutTemplateInclude = (parent: Table, limit: number) => {
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
	(input: {
		name?: string | undefined;
		after?: string | undefined;
		limit?: number | undefined;
		entityId?: string | undefined;
	}) => {
		const entity = table("entity", "entity");
		return {
			map: ({ exercises }) => Result.succeed(exercises),
			queries: {
				exercises: selectedRows(entity, {
					after: input.after,
					limit: input.limit,
					orderBy: [ascending(column(entity, "name"))],
					where: entityWhere(entity, "exercise", input),
					selection: {
						...entityIdentitySelection(entity),
						kind: selectedField(property(entity, "kind"), Schema.NullOr(Schema.String)),
						level: selectedField(property(entity, "level"), Schema.NullOr(Schema.String)),
						equipment: selectedField(property(entity, "equipment"), Schema.NullOr(Schema.String)),
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

export const workoutListRecipe = defineRecipe(
	(input: {
		after?: string | undefined;
		limit?: number | undefined;
		entityId?: string | undefined;
	}) => {
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
	},
);

export const measurementListRecipe = defineRecipe(
	(input: {
		after?: string | undefined;
		limit?: number | undefined;
		entityId?: string | undefined;
	}) => {
		const entity = table("entity", "entity");
		return {
			map: ({ measurements }) => Result.succeed(measurements),
			queries: {
				measurements: selectedRows(entity, {
					after: input.after,
					limit: input.limit,
					orderBy: [ascending(column(entity, "name"))],
					where: entityWhere(entity, "measurement", input),
					selection: {
						...entityIdentitySelection(entity),
						comment: selectedField(property(entity, "comment"), Schema.NullOr(Schema.String)),
						recordedAt: selectedField(
							propertyDate(entity, "recordedAt"),
							Schema.NullOr(Schema.String),
						),
					},
				}),
			},
		};
	},
);

export const workoutTemplateListRecipe = defineRecipe(
	(input: {
		after?: string | undefined;
		limit?: number | undefined;
		entityId?: string | undefined;
	}) => {
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
	},
);

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
export type MeasurementListResult = Recipe.Success<typeof measurementListRecipe>;
export type WorkoutTemplateListResult = Recipe.Success<typeof workoutTemplateListRecipe>;
export type WorkoutDetailResult = Recipe.Success<typeof workoutDetailRecipe>;
export type WorkoutTemplateDetailResult = Recipe.Success<typeof workoutTemplateDetailRecipe>;
