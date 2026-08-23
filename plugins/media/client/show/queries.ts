import { createRyotQuery, useEntitySettle } from "@ryot-app/client-sdk/react";
import { useMemo } from "react";

import {
	showActivityRecipe,
	showOverviewRecipe,
	showSeasonEpisodesRecipe,
	showSeasonsRecipe,
	showSummaryRecipe,
	type ShowActivityResult,
	type ShowOverviewResult,
	type ShowSeasonEpisodesResult,
	type ShowSeasonsResult,
	type ShowSummaryResult,
} from "../../shared/show-recipes";

export const SHOW_PEOPLE_LIMIT = 12;
export const SHOW_SEASON_LIMIT = 40;
export const SHOW_COMPANY_LIMIT = 6;
export const SHOW_EPISODE_LIMIT = 60;
export const SHOW_RECOMMENDATION_LIMIT = 12;
export const SHOW_ACTIVITY_SEASON_LIMIT = 100;
export const SHOW_SUMMARY_COLLECTION_LIMIT = 6;
export const SHOW_ACTIVITY_WATCH_DAY_LIMIT = 1000;
export const SHOW_ACTIVITY_PARENT_EVENT_LIMIT = 60;
export const SHOW_ACTIVITY_EPISODE_EVENT_LIMIT = 100;
export const SHOW_ACTIVITY_COLLECTION_EVENT_LIMIT = 60;
export const SHOW_ACTIVITY_EPISODE_PROGRESS_LIMIT = 100;

export const showSummaryQuery = createRyotQuery<{ readonly entityId: string }, ShowSummaryResult>(
	({ input, client, signal }) =>
		client.data.query(
			showSummaryRecipe({ ...input, collectionLimit: SHOW_SUMMARY_COLLECTION_LIMIT }),
			{ signal },
		),
	{
		entityInterest: ({ data, input }) => ({
			foreground: [input.entityId],
			visible: data?.show?.collections.items.map(({ id }) => id) ?? [],
		}),
	},
);

export const showOverviewQuery = createRyotQuery<{ readonly entityId: string }, ShowOverviewResult>(
	({ input, client, signal }) =>
		client.data.query(
			showOverviewRecipe({
				entityId: input.entityId,
				peopleLimit: SHOW_PEOPLE_LIMIT,
				companyLimit: SHOW_COMPANY_LIMIT,
				recommendationLimit: SHOW_RECOMMENDATION_LIMIT,
			}),
			{ signal },
		),
	{
		entityInterest: ({ data, input }) => ({
			foreground: [input.entityId],
			visible: data
				? [...data.people.items, ...data.companies.items, ...data.recommendations.items].map(
						({ id }) => id,
					)
				: [],
		}),
	},
);

export const showEpisodesQuery = createRyotQuery<{ readonly entityId: string }, ShowSeasonsResult>(
	({ input, client, signal }) =>
		client.data.query(
			showSeasonsRecipe({ entityId: input.entityId, seasonLimit: SHOW_SEASON_LIMIT }),
			{ signal },
		),
	{
		entityInterest: ({ data, input }) => ({
			foreground: [input.entityId],
			visible: data?.seasons.items.map(({ id }) => id) ?? [],
		}),
	},
);

export const showSeasonEpisodesQuery = createRyotQuery<
	{ readonly entityId: string; readonly seasonId: string },
	ShowSeasonEpisodesResult
>(
	({ input, client, signal }) =>
		client.data.query(
			showSeasonEpisodesRecipe({ seasonId: input.seasonId, episodeLimit: SHOW_EPISODE_LIMIT }),
			{ signal },
		),
	{
		entityInterest: ({ data, input }) => ({
			foreground: [input.entityId, input.seasonId],
			visible: data?.episodes.items.map(({ id }) => id) ?? [],
		}),
	},
);

export const showActivityQuery = createRyotQuery<{ readonly entityId: string }, ShowActivityResult>(
	({ input, client, signal }) =>
		client.data.query(
			showActivityRecipe({
				entityId: input.entityId,
				seasonLimit: SHOW_ACTIVITY_SEASON_LIMIT,
				watchDayLimit: SHOW_ACTIVITY_WATCH_DAY_LIMIT,
				parentEventLimit: SHOW_ACTIVITY_PARENT_EVENT_LIMIT,
				episodeEventLimit: SHOW_ACTIVITY_EPISODE_EVENT_LIMIT,
				timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				collectionEventLimit: SHOW_ACTIVITY_COLLECTION_EVENT_LIMIT,
				episodeProgressLimit: SHOW_ACTIVITY_EPISODE_PROGRESS_LIMIT,
			}),
			{ signal },
		),
	{
		entityInterest: ({ data, input }) => ({
			foreground: [input.entityId],
			visible: data
				? [
						...data.seasons.map(({ id }) => id),
						...data.watchDays.map(({ episodeId }) => episodeId),
						...data.events.flatMap((event) => {
							if (event.kind === "episode") {
								return [event.episode.id];
							}
							if (event.kind === "collection") {
								return [event.collection.id];
							}
							return [];
						}),
					]
				: [],
		}),
	},
);

export const useShowEntitySettle = (entityId: string) =>
	useEntitySettle(useMemo(() => ({ visible: [], foreground: [entityId] }), [entityId]));
