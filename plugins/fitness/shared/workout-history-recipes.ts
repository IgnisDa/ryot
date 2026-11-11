import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
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
	NullableNumber,
	parameters,
	type Recipe,
	schemaOwnerPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId, EventId, type PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import { projectionNumber, property, propertyDate, propertyNumber } from "./entity-selections";
import { exerciseKindSchema } from "./exercise-kinds";
import { WorkoutSetLotSchema } from "./workout-set";

type Table = Parameters<typeof column>[0];
const rowLimit = 100;
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
	rpe: selectedField(propertyNumber(event, "rpe"), NullableNumber),
	reps: selectedField(propertyNumber(event, "reps"), NullableNumber),
	pace: selectedField(projectionNumber(event, "pace"), NullableNumber),
	occurredAt: selectedField(column(event, "occurredAt"), IsoDateString),
	oneRm: selectedField(projectionNumber(event, "oneRm"), NullableNumber),
	weight: selectedField(propertyNumber(event, "weight"), NullableNumber),
	volume: selectedField(projectionNumber(event, "volume"), NullableNumber),
	restTime: selectedField(propertyNumber(event, "restTime"), NullableNumber),
	setOrder: selectedField(propertyNumber(event, "setOrder"), NullableNumber),
	duration: selectedField(propertyNumber(event, "duration"), NullableNumber),
	distance: selectedField(propertyNumber(event, "distance"), NullableNumber),
	recordedKind: selectedField(property(event, "exerciseKind"), nullableExerciseKind),
	setLot: selectedField(property(event, "setLot"), Schema.NullOr(WorkoutSetLotSchema)),
	exerciseOrder: selectedField(propertyNumber(event, "exerciseOrder"), NullableNumber),
});
export const workoutHistoryRecipe = (input: { readonly reference: PluginIdentityReference }) => {
	const inputParameters = parameters({
		fields: {
			beforeStartedAt: {
				type: "datetime",
				label: "Before Started At",
				description: "Before Started At for this selection",
			},
			excludeWorkoutId: {
				type: "string",
				label: "Exclude Workout Id",
				description: "Exclude Workout Id for this selection",
			},
			exerciseId: {
				type: "string",
				label: "Exercise Id",
				validation: { required: true },
				description: "Exercise Id for this selection",
			},
		},
	});
	const workout = table("entity", "historyWorkout");
	const set = table("event", "historyWorkoutSet");
	const startedAt = propertyDate(workout, "startedAt");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ workouts }) => Result.succeed(workouts),
		queries: {
			workouts: selectedRows(workout, {
				limit: rowLimit,
				orderBy: [descending(startedAt), ascending(column(workout, "id"))],
				selection: {
					id: selectedField(column(workout, "id"), EntityId),
					startedAt: selectedField(startedAt, IsoDateString),
					name: selectedField(column(workout, "name"), Schema.String),
					comment: selectedField(property(workout, "comment"), nullableString),
				},
				where: and(
					entitySchemaPredicate(workout, "workout", input.reference),
					inputParameters.whenSet(
						"beforeStartedAt",
						lt(startedAt, inputParameters.value("beforeStartedAt")),
					),
					inputParameters.whenSet(
						"excludeWorkoutId",
						neq(column(workout, "id"), inputParameters.value("excludeWorkoutId")),
					),
					exists(set, {
						where: and(
							workoutSetWhere(set, input.reference),
							eq(column(set, "entityId"), inputParameters.value("exerciseId")),
							eq(column(set, "sessionEntityId"), column(workout, "id")),
						),
					}),
				),
			}),
		},
	});
};
export const workoutHistorySetsRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const inputParameters = parameters({
		fields: {
			workoutId: {
				type: "string",
				label: "Workout Id",
				validation: { required: true },
				description: "Workout Id for this selection",
			},
			exerciseId: {
				type: "string",
				label: "Exercise Id",
				validation: { required: true },
				description: "Exercise Id for this selection",
			},
		},
	});
	const event = table("event", "historySet");
	const workout = table("entity", "historySetWorkout");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ sets }) => Result.succeed(sets),
		queries: {
			sets: selectedRows(event, {
				limit: rowLimit,
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
					eq(column(event, "entityId"), inputParameters.value("exerciseId")),
					eq(column(event, "sessionEntityId"), inputParameters.value("workoutId")),
				),
			}),
		},
	});
};
export const workoutExercisePreviousValuesRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const inputParameters = parameters({
		fields: {
			exerciseId: {
				type: "string",
				label: "exerciseId",
				validation: { required: true },
				description: "exerciseId for this selection",
			},
			beforeStartedAt: {
				type: "datetime",
				label: "beforeStartedAt",
				validation: { required: true },
				description: "beforeStartedAt for this selection",
			},
			excludeWorkoutId: {
				type: "string",
				label: "excludeWorkoutId",
				validation: { required: true },
				description: "excludeWorkoutId for this selection",
			},
			recordedKind: {
				type: "enum",
				label: "recordedKind",
				validation: { required: true },
				description: "recordedKind for this selection",
				choices: {
					kind: "static",
					values: [
						{ value: "reps_and_weight", label: "reps_and_weight" },
						{ value: "reps", label: "reps" },
						{ value: "duration", label: "duration" },
						{ value: "distance_and_duration", label: "distance_and_duration" },
						{ value: "reps_and_duration", label: "reps_and_duration" },
						{ value: "reps_and_duration_and_distance", label: "reps_and_duration_and_distance" },
					],
				},
			},
		},
	});
	const event = table("event", "previousWorkoutSet");
	const workout = table("entity", "previousWorkout");
	const startedAt = propertyDate(workout, "startedAt");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ sets }) => Result.succeed(sets),
		queries: {
			sets: selectedRows(event, {
				limit: rowLimit,
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
					eq(column(event, "entityId"), inputParameters.value("exerciseId")),
					eq(property(event, "exerciseKind"), inputParameters.value("recordedKind")),
					lt(startedAt, inputParameters.value("beforeStartedAt")),
					neq(column(event, "sessionEntityId"), inputParameters.value("excludeWorkoutId")),
				),
			}),
		},
	});
};
export type WorkoutHistoryResult = Recipe.Success<ReturnType<typeof workoutHistoryRecipe>>;
export type WorkoutHistorySetResult = Recipe.Success<ReturnType<typeof workoutHistorySetsRecipe>>;
export type WorkoutExercisePreviousValuesResult = Recipe.Success<
	ReturnType<typeof workoutExercisePreviousValuesRecipe>
>;
