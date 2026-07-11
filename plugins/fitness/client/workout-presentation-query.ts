import { Result, Schema } from "@ryot-app/client-sdk/effect";
import {
	and,
	ascending,
	castDate,
	castNumber,
	castText,
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

export const workoutPresentationRecipe = defineRecipe((entityIds: readonly string[]) => {
	const workout = table("entity", "presentationWorkout");
	const event = table("event", "presentationSet");
	const exercise = table("entity", "presentationExercise");
	const workoutProperty = (key: string) => jsonPath(column(workout, "properties"), key);
	const setProperty = (key: string) => jsonPath(column(event, "properties"), key);
	const nullableNumber = Schema.NullOr(Schema.Number);
	return {
		queries: {
			workouts: selectedRows(workout, {
				limit: 100,
				include: {
					sets: selectedInclude(event, {
						limit: 100,
						joins: [join("inner", exercise, eq(column(event, "entityId"), column(exercise, "id")))],
						orderBy: [
							ascending(castNumber(setProperty("exerciseOrder"))),
							ascending(castNumber(setProperty("setOrder"))),
						],
						where: and(
							eq(column(event, "sessionEntityId"), column(workout, "id")),
							eq(column(event, "eventSchemaSlug"), literal("workout-set")),
							eq(column(exercise, "entitySchemaSlug"), literal("exercise")),
						),
						selection: {
							reps: selectedField(castNumber(setProperty("reps")), nullableNumber),
							exerciseId: selectedField(column(exercise, "id"), Schema.String),
							weight: selectedField(castNumber(setProperty("weight")), nullableNumber),
							exerciseName: selectedField(column(exercise, "name"), Schema.String),
							setOrder: selectedField(castNumber(setProperty("setOrder")), nullableNumber),
							duration: selectedField(castNumber(setProperty("duration")), nullableNumber),
							distance: selectedField(castNumber(setProperty("distance")), nullableNumber),
							exerciseOrder: selectedField(
								castNumber(setProperty("exerciseOrder")),
								nullableNumber,
							),
							unitSystem: selectedField(
								castText(setProperty("unitSystem")),
								Schema.NullOr(Schema.String),
							),
						},
					}),
				},
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
					startedAt: selectedField(
						castDate(workoutProperty("startedAt")),
						Schema.NullOr(Schema.String),
					),
					endedAt: selectedField(
						castDate(workoutProperty("endedAt")),
						Schema.NullOr(Schema.String),
					),
				},
			}),
		},
		map: ({ workouts }) => {
			return Result.succeed(
				workouts.items.map(({ sets, ...item }) => {
					const exercises = new Map<
						string,
						{ name: string; order: number | null; sets: (typeof sets.items)[number][] }
					>();
					for (const set of sets.items) {
						const current = exercises.get(set.exerciseId) ?? {
							sets: [],
							name: set.exerciseName,
							order: set.exerciseOrder,
						};
						current.sets.push(set);
						exercises.set(set.exerciseId, current);
					}
					return {
						...item,
						exercises: [...exercises.entries()]
							.map(([id, groupedExercise]) => Object.assign({ id }, groupedExercise))
							.sort((left, right) => (left.order ?? 0) - (right.order ?? 0)),
					};
				}),
			);
		},
	};
});

export type WorkoutPresentationResult = Recipe.Success<typeof workoutPresentationRecipe>;
export type WorkoutPresentationData = WorkoutPresentationResult[number];
