import {
	readCursorPages,
	type RyotClient,
	type RyotClientError,
} from "@ryot-app/plugin-client-sdk";
import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import { chunk } from "../../shared/collections";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	workoutComparisonsRecipe,
	workoutCountRecipe,
	workoutExerciseTargetsRecipe,
	workoutCardsRecipe,
	workoutSummaryRecipe,
	workoutWeeksRecipe,
	type WorkoutComparison,
	type WorkoutExerciseTargets,
	type WorkoutListItem,
	type WorkoutPeriodTotals,
	type WorkoutSummary,
} from "../../shared/workout-list-recipes";
import { summaryWindows, type PeriodKey } from "./model";

const LOOKUP_BATCH_SIZE = 100;

export type WorkoutPages = {
	readonly hasMore: boolean;
	readonly items: readonly WorkoutListItem[];
	readonly comparisons: readonly WorkoutComparison[];
	readonly targets: readonly WorkoutExerciseTargets[];
};

export type WorkoutPage = {
	readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
	readonly items: readonly WorkoutListItem[];
	readonly comparisons: readonly WorkoutComparison[];
	readonly targets: readonly WorkoutExerciseTargets[];
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
		readonly workoutIds?: readonly string[] | undefined;
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
	input: { readonly after: string | undefined; readonly search: string },
) =>
	Effect.gen(function* () {
		const reference = client.pluginIdentity(PLUGIN_PACKAGE_ID);
		const page = yield* client.data.query(
			workoutCardsRecipe({ reference, after: input.after, search: input.search }),
		);
		return { ...page, ...(yield* enrichWorkoutItems(client, page.items)) } satisfies WorkoutPage;
	});

export const workoutsQuery = createRyotQuery<
	{ readonly after: string | undefined; readonly search: string },
	WorkoutPage
>(({ input, client }) => loadWorkoutPage(client, input));

export const workoutCountQuery = createRyotQuery<{ readonly search: string }, number>(
	({ input, client }) =>
		client.data.query(
			workoutCountRecipe({
				search: input.search,
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			}),
		),
);

export const workoutWeeksQuery = createRyotQuery<
	Omit<Parameters<typeof workoutWeeksRecipe>[0], "reference">,
	readonly WorkoutPeriodTotals[]
>(({ input, client }) =>
	client.data.query(
		workoutWeeksRecipe({ ...input, reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
	),
);

export const workoutSummaryQuery = createRyotQuery<
	{ readonly period: PeriodKey; readonly timeZone: string },
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
