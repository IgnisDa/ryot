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
	exists,
	IsoDateString,
	join,
	literal,
	lt,
	neq,
	type Recipe,
	schemaOwnerPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId, EventId, type PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import { projectionNumber, property, propertyDate, propertyNumber } from "./entity-selections";
import { type ExerciseKind, exerciseKindSchema } from "./exercise-kinds";
import { WorkoutSetLotSchema } from "./workout-set";

type Table = ReturnType<typeof table>;

const rowLimit = 100;
const nullableNumber = Schema.NullOr(Schema.Finite);
const nullableExerciseKind = Schema.NullOr(exerciseKindSchema);
const nullableString = Schema.NullOr(Schema.String);

const workoutSetWhere = (event: Table, reference: PluginIdentityReference) =>
	and(
		schemaOwnerPredicate(event, "eventSchemaPluginId", reference),
		eq(column(event, "eventSchemaSlug"), literal("workout-set")),
	);

const workoutSetSelection = (event: Table) => ({
	id: selectedField(column(event, "id"), EventId),
	note: selectedField(property(event, "note"), nullableString),
	exerciseId: selectedField(column(event, "entityId"), EntityId),
	rpe: selectedField(propertyNumber(event, "rpe"), nullableNumber),
	reps: selectedField(propertyNumber(event, "reps"), nullableNumber),
	pace: selectedField(projectionNumber(event, "pace"), nullableNumber),
	occurredAt: selectedField(column(event, "occurredAt"), IsoDateString),
	oneRm: selectedField(projectionNumber(event, "oneRm"), nullableNumber),
	weight: selectedField(propertyNumber(event, "weight"), nullableNumber),
	volume: selectedField(projectionNumber(event, "volume"), nullableNumber),
	restTime: selectedField(propertyNumber(event, "restTime"), nullableNumber),
	setOrder: selectedField(propertyNumber(event, "setOrder"), nullableNumber),
	duration: selectedField(propertyNumber(event, "duration"), nullableNumber),
	distance: selectedField(propertyNumber(event, "distance"), nullableNumber),
	recordedKind: selectedField(property(event, "exerciseKind"), nullableExerciseKind),
	setLot: selectedField(property(event, "setLot"), Schema.NullOr(WorkoutSetLotSchema)),
	exerciseOrder: selectedField(propertyNumber(event, "exerciseOrder"), nullableNumber),
});

export const workoutHistoryRecipe = defineRecipe(
	(input: {
		readonly exerciseId: string;
		readonly after?: string | undefined;
		readonly reference: PluginIdentityReference;
		readonly beforeStartedAt?: string | undefined;
		readonly excludeWorkoutId?: string | undefined;
	}) => {
		const workout = table("entity", "historyWorkout");
		const set = table("event", "historyWorkoutSet");
		const startedAt = propertyDate(workout, "startedAt");
		return {
			map: ({ workouts }) => Result.succeed(workouts),
			queries: {
				workouts: selectedRows(workout, {
					limit: rowLimit,
					after: input.after,
					orderBy: [descending(startedAt), ascending(column(workout, "id"))],
					selection: {
						id: selectedField(column(workout, "id"), EntityId),
						startedAt: selectedField(startedAt, IsoDateString),
						name: selectedField(column(workout, "name"), Schema.String),
						comment: selectedField(property(workout, "comment"), nullableString),
					},
					where: and(
						entitySchemaPredicate(workout, "workout", input.reference),
						...(input.beforeStartedAt === undefined
							? []
							: [lt(startedAt, castDate(literal(input.beforeStartedAt)))]),
						...(input.excludeWorkoutId === undefined
							? []
							: [neq(column(workout, "id"), literal(input.excludeWorkoutId))]),
						exists(set, {
							where: and(
								workoutSetWhere(set, input.reference),
								eq(column(set, "entityId"), literal(input.exerciseId)),
								eq(column(set, "sessionEntityId"), column(workout, "id")),
							),
						}),
					),
				}),
			},
		};
	},
);

export const workoutHistorySetsRecipe = defineRecipe(
	(input: {
		readonly workoutId: string;
		readonly exerciseId: string;
		readonly after?: string | undefined;
		readonly reference: PluginIdentityReference;
	}) => {
		const event = table("event", "historySet");
		const workout = table("entity", "historySetWorkout");
		return {
			map: ({ sets }) => Result.succeed(sets),
			queries: {
				sets: selectedRows(event, {
					limit: rowLimit,
					after: input.after,
					selection: workoutSetSelection(event),
					joins: [
						join("inner", workout, eq(column(event, "sessionEntityId"), column(workout, "id"))),
					],
					orderBy: [
						ascending(propertyNumber(event, "exerciseOrder")),
						ascending(propertyNumber(event, "setOrder")),
						ascending(column(event, "id")),
					],
					where: and(
						workoutSetWhere(event, input.reference),
						entitySchemaPredicate(workout, "workout", input.reference),
						eq(column(event, "entityId"), literal(input.exerciseId)),
						eq(column(event, "sessionEntityId"), literal(input.workoutId)),
					),
				}),
			},
		};
	},
);

export const workoutExercisePreviousValuesRecipe = defineRecipe(
	(input: {
		readonly exerciseId: string;
		readonly beforeStartedAt: string;
		readonly excludeWorkoutId: string;
		readonly after?: string | undefined;
		readonly recordedKind: ExerciseKind;
		readonly reference: PluginIdentityReference;
	}) => {
		const event = table("event", "previousWorkoutSet");
		const workout = table("entity", "previousWorkout");
		const startedAt = propertyDate(workout, "startedAt");
		return {
			map: ({ sets }) => Result.succeed(sets),
			queries: {
				sets: selectedRows(event, {
					limit: rowLimit,
					after: input.after,
					joins: [
						join("inner", workout, eq(column(event, "sessionEntityId"), column(workout, "id"))),
					],
					selection: {
						...workoutSetSelection(event),
						workoutStartedAt: selectedField(startedAt, IsoDateString),
						workoutId: selectedField(column(event, "sessionEntityId"), EntityId),
					},
					orderBy: [
						descending(startedAt),
						ascending(column(event, "sessionEntityId")),
						ascending(propertyNumber(event, "exerciseOrder")),
						ascending(propertyNumber(event, "setOrder")),
						ascending(column(event, "id")),
					],
					where: and(
						workoutSetWhere(event, input.reference),
						entitySchemaPredicate(workout, "workout", input.reference),
						eq(column(event, "entityId"), literal(input.exerciseId)),
						eq(property(event, "exerciseKind"), literal(input.recordedKind)),
						lt(startedAt, castDate(literal(input.beforeStartedAt))),
						neq(column(event, "sessionEntityId"), literal(input.excludeWorkoutId)),
					),
				}),
			},
		};
	},
);

export type WorkoutHistoryResult = Recipe.Success<typeof workoutHistoryRecipe>;
export type WorkoutHistorySetResult = Recipe.Success<typeof workoutHistorySetsRecipe>;
export type WorkoutExercisePreviousValuesResult = Recipe.Success<
	typeof workoutExercisePreviousValuesRecipe
>;
