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
import { Array, DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import type { ViewFilter } from "@ryot-app/plugin-client-sdk/filters";
import type { TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { ENTITY_IDS_PAGE_SIZE } from "@ryot-app/ryotql-recipes/browse";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	workoutCardsRecipe,
	type WorkoutComparison,
	workoutComparisonsRecipe,
	workoutCountRecipe,
	type WorkoutFilterPredicate,
	workoutIdsRecipe,
	type WorkoutListItem,
	type WorkoutPeriodTotals,
	type WorkoutSummary,
	workoutSummaryRecipe,
	workoutWeeksRecipe,
} from "../../shared/workout-list-recipes";
import { type WorkoutTaxonomy, workoutTaxonomyRecipe } from "../../shared/workout-taxonomy-recipes";
import { compileWorkoutFilter } from "./filters";
import { type PeriodKey, summaryWindows } from "./model";

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
					client.data.query(workoutComparisonsRecipe({ reference, workoutIds })),
				),
				items.length === 0
					? Effect.succeed([])
					: Effect.map(
							readCursorPages((after) =>
								client.data.query(
									workoutTaxonomyRecipe({
										after,
										reference,
										workoutIds: items.map(({ entityId }) => entityId),
									}),
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

const listFilter = (client: RyotClient, filter: null | ViewFilter) =>
	compileWorkoutFilter({
		filter,
		target: "list",
		reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
	});

export const workoutsQuery = createRyotQuery<BrowserQueryInput, WorkoutPage, Error>(
	({ input, client }) =>
		Effect.gen(function* () {
			const page = yield* client.data.query(
				workoutCardsRecipe({
					search: input.searchText,
					after: input.cursor ?? undefined,
					filter: yield* listFilter(client, input.filter),
					reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
				}),
			);
			return { ...page, ...(yield* enrichWorkoutItems(client, page.items)) } satisfies WorkoutPage;
		}),
);

export const countWorkouts: BrowserCountSource = (client, input) =>
	Effect.gen(function* () {
		return yield* client.data.query(
			workoutCountRecipe({
				search: input.searchText,
				filter: yield* listFilter(client, input.filter),
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			}),
		);
	});

export const readWorkoutIds: BrowserSelectionSource["readIds"] = (client, input) =>
	Effect.gen(function* () {
		return yield* client.data.query(
			workoutIdsRecipe({
				after: input.after,
				search: input.searchText,
				limit: ENTITY_IDS_PAGE_SIZE,
				filter: yield* listFilter(client, input.filter),
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			}),
		);
	});

export const workoutWeeksQuery = createRyotQuery<
	{ readonly filter: null | ViewFilter } & Omit<
		Parameters<typeof workoutWeeksRecipe>[0],
		"filter" | "reference"
	>,
	readonly WorkoutPeriodTotals[],
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
	{ readonly period: PeriodKey; readonly timeZone: TimeZone },
	WorkoutSummary
>(({ input, client, schedule }) =>
	Effect.suspend(() =>
		client.data.query(
			workoutSummaryRecipe({
				timeZone: input.timeZone,
				...summaryWindows(
					input.period,
					DateTime.toDateUtc(DateTime.makeUnsafe(schedule.now())),
					input.timeZone,
				),
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			}),
		),
	),
);
