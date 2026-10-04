import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import {
	homeTemplatesRecipe,
	muscleActivityRecipe,
	recentPersonalBestsRecipe,
	type HomeTemplate,
} from "../../shared/home-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	workoutExerciseTargetsRecipe,
	type WorkoutExerciseTargets,
} from "../../shared/workout-list-recipes";
import { DAY_MS } from "../measurements/model";
import { batched, loadWorkoutPages } from "../workouts/queries";
import { RECENT_DAYS } from "./model";

const TEMPLATE_LIMIT = 8;
const PERSONAL_BEST_LIMIT = 5;

export const latestWorkoutQuery = createRyotQuery(({ client }) =>
	loadWorkoutPages(client, { pages: 1, limit: 1, search: "" }),
);

export const muscleActivityQuery = createRyotQuery(({ client, schedule }) =>
	Effect.suspend(() =>
		client.data.query(
			muscleActivityRecipe({
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
				weekStartAt: DateTime.formatIso(DateTime.makeUnsafe(schedule.now() - 7 * DAY_MS)),
			}),
		),
	),
);

export const recentPersonalBestsQuery = createRyotQuery(({ client, schedule }) =>
	Effect.suspend(() =>
		client.data.query(
			recentPersonalBestsRecipe({
				limit: PERSONAL_BEST_LIMIT,
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
				since: DateTime.formatIso(DateTime.makeUnsafe(schedule.now() - RECENT_DAYS * DAY_MS)),
			}),
		),
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
