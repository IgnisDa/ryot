import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	IsoDateString,
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	join,
	literal,
	or,
	selectedField,
	selectedRows,
	table,
	type Recipe,
	schemaOwnerPredicate,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";
import { EntityId, EventId } from "@ryot-app/plugin-kit/schema";

import { nullableEquals, property, propertyDate, propertyNumber } from "./entity-selections";
import { exerciseKindSchema } from "./exercise-kinds";

export const existingExerciseIdsRecipe = defineRecipe(
	(input: {
		readonly reference: PluginIdentityReference;
		readonly exerciseIds: ReadonlyArray<string>;
	}) => {
		const exercise = table("entity", "exercise");
		return {
			map: ({ exercises }) => Result.succeed(exercises.items.map(({ id }) => id)),
			queries: {
				exercises: selectedRows(exercise, {
					limit: input.exerciseIds.length,
					orderBy: [ascending(column(exercise, "id"))],
					selection: { id: selectedField(column(exercise, "id"), EntityId) },
					where: and(
						schemaOwnerPredicate(exercise, "entitySchemaPluginId", input.reference),
						eq(column(exercise, "entitySchemaSlug"), literal("exercise")),
						or(...input.exerciseIds.map((id) => eq(column(exercise, "id"), literal(id)))),
					),
				}),
			},
		};
	},
);

export const workoutSetExerciseIdsRecipe = defineRecipe(
	(input: {
		readonly reference: PluginIdentityReference;
		readonly after?: string | undefined;
		readonly workoutId: string;
	}) => {
		const event = table("event", "workoutSetContextEvent");
		const exercise = table("entity", "workoutSetContextExercise");
		const workout = table("entity", "workoutSetContextWorkout");
		const eventPluginId = column(event, "eventSchemaPluginId");
		const exercisePluginId = column(exercise, "entitySchemaPluginId");
		const workoutPluginId = column(workout, "entitySchemaPluginId");
		return {
			map: ({ workoutSetExerciseIds }) => Result.succeed(workoutSetExerciseIds),
			queries: {
				workoutSetExerciseIds: selectedRows(event, {
					limit: 50,
					after: input.after,
					orderBy: [ascending(column(event, "id"))],
					selection: { entityId: selectedField(column(event, "entityId"), EntityId) },
					joins: [
						join("inner", exercise, eq(column(event, "entityId"), column(exercise, "id"))),
						join("inner", workout, eq(column(event, "sessionEntityId"), column(workout, "id"))),
					],
					where: and(
						schemaOwnerPredicate(exercise, "entitySchemaPluginId", input.reference),
						schemaOwnerPredicate(workout, "entitySchemaPluginId", input.reference),
						schemaOwnerPredicate(event, "eventSchemaPluginId", input.reference),
						eq(column(event, "sessionEntityId"), literal(input.workoutId)),
						eq(column(event, "eventSchemaSlug"), literal("workout-set")),
						eq(column(exercise, "entitySchemaSlug"), literal("exercise")),
						eq(column(workout, "entitySchemaSlug"), literal("workout")),
						nullableEquals(eventPluginId, exercisePluginId),
						nullableEquals(eventPluginId, workoutPluginId),
					),
				}),
			},
		};
	},
);

export const workoutRecordRowsRecipe = defineRecipe(
	(input: {
		readonly reference: PluginIdentityReference;
		readonly after?: string | undefined;
		readonly exerciseId: string;
		readonly limit: number;
	}) => {
		const event = table("event", "workoutRecord");
		const exercise = table("entity", "exercise");
		const workout = table("entity", "workout");
		const workoutStartedAt = propertyDate(workout, "startedAt");
		return {
			map: ({ records }) => Result.succeed(records),
			queries: {
				records: selectedRows(event, {
					after: input.after,
					limit: Math.min(input.limit, 100),
					joins: [
						join("inner", exercise, eq(column(event, "entityId"), column(exercise, "id"))),
						join("inner", workout, eq(column(event, "sessionEntityId"), column(workout, "id"))),
					],
					orderBy: [
						ascending(column(event, "occurredAt")),
						ascending(workoutStartedAt),
						ascending(column(event, "sessionEntityId")),
						ascending(propertyNumber(event, "exerciseOrder")),
						ascending(propertyNumber(event, "setOrder")),
						ascending(column(event, "id")),
					],
					where: and(
						schemaOwnerPredicate(exercise, "entitySchemaPluginId", input.reference),
						schemaOwnerPredicate(workout, "entitySchemaPluginId", input.reference),
						schemaOwnerPredicate(event, "eventSchemaPluginId", input.reference),
						eq(column(event, "entityId"), literal(input.exerciseId)),
						eq(column(event, "eventSchemaSlug"), literal("workout-set")),
						eq(column(exercise, "entitySchemaSlug"), literal("exercise")),
						eq(column(workout, "entitySchemaSlug"), literal("workout")),
					),
					selection: {
						id: selectedField(column(event, "id"), EventId),
						workoutStartedAt: selectedField(workoutStartedAt, IsoDateString),
						occurredAt: selectedField(column(event, "occurredAt"), IsoDateString),
						exerciseKind: selectedField(property(event, "exerciseKind"), exerciseKindSchema),
						reps: selectedField(propertyNumber(event, "reps"), Schema.NullOr(Schema.Finite)),
						weight: selectedField(propertyNumber(event, "weight"), Schema.NullOr(Schema.Finite)),
						duration: selectedField(
							propertyNumber(event, "duration"),
							Schema.NullOr(Schema.Finite),
						),
						distance: selectedField(
							propertyNumber(event, "distance"),
							Schema.NullOr(Schema.Finite),
						),
					},
				}),
			},
		};
	},
);

export type WorkoutRecordRowsResult = Recipe.Success<typeof workoutRecordRowsRecipe>;
