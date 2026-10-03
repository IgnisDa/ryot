import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	IsoDateString,
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	join,
	jsonPath,
	literal,
	or,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId, EventId } from "@ryot-app/plugin-kit/schema";

import { nullableEquals, property, propertyDate, propertyNumber } from "./entity-selections";
import { exerciseKindSchema } from "./exercise-kinds";
import { PersonalBestSchema } from "./workout-records";

export const workoutSetContextRecipe = defineRecipe(
	(input: { readonly exerciseId: string; readonly workoutId: string }) => {
		const exercise = table("entity", "exercise");
		const workout = table("entity", "workout");
		return {
			map: ({ workout: workoutResult, exercise: exerciseResult }) =>
				Result.succeed({ workout: workoutResult ?? null, exercise: exerciseResult ?? null }),
			queries: {
				exercise: selectedOptionalRow(exercise, {
					orderBy: [ascending(column(exercise, "id"))],
					selection: {
						kind: selectedField(property(exercise, "kind"), Schema.NullOr(exerciseKindSchema)),
					},
					where: and(
						eq(column(exercise, "id"), literal(input.exerciseId)),
						eq(column(exercise, "entitySchemaSlug"), literal("exercise")),
					),
				}),
				workout: selectedOptionalRow(workout, {
					orderBy: [ascending(column(workout, "id"))],
					selection: {
						startedAt: selectedField(
							propertyDate(workout, "startedAt"),
							Schema.NullOr(IsoDateString),
						),
					},
					where: and(
						eq(column(workout, "id"), literal(input.workoutId)),
						eq(column(workout, "entitySchemaSlug"), literal("workout")),
					),
				}),
			},
		};
	},
);

export const existingExerciseIdsRecipe = defineRecipe(
	(input: { readonly exerciseIds: ReadonlyArray<string> }) => {
		const exercise = table("entity", "exercise");
		return {
			map: ({ exercises }) => Result.succeed(exercises.items.map(({ id }) => id)),
			queries: {
				exercises: selectedRows(exercise, {
					limit: input.exerciseIds.length,
					orderBy: [ascending(column(exercise, "id"))],
					selection: { id: selectedField(column(exercise, "id"), EntityId) },
					where: and(
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
		readonly after?: string | undefined;
		readonly role: "entity" | "session";
		readonly subjectEntityId: string;
	}) => {
		const event = table("event", "workoutSetContextEvent");
		const exercise = table("entity", "workoutSetContextExercise");
		const workout = table("entity", "workoutSetContextWorkout");
		const eventPluginId = column(event, "eventSchemaPluginId");
		const exercisePluginId = column(exercise, "entitySchemaPluginId");
		const workoutPluginId = column(workout, "entitySchemaPluginId");
		const subjectColumn =
			input.role === "entity" ? column(event, "entityId") : column(event, "sessionEntityId");
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
						eq(subjectColumn, literal(input.subjectEntityId)),
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
		readonly after?: string | undefined;
		readonly exerciseId: string;
		readonly limit: number;
		readonly order: "id" | "records";
	}) => {
		const event = table("event", "workoutRecord");
		const exercise = table("entity", "exercise");
		const workout = table("entity", "workout");
		const workoutStartedAt = propertyDate(workout, "startedAt");
		const orderBy =
			input.order === "id"
				? [ascending(column(event, "id"))]
				: [
						ascending(column(event, "occurredAt")),
						ascending(workoutStartedAt),
						ascending(column(event, "sessionEntityId")),
						ascending(propertyNumber(event, "exerciseOrder")),
						ascending(propertyNumber(event, "setOrder")),
						ascending(column(event, "id")),
					];
		return {
			map: ({ records }) => Result.succeed(records),
			queries: {
				records: selectedRows(event, {
					orderBy,
					after: input.after,
					limit: Math.min(input.limit, 100),
					joins: [
						join("inner", exercise, eq(column(event, "entityId"), column(exercise, "id"))),
						join("inner", workout, eq(column(event, "sessionEntityId"), column(workout, "id"))),
					],
					where: and(
						eq(column(event, "entityId"), literal(input.exerciseId)),
						eq(column(event, "eventSchemaSlug"), literal("workout-set")),
						eq(column(exercise, "entitySchemaSlug"), literal("exercise")),
						eq(column(workout, "entitySchemaSlug"), literal("workout")),
					),
					selection: {
						id: selectedField(column(event, "id"), EventId),
						workoutStartedAt: selectedField(workoutStartedAt, IsoDateString),
						occurredAt: selectedField(column(event, "occurredAt"), IsoDateString),
						exerciseKind: selectedField(property(exercise, "kind"), exerciseKindSchema),
						reps: selectedField(propertyNumber(event, "reps"), Schema.NullOr(Schema.Finite)),
						pace: selectedField(propertyNumber(event, "pace"), Schema.NullOr(Schema.Finite)),
						oneRm: selectedField(propertyNumber(event, "oneRm"), Schema.NullOr(Schema.Finite)),
						weight: selectedField(propertyNumber(event, "weight"), Schema.NullOr(Schema.Finite)),
						volume: selectedField(propertyNumber(event, "volume"), Schema.NullOr(Schema.Finite)),
						duration: selectedField(
							propertyNumber(event, "duration"),
							Schema.NullOr(Schema.Finite),
						),
						distance: selectedField(
							propertyNumber(event, "distance"),
							Schema.NullOr(Schema.Finite),
						),
						confirmedAt: selectedField(
							propertyDate(event, "confirmedAt"),
							Schema.NullOr(IsoDateString),
						),
						personalBests: selectedField(
							jsonPath(column(event, "properties"), "personalBests"),
							Schema.NullOr(Schema.Array(PersonalBestSchema)),
						),
					},
				}),
			},
		};
	},
);

export type WorkoutRecordRowsResult = Recipe.Success<typeof workoutRecordRowsRecipe>;
