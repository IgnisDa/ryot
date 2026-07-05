import { Effect } from "@ryot/sandbox-sdk/effect";
import type {
	ProviderDetailsChildEntity,
	ProviderDetailsInput,
	ProviderDetailsResult,
} from "@ryot/sandbox-sdk/provider";

import { parsePublishYear } from "../../../script-helpers/parse-publish-year";
import {
	type UnknownRecord,
	numberValue,
	recordsValue,
	stringValue,
} from "../../../script-helpers/records";
import {
	collectCompanies,
	collectGenres,
	collectImages,
	collectPeople,
	collectSuggestions,
	getImageUrl,
	tmdbGet,
	type TmdbHost,
} from "../../tmdb-shared";

const buildSeason = (
	parentShowExternalId: string,
	seasonData: UnknownRecord,
): ProviderDetailsChildEntity | null => {
	const idValue = numberValue(seasonData["id"]);
	if (idValue === null || idValue <= 0) {
		return null;
	}
	const seasonNumberValue = numberValue(seasonData["season_number"]);
	const seasonNumber = seasonNumberValue === null ? 0 : Math.trunc(seasonNumberValue);
	const posterUrl = getImageUrl(seasonData["poster_path"]);
	const childEntities = recordsValue(seasonData["episodes"]).flatMap((episode) => {
		const episodeId = numberValue(episode["id"]);
		if (episodeId === null || episodeId <= 0) {
			return [];
		}
		const episodeNumberValue = numberValue(episode["episode_number"]);
		const episodeNumber = episodeNumberValue === null ? 0 : Math.trunc(episodeNumberValue);
		const runtimeValue = numberValue(episode["runtime"]);
		const runtime = runtimeValue !== null && runtimeValue > 0 ? Math.trunc(runtimeValue) : null;
		const imageUrl = getImageUrl(episode["still_path"]);
		return [
			{
				entitySchemaSlug: "show-episode",
				externalId: String(Math.trunc(episodeId)),
				name: stringValue(episode["name"]) ?? `Episode ${episodeNumber}`,
				properties: {
					runtime,
					seasonNumber,
					episodeNumber,
					parentShowExternalId,
					description: stringValue(episode["overview"]),
					publishDate: stringValue(episode["air_date"]),
					...(imageUrl ? { images: [{ type: "remote" as const, url: imageUrl }] } : {}),
				},
			},
		];
	});
	return {
		childEntities,
		entitySchemaSlug: "show-season",
		externalId: String(Math.trunc(idValue)),
		name: stringValue(seasonData["name"]) ?? `Season ${seasonNumber}`,
		properties: {
			seasonNumber,
			parentShowExternalId,
			description: stringValue(seasonData["overview"]),
			releaseDate: stringValue(seasonData["air_date"]),
			...(posterUrl ? { images: [{ type: "remote" as const, url: posterUrl }] } : {}),
		},
	};
};

const buildDetailsResult = (
	input: ProviderDetailsInput,
	showData: UnknownRecord,
	imagesData: UnknownRecord,
	creditsData: UnknownRecord,
	recommendationsData: UnknownRecord,
	seasonDataList: readonly UnknownRecord[],
): ProviderDetailsResult => {
	const title = stringValue(showData["name"]);
	if (!title) {
		throw new Error("TMDB returned no name for this show");
	}
	const childEntities = seasonDataList.flatMap((season) => {
		const child = buildSeason(input.externalId, season);
		return child ? [child] : [];
	});
	const totalEpisodes = childEntities.reduce(
		(count, season) => count + (season.childEntities?.length ?? 0),
		0,
	);
	const voteAverage = numberValue(showData["vote_average"]);
	const providerRating = voteAverage !== null && voteAverage > 0 ? voteAverage * 10 : null;
	const { relatedEntities: people, unlinkedCreators } = collectPeople(
		creditsData["cast"],
		creditsData["crew"],
		showData["created_by"],
	);
	return {
		name: title,
		childEntities,
		relatedEntityGroups: [
			{
				entities: people,
				direction: "incoming",
				synchronization: "additive",
				relationshipSchemaSlug: "person-to-show",
			},
			{
				direction: "incoming",
				synchronization: "additive",
				relationshipSchemaSlug: "company-to-show",
				entities: collectCompanies([
					[showData["networks"], "Network"],
					[showData["production_companies"], "Production Company"],
				]),
			},
			{
				direction: "outgoing",
				synchronization: "authoritative",
				relationshipSchemaSlug: "media-suggestion",
				entities: collectSuggestions(recommendationsData["results"], {
					scriptSlug: "show.tmdb",
					nameKeys: ["name", "original_name"],
				}),
			},
		],
		properties: {
			providerRating,
			totalEpisodes,
			unlinkedCreators,
			totalSeasons: childEntities.length,
			isNsfw: showData["adult"] === true ? true : null,
			genres: collectGenres(showData["genres"]),
			description: stringValue(showData["overview"]),
			productionStatus: stringValue(showData["status"]),
			sourceUrl: `https://www.themoviedb.org/tv/${input.externalId}`,
			publishYear: parsePublishYear(showData["first_air_date"]),
			images: collectImages(
				showData["poster_path"],
				showData["backdrop_path"],
				imagesData["posters"],
				imagesData["backdrops"],
			),
		},
	};
};

export const getTmdbShowDetails = (
	input: ProviderDetailsInput,
	host: TmdbHost,
	language: string,
	token: string,
) => {
	if (!/^\d+$/.test(input.externalId)) {
		return Effect.fail(new Error("externalId must be a numeric TMDB show ID"));
	}
	return Effect.gen(function* () {
		const [showData, imagesData, creditsData, recommendationsData] = yield* Effect.all([
			tmdbGet(host, `/tv/${input.externalId}`, { language }, token),
			tmdbGet(host, `/tv/${input.externalId}/images`, {}, token),
			tmdbGet(host, `/tv/${input.externalId}/credits`, { language }, token),
			tmdbGet(host, `/tv/${input.externalId}/recommendations`, { language }, token),
		]);
		const seasonNumbers = recordsValue(showData["seasons"]).flatMap((season) => {
			const value = numberValue(season["season_number"]);
			return value === null ? [] : [Math.trunc(value)];
		});
		const batches = Array.from({ length: Math.ceil(seasonNumbers.length / 5) }, (_, index) =>
			seasonNumbers.slice(index * 5, index * 5 + 5),
		);
		const seasonDataList = yield* batches.reduce<Effect.Effect<UnknownRecord[], unknown>>(
			(seasons, batch) =>
				Effect.flatMap(seasons, (loaded) =>
					Effect.map(
						Effect.all(
							batch.map((number) =>
								tmdbGet(host, `/tv/${input.externalId}/season/${number}`, { language }, token),
							),
						),
						(results) => [...loaded, ...results],
					),
				),
			Effect.succeed([]),
		);
		return yield* Effect.try({
			try: () =>
				buildDetailsResult(
					input,
					showData,
					imagesData,
					creditsData,
					recommendationsData,
					seasonDataList,
				),
			catch: (error) => (error instanceof Error ? error : new Error(String(error))),
		});
	});
};
