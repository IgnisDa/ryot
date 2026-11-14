import { readCursorPages, type RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	type WorkoutDetails,
	workoutDetailsExercisesRecipe,
	workoutDetailsRecipe,
	workoutDetailsSetsRecipe,
} from "../../shared/workout-details-recipes";
import { workoutTaxonomyRecipe } from "../../shared/workout-taxonomy-recipes";

const readItems = <A>(read: Parameters<typeof readCursorPages<A, RyotClientError>>[0]) =>
	Effect.map(readCursorPages(read), ({ items }) => items);

export const workoutDetailsQuery = createRyotQuery<
	{ readonly entityId: string },
	null | WorkoutDetails
>(
	({ input, client }) =>
		Effect.gen(function* () {
			const reference = client.pluginIdentity(PLUGIN_PACKAGE_ID);
			const workoutId = input.entityId;
			const workout = yield* client.data.query(workoutDetailsRecipe({ reference: reference }), {
				workoutId,
			});
			if (workout === null) {
				return null;
			}
			const exercises = yield* readItems((after) =>
				client.data.query(
					workoutDetailsExercisesRecipe({ reference: reference }),
					{ workoutId },
					{ pages: { exercises: { after: after } } },
				),
			);
			const sets = yield* readItems((after) =>
				client.data.query(
					workoutDetailsSetsRecipe({ reference: reference }),
					{ workoutId },
					{ pages: { sets: { after: after } } },
				),
			);
			const taxonomy = yield* readItems((after) =>
				client.data.query(
					workoutTaxonomyRecipe({ reference: reference }),
					{ workoutIds: [workoutId] },
					{ pages: { taxonomy: { after: after } } },
				),
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
											workoutDetailsSetsRecipe({ reference: reference }),
											{ exerciseId: exercise.id, workoutId: previousWorkoutId },
											{ pages: { sets: { after: after } } },
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
			return { ...workout, taxonomy, exercises: { items: loaded } };
		}),
	{
		entityWatch: ({ data, input }) => ({
			foreground: [input.entityId],
			visible: data?.exercises.items.map(({ id }) => id) ?? [],
		}),
	},
);
