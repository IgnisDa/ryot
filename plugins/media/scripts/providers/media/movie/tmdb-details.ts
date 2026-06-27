import { Effect } from "@ryot/sandbox-sdk/effect";
import type { ProviderDetailsInput, ProviderDetailsResult } from "@ryot/sandbox-sdk/provider";

import { parsePublishYear } from "../../../script-helpers/parse-publish-year";
import {
	type UnknownRecord,
	asRecord,
	numberValue,
	stringValue,
} from "../../../script-helpers/records";
import {
	collectCompanies,
	collectGenres,
	collectImages,
	collectPeople,
	collectSuggestions,
	tmdbGet,
	type TmdbHost,
} from "../../tmdb-shared";

const buildDetailsResult = (
	input: ProviderDetailsInput,
	movieData: UnknownRecord,
	creditsData: UnknownRecord,
	imagesData: UnknownRecord,
	recommendationsData: UnknownRecord,
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
					scriptSlug: "movie-group.tmdb",
					relationshipProperties: { roles: ["Member"] },
					name: stringValue(collection?.["name"]) ?? "Loading...",
				},
			]
		: [];
	const { relatedEntities: people, unlinkedCreators } = collectPeople(
		creditsData["cast"],
		creditsData["crew"],
	);
	return {
		name: title,
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
					scriptSlug: "movie.tmdb",
					nameKeys: ["title", "original_title"],
				}),
			},
		],
		properties: {
			runtime,
			providerRating,
			unlinkedCreators,
			isNsfw: movieData["adult"] === true ? true : null,
			genres: collectGenres(movieData["genres"]),
			description: stringValue(movieData["overview"]),
			productionStatus: stringValue(movieData["status"]),
			publishYear: parsePublishYear(movieData["release_date"]),
			sourceUrl: `https://www.themoviedb.org/movie/${input.externalId}`,
			images: collectImages(
				movieData["poster_path"],
				movieData["backdrop_path"],
				imagesData["posters"],
				imagesData["backdrops"],
			),
		},
	};
};

export const getTmdbMovieDetails = (
	input: ProviderDetailsInput,
	host: TmdbHost,
	language: string,
	token: string,
) => {
	if (!/^\d+$/.test(input.externalId)) {
		return Effect.fail(new Error("externalId must be a numeric TMDB movie ID"));
	}
	return Effect.all(
		[
			tmdbGet(host, `/movie/${input.externalId}`, { language }, token),
			tmdbGet(host, `/movie/${input.externalId}/credits`, { language }, token),
			tmdbGet(host, `/movie/${input.externalId}/images`, {}, token),
			tmdbGet(host, `/movie/${input.externalId}/recommendations`, { language }, token),
		],
		{ concurrency: "unbounded" },
	).pipe(
		Effect.flatMap(([movieData, creditsData, imagesData, recommendationsData]) =>
			Effect.try({
				try: () =>
					buildDetailsResult(input, movieData, creditsData, imagesData, recommendationsData),
				catch: (error) => (error instanceof Error ? error : new Error(String(error))),
			}),
		),
	);
};
