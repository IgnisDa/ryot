import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { resolveReportingSelection } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";

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
	{ readonly timeZone: string },
	readonly MuscleActivity[]
>(({ input, client, schedule }) =>
	Effect.suspend(() => {
		const { current } = resolveReportingSelection(
			{ grouping: "day", comparison: "none", range: { days: 7, kind: "rolling" } },
			{ now: schedule.now(), timeZone: input.timeZone },
		);
		if (current === null) {
			return Effect.die(new Error("Muscle activity requires a bounded reporting period"));
		}
		return client.data.query(
			muscleActivityRecipe({
				weekStartAt: current.startAt,
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			}),
		);
	}),
);

export const recentPersonalBestsQuery = createRyotQuery<
	{ readonly timeZone: string },
	{ readonly recentCount: number; readonly items: readonly HomePersonalBest[] }
>(({ input, client, schedule }) =>
	Effect.suspend(() => {
		const { current } = resolveReportingSelection(
			{ grouping: "day", comparison: "none", range: { kind: "rolling", days: RECENT_DAYS } },
			{ now: schedule.now(), timeZone: input.timeZone },
		);
		if (current === null) {
			return Effect.die(new Error("Recent personal bests require a bounded reporting period"));
		}
		return client.data.query(
			recentPersonalBestsRecipe({
				since: current.startAt,
				limit: PERSONAL_BEST_LIMIT,
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			}),
		);
	}),
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
