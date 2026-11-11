import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import type { TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { reportingArguments } from "@ryot-app/plugin-client-sdk/ryotql";

import {
	type HomePersonalBest,
	type HomeTemplate,
	homeTemplatesRecipe,
	type MuscleActivity,
	muscleActivityRecipe,
	recentPersonalBestsRecipe,
} from "../../shared/home-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	type WorkoutExerciseTargets,
	workoutExerciseTargetsRecipe,
} from "../../shared/workout-list-recipes";
import { batched, loadWorkoutPages } from "../workouts/queries";
import { RECENT_DAYS } from "./model";

const TEMPLATE_LIMIT = 8;
const PERSONAL_BEST_LIMIT = 5;

export const latestWorkoutQuery = createRyotQuery(({ client }) =>
	loadWorkoutPages(client, { pages: 1, limit: 1, search: "" }),
);

export const muscleActivityQuery = createRyotQuery<
	{ readonly timeZone: TimeZone },
	readonly MuscleActivity[]
>(({ client }) =>
	client.data.query(
		muscleActivityRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
		reportingArguments({
			grouping: "day",
			comparison: "none",
			range: { days: 7, kind: "rolling" },
		}),
	),
);

export const recentPersonalBestsQuery = createRyotQuery<
	{ readonly timeZone: TimeZone },
	{ readonly recentCount: number; readonly items: readonly HomePersonalBest[] }
>(({ client }) =>
	client.data.query(
		recentPersonalBestsRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
		reportingArguments({
			grouping: "day",
			comparison: "none",
			range: { kind: "rolling", days: RECENT_DAYS },
		}),
		{ pages: { recent: { limit: PERSONAL_BEST_LIMIT } } },
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
			homeTemplatesRecipe({ reference: reference }),
			{},
			{ pages: { templates: { limit: TEMPLATE_LIMIT } } },
		);
		const exerciseIds = new Set(templates.flatMap(({ exerciseIds: ids }) => ids));
		const targets = yield* batched(exerciseIds, (ids) =>
			client.data.query(workoutExerciseTargetsRecipe({ reference }), { exerciseIds: ids }),
		);
		return { targets, templates };
	}),
);
