import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	coalesce,
	column,
	defineRecipe,
	eq,
	gt,
	IsoDateString,
	join,
	literal,
	or,
	type Recipe,
	schemaOwnerPredicate,
	selectedField,
	selectedRows,
	table,
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
		readonly workoutId: string;
		readonly after?: string | undefined;
		readonly reference: PluginIdentityReference;
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

export const workoutRecordRoundSize = 100;

const unorderedLast = 2_147_483_647;

export const WorkoutRecordPosition = Schema.Struct({
	id: Schema.String,
	setOrder: Schema.Finite,
	sessionId: Schema.String,
	occurredAt: IsoDateString,
	exerciseOrder: Schema.Finite,
	workoutStartedAt: IsoDateString,
});
export type WorkoutRecordPosition = typeof WorkoutRecordPosition.Type;

export const workoutRecordBatchRecipe = defineRecipe(
	(input: {
		readonly reference: PluginIdentityReference;
		readonly streams: ReadonlyArray<{
			readonly exerciseId: string;
			readonly after: null | WorkoutRecordPosition;
		}>;
	}) => {
		const event = table("event", "workoutRecord");
		const exercise = table("entity", "exercise");
		const workout = table("entity", "workout");
		const workoutStartedAt = propertyDate(workout, "startedAt");
		const exerciseOrder = coalesce(propertyNumber(event, "exerciseOrder"), literal(unorderedLast));
		const setOrder = coalesce(propertyNumber(event, "setOrder"), literal(unorderedLast));
		const seek = (after: WorkoutRecordPosition) => {
			const keys = [
				{ expr: column(event, "occurredAt"), value: castDate(literal(after.occurredAt)) },
				{ expr: workoutStartedAt, value: castDate(literal(after.workoutStartedAt)) },
				{ value: literal(after.sessionId), expr: column(event, "sessionEntityId") },
				{ expr: exerciseOrder, value: literal(after.exerciseOrder) },
				{ expr: setOrder, value: literal(after.setOrder) },
				{ value: literal(after.id), expr: column(event, "id") },
			];
			return or(
				...keys.map(({ expr, value }, index) =>
					and(...keys.slice(0, index).map((key) => eq(key.expr, key.value)), gt(expr, value)),
				),
			);
		};
		return {
			map: ({ records }) => Result.succeed(records),
			queries: {
				records: selectedRows(event, {
					limit: workoutRecordRoundSize,
					joins: [
						join("inner", exercise, eq(column(event, "entityId"), column(exercise, "id"))),
						join("inner", workout, eq(column(event, "sessionEntityId"), column(workout, "id"))),
					],
					orderBy: [
						ascending(column(event, "entityId")),
						ascending(column(event, "occurredAt")),
						ascending(workoutStartedAt),
						ascending(column(event, "sessionEntityId")),
						ascending(exerciseOrder),
						ascending(setOrder),
						ascending(column(event, "id")),
					],
					where: and(
						schemaOwnerPredicate(exercise, "entitySchemaPluginId", input.reference),
						schemaOwnerPredicate(workout, "entitySchemaPluginId", input.reference),
						schemaOwnerPredicate(event, "eventSchemaPluginId", input.reference),
						eq(column(event, "eventSchemaSlug"), literal("workout-set")),
						eq(column(exercise, "entitySchemaSlug"), literal("exercise")),
						eq(column(workout, "entitySchemaSlug"), literal("workout")),
						or(
							...input.streams.map(({ after, exerciseId }) =>
								and(
									eq(column(event, "entityId"), literal(exerciseId)),
									...(after === null ? [] : [seek(after)]),
								),
							),
						),
					),
					selection: {
						id: selectedField(column(event, "id"), EventId),
						setOrder: selectedField(setOrder, Schema.Finite),
						exerciseOrder: selectedField(exerciseOrder, Schema.Finite),
						exerciseId: selectedField(column(event, "entityId"), EntityId),
						workoutStartedAt: selectedField(workoutStartedAt, IsoDateString),
						occurredAt: selectedField(column(event, "occurredAt"), IsoDateString),
						sessionId: selectedField(column(event, "sessionEntityId"), Schema.String),
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

export type WorkoutRecordBatchResult = Recipe.Success<typeof workoutRecordBatchRecipe>;
