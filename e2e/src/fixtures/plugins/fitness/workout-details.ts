import {
	type WorkoutDetails,
	workoutDetailsExercisesRecipe,
	workoutDetailsRecipe,
	workoutDetailsSetsRecipe,
} from "@ryot-app/fitness-plugin/workout-details-recipes";
import { Effect } from "effect";

import { collectRyotQLRecipeItems, executeRyotQLRecipe, getEntity } from "~/fixtures/kernel";
import type { Client } from "~/fixtures/kernel/auth";
import { requirePresent } from "~/support/assertions";

export const readWorkoutDetails = (client: Client, workoutId: string) =>
	Effect.gen(function* () {
		const workoutEntity = yield* getEntity(client, workoutId);
		const pluginId = requirePresent(
			workoutEntity.entitySchemaPluginId,
			"Expected a Fitness workout owner",
		);
		const reference: Parameters<typeof workoutDetailsRecipe>[0]["reference"] = {
			pluginId,
			kind: "local",
		};
		const workout = requirePresent(
			yield* executeRyotQLRecipe(client, workoutDetailsRecipe({ reference, workoutId })),
			`Expected workout ${workoutId}`,
		);
		const exercises = yield* collectRyotQLRecipeItems(client, (after) =>
			workoutDetailsExercisesRecipe({ after, reference, workoutId }),
		);
		const sets = yield* collectRyotQLRecipeItems(client, (after) =>
			workoutDetailsSetsRecipe({ after, reference, workoutId }),
		);
		const detailsExercises = yield* Effect.forEach(exercises, (exercise) =>
			Effect.gen(function* () {
				const previousWorkoutId = exercise.previousWorkoutId;
				const previousSets =
					previousWorkoutId === null
						? []
						: yield* collectRyotQLRecipeItems(client, (after) =>
								workoutDetailsSetsRecipe({
									after,
									reference,
									exerciseId: exercise.id,
									workoutId: previousWorkoutId,
								}),
							);

				return {
					...exercise,
					previousSets: { items: previousSets },
					sets: { items: sets.filter((set) => set.exerciseId === exercise.id) },
				};
			}),
		);

		const details: WorkoutDetails = { ...workout, exercises: { items: detailsExercises } };
		return details;
	});
