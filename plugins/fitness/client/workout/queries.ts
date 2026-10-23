import { readCursorPages } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	type WorkoutDetails,
	workoutDetailsExercisesRecipe,
	workoutDetailsRecipe,
	workoutDetailsSetsRecipe,
} from "../../shared/workout-details-recipes";

const readItems = <A>(read: Parameters<typeof readCursorPages<A>>[0]) =>
	Effect.map(readCursorPages(read), ({ items }) => items);

export const workoutDetailsQuery = createRyotQuery<
	{ readonly entityId: string },
	WorkoutDetails | null
>(
	({ input, client }) =>
		Effect.gen(function* () {
			const reference = client.pluginIdentity(PLUGIN_PACKAGE_ID);
			const workoutId = input.entityId;
			const workout = yield* client.data.query(workoutDetailsRecipe({ reference, workoutId }));
			if (workout === null) {
				return null;
			}
			const exercises = yield* readItems((after) =>
				client.data.query(workoutDetailsExercisesRecipe({ after, reference, workoutId })),
			);
			const sets = yield* readItems((after) =>
				client.data.query(workoutDetailsSetsRecipe({ after, reference, workoutId })),
			);
			const loaded = yield* Effect.forEach(
				exercises,
				(exercise) =>
					Effect.gen(function* () {
						const previousWorkoutId = exercise.previousWorkoutId;
						const previousSets =
							previousWorkoutId === null
								? []
								: yield* readItems((after) =>
										client.data.query(
											workoutDetailsSetsRecipe({
												after,
												reference,
												exerciseId: exercise.id,
												workoutId: previousWorkoutId,
											}),
										),
									);
						return {
							...exercise,
							previousSets: { items: previousSets },
							sets: { items: sets.filter((set) => set.exerciseId === exercise.id) },
						};
					}),
				{ concurrency: 4 },
			);
			return { ...workout, exercises: { items: loaded } };
		}),
	{
		entityWatch: ({ data, input }) => ({
			foreground: [input.entityId],
			visible: data?.exercises.items.map(({ id }) => id) ?? [],
		}),
		refreshWhile: ({ data }) =>
			data?.exercises.items.some((exercise) =>
				exercise.sets.items.some((set) => set.recordStatus === "pending"),
			) ?? false,
	},
);
