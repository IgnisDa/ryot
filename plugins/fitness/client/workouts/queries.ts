import {
	readCursorPages,
	type RyotClient,
	type RyotClientError,
} from "@ryot-app/plugin-client-sdk";
import type {
	BrowserCountSource,
	BrowserQueryInput,
	BrowserSelectionSource,
} from "@ryot-app/plugin-client-sdk/browser";
import { Array, Effect } from "@ryot-app/plugin-client-sdk/effect";
import type { ViewFilter } from "@ryot-app/plugin-client-sdk/filters";
import type { TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { reportingArguments } from "@ryot-app/plugin-client-sdk/ryotql";
import { ENTITY_IDS_PAGE_SIZE } from "@ryot-app/ryotql-recipes/browse";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	workoutCardsRecipe,
	type WorkoutComparison,
	workoutComparisonsRecipe,
	workoutCountRecipe,
	workoutIdsRecipe,
	type WorkoutListItem,
	type WorkoutPeriodTotals,
	type WorkoutSummary,
	workoutSummaryRecipe,
	workoutWeeksRecipe,
} from "../../shared/workout-list-recipes";
import { type WorkoutTaxonomy, workoutTaxonomyRecipe } from "../../shared/workout-taxonomy-recipes";
import { type PeriodKey, periodOptions } from "./model";

const LOOKUP_BATCH_SIZE = 100;

export type WorkoutPages = {
	readonly hasMore: boolean;
	readonly items: readonly WorkoutListItem[];
	readonly targets: readonly WorkoutTaxonomy[];
	readonly comparisons: readonly WorkoutComparison[];
};

export type WorkoutPage = {
	readonly items: readonly WorkoutListItem[];
	readonly targets: readonly WorkoutTaxonomy[];
	readonly comparisons: readonly WorkoutComparison[];
	readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: null | string };
};

export const batched = <A>(
	ids: ReadonlySet<string>,
	read: (batch: readonly string[]) => Effect.Effect<readonly A[], RyotClientError>,
) =>
	Effect.map(
		Effect.forEach(Array.chunksOf([...ids], LOOKUP_BATCH_SIZE), read, { concurrency: 4 }),
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
		const [comparisons, targets] = yield* Effect.all(
			[
				batched(comparisonIds, (workoutIds) =>
					client.data.query(workoutComparisonsRecipe({ reference }), { workoutIds }),
				),
				items.length === 0
					? Effect.succeed([])
					: Effect.map(
							readCursorPages((after) =>
								client.data.query(
									workoutTaxonomyRecipe({ reference: reference }),
									{ workoutIds: items.map(({ entityId }) => entityId) },
									{ pages: { taxonomy: { after: after } } },
								),
							),
							({ items: taxonomy }) => taxonomy,
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
		readonly filter?: null | ViewFilter;
		readonly workoutIds?: undefined | readonly string[];
	},
) =>
	Effect.gen(function* () {
		const reference = client.pluginIdentity(PLUGIN_PACKAGE_ID);
		const { items, hasMore } = yield* readCursorPages(
			(after) =>
				client.data.query(
					workoutCardsRecipe({ reference }),
					{ search: input.search, workoutIds: input.workoutIds },
					{ filter: input.filter ?? undefined, pages: { workouts: { after, limit: input.limit } } },
				),
			{ maxPages: input.pages },
		);
		return { items, hasMore, ...(yield* enrichWorkoutItems(client, items)) } satisfies WorkoutPages;
	});
export const workoutsQuery = createRyotQuery<BrowserQueryInput, WorkoutPage, Error>(
	({ input, client }) =>
		Effect.gen(function* () {
			const page = yield* client.data.query(
				workoutCardsRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
				{ search: input.searchText },
				{
					filter: input.filter ?? undefined,
					pages: { workouts: { after: input.cursor ?? undefined } },
				},
			);
			return { ...page, ...(yield* enrichWorkoutItems(client, page.items)) } satisfies WorkoutPage;
		}),
);

export const countWorkouts: BrowserCountSource = (client, input) =>
	client.data.query(
		workoutCountRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
		{ search: input.searchText },
		{ filter: input.filter ?? undefined },
	);
export const readWorkoutIds: BrowserSelectionSource["readIds"] = (client, input) =>
	client.data.query(
		workoutIdsRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
		{ search: input.searchText },
		{
			filter: input.filter ?? undefined,
			pages: { workoutIds: { after: input.after, limit: ENTITY_IDS_PAGE_SIZE } },
		},
	);
export const workoutWeeksQuery = createRyotQuery<
	{
		readonly endAt: string;
		readonly search: string;
		readonly startAt: string;
		readonly timeZone: TimeZone;
		readonly filter: null | ViewFilter;
	},
	readonly WorkoutPeriodTotals[],
	Error
>(({ input, client }) =>
	client.data.query(
		workoutWeeksRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
		{ endAt: input.endAt, search: input.search, startAt: input.startAt },
		{ filter: input.filter ?? undefined },
	),
);

export const workoutSummaryQuery = createRyotQuery<
	{ readonly period: PeriodKey; readonly timeZone: TimeZone },
	WorkoutSummary
>(({ input, client }) =>
	client.data.query(
		workoutSummaryRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
		reportingArguments({
			grouping: "day",
			comparison: "previous-period",
			range: {
				kind: "rolling",
				days: (periodOptions.find((option) => option.key === input.period) ?? periodOptions[1])
					.days,
			},
		}),
	),
);
