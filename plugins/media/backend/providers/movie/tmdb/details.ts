import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import type {
	ProviderDetailsInput,
	ProviderDetailsResult,
} from "@ryot-app/plugin-backend-sdk/provider";
import { asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { mediaFailureMessage } from "../../../lib/error-message";
import { MediaSandboxError } from "../../../lib/failures";
import { mediaGenreGroups } from "../../../lib/media-genres";
import { parsePublishYear } from "../../../lib/parse-publish-year";
import { normalizePlainDescription } from "../../../lib/plain-description";
import { numberValue, stringValue, type UnknownRecord } from "../../../lib/records";
import {
	collectCompanies,
	collectGenres,
	collectImages,
	collectPeople,
	collectSuggestions,
	collectWatchProviders,
	tmdbGet,
	type TmdbHost,
} from "../../../lib/vendors/tmdb";

const buildDetailsResult = (
	input: ProviderDetailsInput,
	movieData: UnknownRecord,
	creditsData: UnknownRecord,
	imagesData: UnknownRecord,
	recommendationsData: UnknownRecord,
	watchProvidersData: UnknownRecord,
): ProviderDetailsResult => {
	const title = stringValue(movieData["title"]);
	if (!title) {
		throw new Error("TMDB returned no title for this movie");
	}
	const runtimeValue = numberValue(movieData["runtime"]);
	const runtime = runtimeValue !== null && runtimeValue > 0 ? Math.trunc(runtimeValue) : null;
	const voteAverage = numberValue(movieData["vote_average"]);
	const providerRating = voteAverage !== null && voteAverage > 0 ? voteAverage * 10 : null;
	const collection = asRecord(movieData["belongs_to_collection"]);
	const collectionIdValue = numberValue(collection?.["id"]);
	const collectionId = collectionIdValue === null ? null : String(Math.trunc(collectionIdValue));
	const groups = collectionId
		? [
				{
					externalId: collectionId,
					providerSlug: "movie-group.tmdb",
					relationshipProperties: { roles: ["Member"] },
					name: stringValue(collection?.["name"]) ?? "Loading...",
				},
			]
		: [];
	const people = collectPeople(creditsData["cast"], creditsData["crew"]);
	const genres = collectGenres(movieData["genres"]);
	return {
		name: title,
		properties: {
			runtime,
			providerRating,
			isNsfw: movieData["adult"] === true ? true : null,
			productionStatus: stringValue(movieData["status"]),
			publishYear: parsePublishYear(movieData["release_date"]),
			watchProviders: collectWatchProviders(watchProvidersData),
			description: normalizePlainDescription(movieData["overview"]),
			sourceUrl: `https://www.themoviedb.org/movie/${input.externalId}`,
			images: collectImages(
				movieData["poster_path"],
				movieData["backdrop_path"],
				imagesData["posters"],
				imagesData["backdrops"],
			),
		},
		relatedEntityGroups: [
			{
				entities: people,
				direction: "incoming",
				synchronization: "additive",
				relationshipSchemaSlug: "person-to-movie",
			},
			{
				direction: "incoming",
				synchronization: "additive",
				relationshipSchemaSlug: "company-to-movie",
				entities: collectCompanies([[movieData["production_companies"], "Production Company"]]),
			},
			{
				entities: groups,
				direction: "incoming",
				synchronization: "additive",
				relationshipSchemaSlug: "movie-group-to-movie",
			},
			{
				direction: "outgoing",
				synchronization: "authoritative",
				relationshipSchemaSlug: "media-suggestion",
				entities: collectSuggestions(recommendationsData["results"], {
					providerSlug: "movie.tmdb",
					nameKeys: ["title", "original_title"],
				}),
			},
			...mediaGenreGroups("movie", genres),
		],
	};
};

export const getTmdbMovieDetails = (
	input: ProviderDetailsInput,
	host: TmdbHost,
	language: string,
	token: string,
) => {
	if (!/^\d+$/.test(input.externalId)) {
		return Effect.fail(
			new MediaSandboxError({ message: "externalId must be a numeric TMDB movie ID" }),
		);
	}
	return Effect.all(
		[
			tmdbGet(host, `/movie/${input.externalId}`, { language }, token),
			tmdbGet(host, `/movie/${input.externalId}/credits`, { language }, token),
			tmdbGet(host, `/movie/${input.externalId}/images`, {}, token),
			tmdbGet(host, `/movie/${input.externalId}/recommendations`, { language }, token),
			tmdbGet(host, `/movie/${input.externalId}/watch/providers`, {}, token),
		],
		{ concurrency: "unbounded" },
	).pipe(
		Effect.flatMap(
			([movieData, creditsData, imagesData, recommendationsData, watchProvidersData]) =>
				Effect.try({
					catch: (error) => new MediaSandboxError({ message: mediaFailureMessage(error) }),
					try: () =>
						buildDetailsResult(
							input,
							movieData,
							creditsData,
							imagesData,
							recommendationsData,
							watchProvidersData,
						),
				}),
		),
	);
};
