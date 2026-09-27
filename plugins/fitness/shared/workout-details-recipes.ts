import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	coalesce,
	column,
	conditional,
	defineRecipe,
	descending,
	eq,
	first,
	isNull,
	jsonPath,
	join,
	literal,
	lt,
	or,
	selectedField,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/plugin-kit/ryotql";

import { property, propertyDate, propertyNumber } from "./entity-selections";
import { exerciseKindSchema } from "./exercise-kinds";
import { PersonalBestSchema } from "./workout-records";

export const workoutSetsRecipe = defineRecipe(
	(input: {
		readonly workoutId: string;
		readonly limit: number;
		readonly after?: string | undefined;
	}) => {
		const event = table("event", "workoutSet");
		const workout = table("entity", "workout");
		const exercise = table("entity", "exercise");
		const eventStream = table("eventStream", "workoutSetStream");
		const eventStreamWork = table("eventStreamWork", "workoutSetWork");
		const previousEvent = table("event", "previousWorkoutSet");
		const previousWorkout = table("entity", "previousWorkout");
		const nullableNumber = Schema.NullOr(Schema.Finite);
		const nullableString = Schema.NullOr(Schema.String);
		const workoutStartedAt = propertyDate(workout, "startedAt");
		const previousWorkoutStartedAt = propertyDate(previousWorkout, "startedAt");
		const personalBests = jsonPath(column(event, "properties"), "personalBests");
		const streamPluginId = column(eventStream, "eventSchemaPluginId");
		const exercisePluginId = column(exercise, "entitySchemaPluginId");
		const eventPluginId = column(event, "eventSchemaPluginId");
		const processingStatus = first(eventStreamWork, {
			orderBy: [ascending(column(eventStreamWork, "id"))],
			joins: [
				join("inner", eventStream, eq(column(eventStreamWork, "id"), column(eventStream, "id"))),
			],
			select: conditional(
				eq(column(eventStreamWork, "status"), literal("failed")),
				literal("failed"),
				conditional(
					and(
						eq(column(eventStreamWork, "status"), literal("completed")),
						eq(column(eventStreamWork, "claimedRevision"), column(eventStream, "revision")),
					),
					literal("ready"),
					literal("pending"),
				),
			),
			where: and(
				eq(column(eventStream, "entityId"), column(exercise, "id")),
				or(
					and(isNull(streamPluginId), isNull(exercisePluginId)),
					eq(streamPluginId, exercisePluginId),
				),
				or(and(isNull(streamPluginId), isNull(eventPluginId)), eq(streamPluginId, eventPluginId)),
				eq(column(eventStream, "eventSchemaSlug"), column(event, "eventSchemaSlug")),
			),
		});
		const recordStatus = coalesce(
			processingStatus,
			conditional(isNull(personalBests), literal("pending"), literal("ready")),
		);
		return {
			map: ({ workoutSets }) => Result.succeed(workoutSets),
			queries: {
				workoutSets: selectedRows(event, {
					after: input.after,
					limit: Math.min(input.limit, 100),
					orderBy: [ascending(column(event, "id"))],
					joins: [
						join("inner", workout, eq(column(event, "sessionEntityId"), column(workout, "id"))),
						join("inner", exercise, eq(column(event, "entityId"), column(exercise, "id"))),
					],
					where: and(
						eq(column(event, "sessionEntityId"), literal(input.workoutId)),
						eq(column(event, "eventSchemaSlug"), literal("workout-set")),
						eq(column(workout, "entitySchemaSlug"), literal("workout")),
						eq(column(exercise, "entitySchemaSlug"), literal("exercise")),
					),
					selection: {
						id: selectedField(column(event, "id"), Schema.String),
						workoutId: selectedField(column(workout, "id"), Schema.String),
						exerciseId: selectedField(column(exercise, "id"), Schema.String),
						workoutStartedAt: selectedField(workoutStartedAt, nullableString),
						reps: selectedField(propertyNumber(event, "reps"), nullableNumber),
						pace: selectedField(propertyNumber(event, "pace"), nullableNumber),
						workoutName: selectedField(column(workout, "name"), Schema.String),
						oneRm: selectedField(propertyNumber(event, "oneRm"), nullableNumber),
						exerciseName: selectedField(column(exercise, "name"), Schema.String),
						occurredAt: selectedField(column(event, "occurredAt"), Schema.String),
						weight: selectedField(propertyNumber(event, "weight"), nullableNumber),
						volume: selectedField(propertyNumber(event, "volume"), nullableNumber),
						unitSystem: selectedField(property(event, "unitSystem"), nullableString),
						restTime: selectedField(propertyNumber(event, "restTime"), nullableNumber),
						duration: selectedField(propertyNumber(event, "duration"), nullableNumber),
						distance: selectedField(propertyNumber(event, "distance"), nullableNumber),
						setOrder: selectedField(propertyNumber(event, "setOrder"), nullableNumber),
						confirmedAt: selectedField(propertyDate(event, "confirmedAt"), nullableString),
						kind: selectedField(property(exercise, "kind"), Schema.NullOr(exerciseKindSchema)),
						exerciseOrder: selectedField(propertyNumber(event, "exerciseOrder"), nullableNumber),
						recordStatus: selectedField(
							recordStatus,
							Schema.Literals(["pending", "ready", "failed"]),
						),
						personalBests: selectedField(
							personalBests,
							Schema.NullOr(Schema.Array(PersonalBestSchema)),
						),
						previousSessionId: selectedField(
							first(previousEvent, {
								select: column(previousEvent, "sessionEntityId"),
								orderBy: [
									descending(previousWorkoutStartedAt),
									ascending(column(previousEvent, "sessionEntityId")),
								],
								joins: [
									join(
										"inner",
										previousWorkout,
										eq(column(previousEvent, "sessionEntityId"), column(previousWorkout, "id")),
									),
								],
								where: and(
									eq(column(previousEvent, "entityId"), column(exercise, "id")),
									eq(column(previousEvent, "eventSchemaSlug"), literal("workout-set")),
									or(
										and(
											isNull(column(previousEvent, "eventSchemaPluginId")),
											isNull(eventPluginId),
										),
										eq(column(previousEvent, "eventSchemaPluginId"), eventPluginId),
									),
									eq(column(previousWorkout, "entitySchemaSlug"), literal("workout")),
									lt(previousWorkoutStartedAt, workoutStartedAt),
								),
							}),
							nullableString,
						),
					},
				}),
			},
		};
	},
);

export type WorkoutSetsResult = Recipe.Success<typeof workoutSetsRecipe>;
