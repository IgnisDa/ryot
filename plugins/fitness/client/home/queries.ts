import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import {
	homeTemplatesRecipe,
	muscleActivityRecipe,
	recentPersonalBestsRecipe,
	type HomePersonalBest,
	type HomeTemplate,
	type MuscleActivity,
} from "../../shared/home-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	workoutExerciseTargetsRecipe,
	type WorkoutExerciseTargets,
} from "../../shared/workout-list-recipes";
import { batched, loadWorkoutPages } from "../workouts/queries";

const TEMPLATE_LIMIT = 8;
const PERSONAL_BEST_LIMIT = 5;

export const latestWorkoutQuery = createRyotQuery(({ client }) =>
	loadWorkoutPages(client, { pages: 1, limit: 1, search: "" }),
);

export const muscleActivityQuery = createRyotQuery<
	{ readonly weekStartAt: string },
	readonly MuscleActivity[]
>(({ input, client }) =>
	client.data.query(
		muscleActivityRecipe({ ...input, reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
	),
);

export const recentPersonalBestsQuery = createRyotQuery<
	{ readonly since: string },
	{ readonly items: readonly HomePersonalBest[]; readonly recentCount: number }
>(({ input, client }) =>
	client.data.query(
		recentPersonalBestsRecipe({
			...input,
			limit: PERSONAL_BEST_LIMIT,
			reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
		}),
	),
);

export const homeTemplatesQuery = createRyotQuery<
	void,
	{
		readonly templates: readonly HomeTemplate[];
		readonly targets: readonly WorkoutExerciseTargets[];
	}
>(({ client }) =>
	Effect.gen(function* () {
		const reference = client.pluginIdentity(PLUGIN_PACKAGE_ID);
		const templates = yield* client.data.query(
			homeTemplatesRecipe({ reference, limit: TEMPLATE_LIMIT }),
		);
		const exerciseIds = new Set(templates.flatMap(({ exerciseIds: ids }) => ids));
		const targets = yield* batched(exerciseIds, (ids) =>
			client.data.query(workoutExerciseTargetsRecipe({ reference, exerciseIds: ids })),
		);
		return { targets, templates };
	}),
);
