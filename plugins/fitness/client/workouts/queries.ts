import {
	readCursorPages,
	type RyotClient,
	type RyotClientError,
} from "@ryot-app/plugin-client-sdk";
import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import type { ViewFilter } from "@ryot-app/plugin-client-sdk/filters";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import { chunk } from "../../shared/collections";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	workoutCardsRecipe,
	type WorkoutComparison,
	workoutComparisonsRecipe,
	workoutCountRecipe,
	type WorkoutExerciseTargets,
	workoutExerciseTargetsRecipe,
	type WorkoutFilterPredicate,
	type WorkoutListItem,
	type WorkoutPeriodTotals,
	type WorkoutSummary,
	workoutSummaryRecipe,
	workoutWeeksRecipe,
} from "../../shared/workout-list-recipes";
import { compileWorkoutFilter } from "./filters";
import { type PeriodKey, summaryWindows } from "./model";

const LOOKUP_BATCH_SIZE = 100;

export type WorkoutPages = {
	readonly hasMore: boolean;
	readonly items: readonly WorkoutListItem[];
	readonly comparisons: readonly WorkoutComparison[];
	readonly targets: readonly WorkoutExerciseTargets[];
};

export type WorkoutPage = {
	readonly items: readonly WorkoutListItem[];
	readonly comparisons: readonly WorkoutComparison[];
	readonly targets: readonly WorkoutExerciseTargets[];
	readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: null | string };
};

export const batched = <A>(
	ids: ReadonlySet<string>,
	read: (batch: readonly string[]) => Effect.Effect<readonly A[], RyotClientError>,
) =>
	Effect.map(
		Effect.forEach(chunk([...ids], LOOKUP_BATCH_SIZE), read, { concurrency: 4 }),
		(batches) => batches.flat(),
	);

const enrichWorkoutItems = (client: RyotClient, items: readonly WorkoutListItem[]) =>
	Effect.gen(function* () {
		const reference = client.pluginIdentity(PLUGIN_PACKAGE_ID);
		const comparisonIds = new Set(
			items.flatMap(({ repeatedFromId, previousTemplateWorkoutId }) => {
				const id = repeatedFromId ?? previousTemplateWorkoutId;
				return id === null ? [] : [id];
			}),
		);
		const exerciseIds = new Set(items.flatMap(({ sets }) => sets.map((set) => set.exerciseId)));
		const [comparisons, targets] = yield* Effect.all(
			[
				batched(comparisonIds, (workoutIds) =>
					client.data.query(workoutComparisonsRecipe({ reference, workoutIds })),
				),
				batched(exerciseIds, (ids) =>
					client.data.query(workoutExerciseTargetsRecipe({ reference, exerciseIds: ids })),
				),
			],
			{ concurrency: 2 },
		);
		return { targets, comparisons };
	});

export const loadWorkoutPages = (
	client: RyotClient,
	input: {
		readonly pages: number;
		readonly search: string;
		readonly limit?: number | undefined;
		readonly workoutIds?: undefined | readonly string[];
		readonly filter?: undefined | WorkoutFilterPredicate;
	},
) =>
	Effect.gen(function* () {
		const reference = client.pluginIdentity(PLUGIN_PACKAGE_ID);
		const { items, hasMore } = yield* readCursorPages(
			(after) =>
				client.data.query(
					workoutCardsRecipe({
						after,
						reference,
						limit: input.limit,
						filter: input.filter,
						search: input.search,
						workoutIds: input.workoutIds,
					}),
				),
			{ maxPages: input.pages },
		);
		return { items, hasMore, ...(yield* enrichWorkoutItems(client, items)) } satisfies WorkoutPages;
	});

export const loadWorkoutPage = (
	client: RyotClient,
	input: {
		readonly search: string;
		readonly after: string | undefined;
		readonly filter: undefined | WorkoutFilterPredicate;
	},
) =>
	Effect.gen(function* () {
		const reference = client.pluginIdentity(PLUGIN_PACKAGE_ID);
		const page = yield* client.data.query(
			workoutCardsRecipe({
				reference,
				after: input.after,
				filter: input.filter,
				search: input.search,
			}),
		);
		return { ...page, ...(yield* enrichWorkoutItems(client, page.items)) } satisfies WorkoutPage;
	});

export const workoutsQuery = createRyotQuery<
	{
		readonly search: string;
		readonly after: string | undefined;
		readonly filter: null | ViewFilter;
	},
	WorkoutPage,
	undefined,
	Error
>(({ input, client }) =>
	Effect.gen(function* () {
		const filter = yield* compileWorkoutFilter({
			target: "list",
			filter: input.filter,
			reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
		});
		return yield* loadWorkoutPage(client, { ...input, filter });
	}),
);

export const workoutCountQuery = createRyotQuery<
	{ readonly search: string; readonly filter: null | ViewFilter },
	number,
	undefined,
	Error
>(({ input, client }) =>
	Effect.gen(function* () {
		const reference = client.pluginIdentity(PLUGIN_PACKAGE_ID);
		const filter = yield* compileWorkoutFilter({ reference, target: "list", filter: input.filter });
		return yield* client.data.query(
			workoutCountRecipe({ filter, reference, search: input.search }),
		);
	}),
);

export const workoutWeeksQuery = createRyotQuery<
	{ readonly filter: null | ViewFilter } & Omit<
		Parameters<typeof workoutWeeksRecipe>[0],
		"filter" | "reference"
	>,
	readonly WorkoutPeriodTotals[],
	undefined,
	Error
>(({ input, client }) =>
	Effect.gen(function* () {
		const reference = client.pluginIdentity(PLUGIN_PACKAGE_ID);
		const filter = yield* compileWorkoutFilter({
			reference,
			target: "weeks",
			filter: input.filter,
		});
		return yield* client.data.query(workoutWeeksRecipe({ ...input, filter, reference }));
	}),
);

export const workoutSummaryQuery = createRyotQuery<
	{ readonly timeZone: string; readonly period: PeriodKey },
	WorkoutSummary
>(({ input, client, schedule }) =>
	Effect.suspend(() =>
		client.data.query(
			workoutSummaryRecipe({
				timeZone: input.timeZone,
				...summaryWindows(input.period, DateTime.toDateUtc(DateTime.makeUnsafe(schedule.now()))),
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			}),
		),
	),
);
