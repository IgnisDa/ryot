import { createRyotQuery } from "@ryot-app/client-sdk/react";

import {
	movieActivityRecipe,
	movieOverviewRecipe,
	movieSummaryRecipe,
	type MovieActivityResult,
	type MovieOverviewResult,
	type MovieSummaryResult,
} from "../../shared/movie-recipes";

export const MOVIE_GROUP_LIMIT = 20;
export const MOVIE_PEOPLE_LIMIT = 12;
export const MOVIE_COMPANY_LIMIT = 6;
export const MOVIE_RECOMMENDATION_LIMIT = 12;
export const MOVIE_SUMMARY_COLLECTION_LIMIT = 6;
export const MOVIE_ACTIVITY_EVENT_LIMIT = 60;
export const MOVIE_ACTIVITY_COLLECTION_EVENT_LIMIT = 60;

export const movieSummaryQuery = createRyotQuery<{ readonly entityId: string }, MovieSummaryResult>(
	({ input, client, signal }) =>
		client.data.query(
			movieSummaryRecipe({ ...input, collectionLimit: MOVIE_SUMMARY_COLLECTION_LIMIT }),
			{ signal },
		),
	{
		entityInterest: ({ data, input }) => ({
			foreground: [input.entityId],
			visible: data?.movie?.collections.items.map(({ id }) => id) ?? [],
		}),
	},
);

export const movieOverviewQuery = createRyotQuery<
	{ readonly entityId: string },
	MovieOverviewResult
>(
	({ input, client, signal }) =>
		client.data.query(
			movieOverviewRecipe({
				entityId: input.entityId,
				groupLimit: MOVIE_GROUP_LIMIT,
				peopleLimit: MOVIE_PEOPLE_LIMIT,
				companyLimit: MOVIE_COMPANY_LIMIT,
				recommendationLimit: MOVIE_RECOMMENDATION_LIMIT,
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

export const movieActivityQuery = createRyotQuery<
	{ readonly entityId: string },
	MovieActivityResult
>(
	({ input, client, signal }) =>
		client.data.query(
			movieActivityRecipe({
				entityId: input.entityId,
				eventLimit: MOVIE_ACTIVITY_EVENT_LIMIT,
				collectionEventLimit: MOVIE_ACTIVITY_COLLECTION_EVENT_LIMIT,
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
