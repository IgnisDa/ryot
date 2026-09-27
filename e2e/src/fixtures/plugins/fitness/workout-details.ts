import {
	workoutDetailsExercisesRecipe,
	workoutDetailsRecipe,
	workoutDetailsSetsRecipe,
	type WorkoutDetails,
} from "@ryot-app/fitness-plugin/workout-details-recipes";
import type { Recipe } from "@ryot-app/plugin-kit/ryotql";
import { Effect } from "effect";

import { executeRyotQLRecipe, getEntity } from "~/fixtures/kernel";
import type { Client } from "~/fixtures/kernel/auth";
import { assertCondition, requirePresent } from "~/support/assertions";

type PageInfo = Recipe.Success<typeof workoutDetailsExercisesRecipe>["pageInfo"];
const readAllPages = <Item, Error, Requirements>(
	readPage: (
		after: string | undefined,
	) => Effect.Effect<
		{ readonly items: ReadonlyArray<Item>; readonly pageInfo: PageInfo },
		Error,
		Requirements
	>,
) =>
	Effect.gen(function* () {
		const items: Item[] = [];
		const cursors = new Set<string>();
		let after: string | undefined;
		let hasMore: boolean;

		do {
			const page = yield* readPage(after);
			items.push(...page.items);
			hasMore = page.pageInfo.hasMore;
			if (hasMore) {
				const nextCursor = page.pageInfo.nextCursor;
				assertCondition(nextCursor !== null, "Paginated workout details have no next cursor");
				assertCondition(
					!cursors.has(nextCursor),
					"Paginated workout details repeated a next cursor",
				);
				cursors.add(nextCursor);
				after = nextCursor;
			}
		} while (hasMore);
		return items;
	});

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
		const exercises = yield* readAllPages((after) =>
			executeRyotQLRecipe(client, workoutDetailsExercisesRecipe({ after, reference, workoutId })),
		);
		const sets = yield* readAllPages((after) =>
			executeRyotQLRecipe(client, workoutDetailsSetsRecipe({ after, reference, workoutId })),
		);
		const detailsExercises = yield* Effect.forEach(exercises, (exercise) =>
			Effect.gen(function* () {
				const previousWorkoutId = exercise.previousWorkoutId;
				const previousSets =
					previousWorkoutId === null
						? []
						: yield* readAllPages((after) =>
								executeRyotQLRecipe(
									client,
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
		);

		const details: WorkoutDetails = { ...workout, exercises: { items: detailsExercises } };
		return details;
	});
