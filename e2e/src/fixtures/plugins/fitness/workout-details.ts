import {
	type WorkoutDetails,
	workoutDetailsExercisesRecipe,
	workoutDetailsRecipe,
	workoutDetailsSetsRecipe,
} from "@ryot-app/fitness-plugin/workout-details-recipes";
import { workoutTaxonomyRecipe } from "@ryot-app/fitness-plugin/workout-taxonomy-recipes";
import { Effect } from "effect";

import { getEntity } from "~/fixtures/kernel";
import type { Client } from "~/fixtures/kernel/auth";
import { requirePresent } from "~/support/assertions";

import { fitnessRecipes } from "./exercises";

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
			yield* fitnessRecipes.execute(client, workoutDetailsRecipe({ reference }), { workoutId }),
			`Expected workout ${workoutId}`,
		);
		const exercises = yield* fitnessRecipes.collect(
			client,
			workoutDetailsExercisesRecipe({ reference }),
			{ workoutId },
			"exercises",
		);
		const sets = yield* fitnessRecipes.collect(
			client,
			workoutDetailsSetsRecipe({ reference }),
			{ workoutId },
			"sets",
		);
		const taxonomy = yield* fitnessRecipes.collect(
			client,
			workoutTaxonomyRecipe({ reference }),
			{ workoutIds: [workoutId] },
			"taxonomy",
		);
		const detailsExercises = yield* Effect.forEach(exercises, (exercise) =>
			Effect.gen(function* () {
				const previousWorkoutId = exercise.previousWorkoutId;
				const previousSets =
					previousWorkoutId === null
						? []
						: yield* fitnessRecipes.collect(
								client,
								workoutDetailsSetsRecipe({ reference }),
								{ exerciseId: exercise.id, workoutId: previousWorkoutId },
								"sets",
							);

				return {
					...exercise,
					previousSets: { items: previousSets },
					sets: { items: sets.filter((set) => set.exerciseId === exercise.id) },
				};
			}),
		);

		const details: WorkoutDetails = {
			...workout,
			taxonomy,
			exercises: { items: detailsExercises },
		};
		return details;
	});
