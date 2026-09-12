import { Result, Schema } from "@ryot-app/client-sdk/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	inArray,
	join,
	jsonPath,
	literal,
	selectedField,
	selectedInclude,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/client-sdk/ryotql";

import { property, propertyNumber, workoutDatesSelection } from "../shared/entity-selections";

export const workoutPresentationRecipe = defineRecipe((entityIds: readonly string[]) => {
	const workout = table("entity", "presentationWorkout");
	const event = table("event", "presentationSet");
	const exercise = table("entity", "presentationExercise");
	const nullableNumber = Schema.NullOr(Schema.Finite);
	return {
		map: ({ workouts }) => {
			return Result.succeed(
				workouts.items.map(({ sets, exerciseNotes, ...item }) => {
					const createExercise = (set: (typeof sets.items)[number]) => ({
						id: set.exerciseId,
						name: set.exerciseName,
						order: set.exerciseOrder,
						sets: new Array<typeof set>(),
						notes:
							exerciseNotes?.find(({ exerciseOrder }) => exerciseOrder === set.exerciseOrder)
								?.notes ?? [],
					});
					const exercises = new Map<string, ReturnType<typeof createExercise>>();
					for (const set of sets.items) {
						const key = `${set.exerciseOrder}:${set.exerciseId}`;
						const current = exercises.get(key) ?? createExercise(set);
						current.sets.push(set);
						exercises.set(key, current);
					}
					return {
						...item,
						exercises: [...exercises.values()].sort(
							(left, right) => (left.order ?? 0) - (right.order ?? 0),
						),
					};
				}),
			);
		},
		queries: {
			workouts: selectedRows(workout, {
				limit: 100,
				orderBy: [ascending(column(workout, "id"))],
				where: and(
					eq(column(workout, "entitySchemaSlug"), literal("workout")),
					inArray(
						column(workout, "id"),
						entityIds.map((entityId) => literal(entityId)),
					),
				),
				selection: {
					id: selectedField(column(workout, "id"), Schema.String),
					name: selectedField(column(workout, "name"), Schema.String),
					...workoutDatesSelection(workout),
					exerciseNotes: selectedField(
						jsonPath(column(workout, "properties"), "exerciseNotes"),
						Schema.NullOr(
							Schema.Array(
								Schema.Struct({
									notes: Schema.Array(Schema.String),
									exerciseOrder: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
								}),
							),
						),
					),
				},
				include: {
					sets: selectedInclude(event, {
						limit: 100,
						joins: [join("inner", exercise, eq(column(event, "entityId"), column(exercise, "id")))],
						orderBy: [
							ascending(propertyNumber(event, "exerciseOrder")),
							ascending(propertyNumber(event, "setOrder")),
						],
						where: and(
							eq(column(event, "sessionEntityId"), column(workout, "id")),
							eq(column(event, "eventSchemaSlug"), literal("workout-set")),
							eq(column(exercise, "entitySchemaSlug"), literal("exercise")),
						),
						selection: {
							exerciseId: selectedField(column(exercise, "id"), Schema.String),
							reps: selectedField(propertyNumber(event, "reps"), nullableNumber),
							exerciseName: selectedField(column(exercise, "name"), Schema.String),
							weight: selectedField(propertyNumber(event, "weight"), nullableNumber),
							setOrder: selectedField(propertyNumber(event, "setOrder"), nullableNumber),
							duration: selectedField(propertyNumber(event, "duration"), nullableNumber),
							distance: selectedField(propertyNumber(event, "distance"), nullableNumber),
							exerciseOrder: selectedField(propertyNumber(event, "exerciseOrder"), nullableNumber),
							unitSystem: selectedField(
								property(event, "unitSystem"),
								Schema.NullOr(Schema.String),
							),
						},
					}),
				},
			}),
		},
	};
});

export type WorkoutPresentationResult = Recipe.Success<typeof workoutPresentationRecipe>;
export type WorkoutPresentationData = WorkoutPresentationResult[number];
