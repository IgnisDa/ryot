import { createRyotQuery } from "@ryot-app/client-sdk/react";

import {
	musicActivityRecipe,
	musicOverviewRecipe,
	musicSummaryRecipe,
	type MusicActivityResult,
	type MusicOverviewResult,
	type MusicSummaryResult,
} from "../../shared/music-recipes";

export const MUSIC_GROUP_LIMIT = 20;
export const MUSIC_PEOPLE_LIMIT = 12;
export const MUSIC_COMPANY_LIMIT = 6;
export const MUSIC_RECOMMENDATION_LIMIT = 12;
export const MUSIC_SUMMARY_COLLECTION_LIMIT = 6;
export const MUSIC_ACTIVITY_EVENT_LIMIT = 60;
export const MUSIC_ACTIVITY_COLLECTION_EVENT_LIMIT = 60;

export const musicSummaryQuery = createRyotQuery<{ readonly entityId: string }, MusicSummaryResult>(
	({ input, client, signal }) =>
		client.data.query(
			musicSummaryRecipe({ ...input, collectionLimit: MUSIC_SUMMARY_COLLECTION_LIMIT }),
			{ signal },
		),
	{
		entityInterest: ({ data, input }) => ({
			foreground: [input.entityId],
			visible: data?.music?.collections.items.map(({ id }) => id) ?? [],
		}),
	},
);

export const musicOverviewQuery = createRyotQuery<
	{ readonly entityId: string },
	MusicOverviewResult
>(
	({ input, client, signal }) =>
		client.data.query(
			musicOverviewRecipe({
				entityId: input.entityId,
				groupLimit: MUSIC_GROUP_LIMIT,
				peopleLimit: MUSIC_PEOPLE_LIMIT,
				companyLimit: MUSIC_COMPANY_LIMIT,
				recommendationLimit: MUSIC_RECOMMENDATION_LIMIT,
			}),
			{ signal },
		),
	{
		entityInterest: ({ data, input }) => ({
			foreground: [input.entityId],
			visible: data
				? [
						...data.people.items,
						...data.companies.items,
						...data.recommendations.items,
						...(data.group?.members.items ?? []),
					].map(({ id }) => id)
				: [],
		}),
	},
);

export const musicActivityQuery = createRyotQuery<
	{ readonly entityId: string },
	MusicActivityResult
>(
	({ input, client, signal }) =>
		client.data.query(
			musicActivityRecipe({
				entityId: input.entityId,
				eventLimit: MUSIC_ACTIVITY_EVENT_LIMIT,
				collectionEventLimit: MUSIC_ACTIVITY_COLLECTION_EVENT_LIMIT,
			}),
			{ signal },
		),
	{
		entityInterest: ({ data, input }) => ({
			foreground: [input.entityId],
			visible:
				data?.events.flatMap((event) =>
					event.kind === "collection" ? [event.collection.id] : [],
				) ?? [],
		}),
	},
);
