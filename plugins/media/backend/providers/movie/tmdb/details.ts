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
	imagesData: UnknownRecord,
): ProviderDetailsResult => {
	const full = input.level !== "base";
	const creditsData = asRecord(movieData["credits"]) ?? {};
	const recommendationsData = asRecord(movieData["recommendations"]) ?? {};
	const watchProvidersData = asRecord(movieData["watch/providers"]) ?? {};
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
			...(full
				? [
						{
							entities: people,
							direction: "incoming" as const,
							synchronization: "additive" as const,
							relationshipSchemaSlug: "person-to-movie",
						},
					]
				: []),
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
			...(full
				? [
						{
							direction: "outgoing" as const,
							synchronization: "authoritative" as const,
							relationshipSchemaSlug: "media-suggestion",
							entities: collectSuggestions(recommendationsData["results"], {
								providerSlug: "movie.tmdb",
								nameKeys: ["title", "original_title"],
							}),
						},
					]
				: []),
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
	const appended =
		input.level === "base" ? "watch/providers" : "watch/providers,credits,recommendations";
	return Effect.all(
		[
			tmdbGet(
				host,
				`/movie/${input.externalId}`,
				{ language, append_to_response: appended },
				token,
			),
			tmdbGet(host, `/movie/${input.externalId}/images`, {}, token),
		],
		{ concurrency: "unbounded" },
	).pipe(
		Effect.flatMap(([movieData, imagesData]) =>
			Effect.try({
				try: () => buildDetailsResult(input, movieData, imagesData),
				catch: (error) => new MediaSandboxError({ message: mediaFailureMessage(error) }),
			}),
		),
	);
};
