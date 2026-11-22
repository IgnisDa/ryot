import { Array, Effect } from "@ryot-app/plugin-backend-sdk/effect";
import type {
	ProviderDetailsChildEntity,
	ProviderDetailsInput,
	ProviderDetailsResult,
} from "@ryot-app/plugin-backend-sdk/provider";
import { asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import type { ShowEpisodeOrder } from "../../../../shared/show-episode-order";
import { mediaFailureMessage } from "../../../lib/error-message";
import { MediaSandboxError } from "../../../lib/failures";
import { mediaGenreGroups } from "../../../lib/media-genres";
import { originalLanguageProperties } from "../../../lib/original-language";
import { parsePublishYear } from "../../../lib/parse-publish-year";
import { normalizePlainDescription } from "../../../lib/plain-description";
import { numberValue, recordsValue, stringValue, type UnknownRecord } from "../../../lib/records";
import {
	collectCompanies,
	collectGenres,
	collectImages,
	collectPeople,
	collectSuggestions,
	collectWatchProviders,
	tmdbArtworkInventory,
	tmdbGet,
	type TmdbHost,
} from "../../../lib/vendors/tmdb";
import { tmdbArtwork } from "../../../lib/vendors/tmdb-artwork";
import { enrichShowAirtimes } from "../../../lib/vendors/tvmaze";

/** TMDB episode group types 1 through 7, in TMDB's numbering. */
const tmdbEpisodeOrderTypes: readonly ShowEpisodeOrder["type"][] = [
	"original-air-date",
	"absolute",
	"dvd",
	"digital",
	"story-arc",
	"production",
	"tv",
];

const byOrder = <A>(items: readonly A[], order: (item: A) => unknown) =>
	items
		.map((item, index) => ({ item, position: numberValue(order(item)) ?? index }))
		.sort((left, right) => left.position - right.position);

/** An order's identity from TMDB's episode group list; its groups come from the group itself. */
const episodeOrderHeader = (listEntry: UnknownRecord) => {
	const externalId = stringValue(listEntry["id"]);
	const name = stringValue(listEntry["name"]);
	const typeValue = numberValue(listEntry["type"]);
	const type = typeValue === null ? undefined : tmdbEpisodeOrderTypes[typeValue - 1];
	if (!externalId || !name || type === undefined) {
		return null;
	}
	return {
		name,
		type,
		externalId,
		description: normalizePlainDescription(listEntry["description"]),
	};
};

const episodeOrderGroups = (orderData: UnknownRecord): ShowEpisodeOrder["groups"] =>
	byOrder(recordsValue(orderData["groups"]), (group) => group["order"]).map(
		({ position, item: group }) => ({
			order: Math.trunc(position),
			name: stringValue(group["name"]) ?? `Group ${Math.trunc(position)}`,
			episodeExternalIds: byOrder(
				recordsValue(group["episodes"]),
				(episode) => episode["order"],
			).flatMap(({ item: episode }) => {
				const episodeId = numberValue(episode["id"]);
				return episodeId === null || episodeId <= 0 ? [] : [String(Math.trunc(episodeId))];
			}),
		}),
	);

const SEASON_APPEND_LIMIT = 20;

const buildSeason = (
	parentShowExternalId: string,
	seasonData: UnknownRecord,
): null | ProviderDetailsChildEntity => {
	const idValue = numberValue(seasonData["id"]);
	if (idValue === null || idValue <= 0) {
		return null;
	}
	const seasonNumberValue = numberValue(seasonData["season_number"]);
	const seasonNumber = seasonNumberValue === null ? 0 : Math.trunc(seasonNumberValue);
	const poster = tmdbArtwork(seasonData["poster_path"], "cover");
	const childEntities = recordsValue(seasonData["episodes"]).flatMap((episode) => {
		const episodeId = numberValue(episode["id"]);
		if (episodeId === null || episodeId <= 0) {
			return [];
		}
		const episodeNumberValue = numberValue(episode["episode_number"]);
		const episodeNumber = episodeNumberValue === null ? 0 : Math.trunc(episodeNumberValue);
		const runtimeValue = numberValue(episode["runtime"]);
		const runtime = runtimeValue !== null && runtimeValue > 0 ? Math.trunc(runtimeValue) : null;
		const image = tmdbArtwork(episode["still_path"], "still");
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
					publishDate: stringValue(episode["air_date"]),
					description: normalizePlainDescription(episode["overview"]),
					...(image === undefined ? {} : { images: [image] }),
				},
			},
		];
	});
	return {
		childEntities,
		entitySchemaSlug: "show-season",
		externalId: String(Math.trunc(idValue)),
		expectedChildEntitySchemaSlug: "show-episode",
		name: stringValue(seasonData["name"]) ?? `Season ${seasonNumber}`,
		properties: {
			seasonNumber,
			parentShowExternalId,
			releaseDate: stringValue(seasonData["air_date"]),
			description: normalizePlainDescription(seasonData["overview"]),
			...(poster === undefined ? {} : { images: [poster] }),
		},
	};
};

const buildDetailsResult = (
	input: ProviderDetailsInput,
	showData: UnknownRecord,
	imagesData: UnknownRecord,
	seasonDataList: readonly UnknownRecord[],
	episodeOrders: readonly ShowEpisodeOrder[],
): ProviderDetailsResult => {
	const full = input.level !== "base";
	const creditsData = asRecord(showData["credits"]) ?? {};
	const aggregateCreditsData = asRecord(showData["aggregate_credits"]) ?? {};
	const recommendationsData = asRecord(showData["recommendations"]) ?? {};
	const watchProvidersData = asRecord(showData["watch/providers"]) ?? {};
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
	const currentRegularCast = new Set(
		recordsValue(creditsData["cast"]).flatMap((person) => {
			const id = numberValue(person["id"]);
			return id === null ? [] : [String(Math.trunc(id))];
		}),
	);
	const episodes = seasonDataList.flatMap((season) => recordsValue(season["episodes"]));
	const guestStarAppearances = new Map<string, number>();
	for (const episode of episodes) {
		const episodeGuestStars = new Set(
			recordsValue(episode["guest_stars"]).flatMap((person) => {
				const id = numberValue(person["id"]);
				return id === null ? [] : [String(Math.trunc(id))];
			}),
		);
		for (const id of episodeGuestStars) {
			guestStarAppearances.set(id, (guestStarAppearances.get(id) ?? 0) + 1);
		}
	}
	const guestStarInventoryComplete =
		episodes.length > 0 && episodes.every((episode) => Array.isArray(episode["guest_stars"]));
	const hasCompleteAggregateCredits =
		Array.isArray(aggregateCreditsData["cast"]) && Array.isArray(aggregateCreditsData["crew"]);
	const people = hasCompleteAggregateCredits
		? collectPeople(
				aggregateCreditsData["cast"],
				aggregateCreditsData["crew"],
				showData["created_by"],
				{ currentRegularCast, guestStarAppearances, guestStarInventoryComplete },
			)
		: [];
	const hasCompleteCompanies =
		Array.isArray(showData["networks"]) && Array.isArray(showData["production_companies"]);
	const companies = hasCompleteCompanies
		? collectCompanies([
				[showData["networks"], "network"],
				[showData["production_companies"], "production_company"],
			])
		: [];
	const genres = collectGenres(showData["genres"]);
	return {
		name: title,
		childEntities,
		expectedChildEntitySchemaSlug: "show-season",
		properties: {
			totalEpisodes,
			episodeOrders,
			providerRating,
			totalSeasons: childEntities.length,
			isNsfw: showData["adult"] === true ? true : null,
			productionStatus: stringValue(showData["status"]),
			...originalLanguageProperties(showData["original_language"], "tmdb"),
			publishYear: parsePublishYear(showData["first_air_date"]),
			watchProviders: collectWatchProviders(watchProvidersData),
			description: normalizePlainDescription(showData["overview"]),
			sourceUrl: `https://www.themoviedb.org/tv/${input.externalId}`,
			images: collectImages(
				showData["poster_path"],
				showData["backdrop_path"],
				imagesData["posters"],
				imagesData["backdrops"],
			),
		},
		relatedEntityGroups: [
			...(full
				? [
						{
							direction: "incoming" as const,
							relationshipSchemaSlug: "person-to-show",
							synchronization: "authoritative" as const,
							entities: hasCompleteAggregateCredits ? people : [],
							coverage: hasCompleteAggregateCredits
								? { status: "complete" as const }
								: {
										status: "source-limited" as const,
										reason: "TMDB show aggregate credits did not include cast and crew arrays",
									},
						},
					]
				: []),
			...(full || hasCompleteCompanies
				? [
						{
							entities: companies,
							direction: "incoming" as const,
							synchronization: "authoritative" as const,
							relationshipSchemaSlug: "company-to-show",
							coverage: hasCompleteCompanies
								? { status: "complete" as const }
								: {
										status: "source-limited" as const,
										reason: "TMDB show companies inventory was missing or malformed",
									},
						},
					]
				: []),
			...(full
				? [
						{
							direction: "outgoing" as const,
							synchronization: "authoritative" as const,
							coverage: { status: "complete" as const },
							relationshipSchemaSlug: "media-suggestion",
							entities: collectSuggestions(recommendationsData["results"], {
								providerSlug: "show.tmdb",
								nameKeys: ["name", "original_name"],
							}),
						},
					]
				: []),
			...mediaGenreGroups("show", genres),
		],
	};
};

export const getTmdbShowDetails = (
	input: ProviderDetailsInput,
	host: TmdbHost & Parameters<typeof enrichShowAirtimes>[0],
	language: string,
	token: string,
) => {
	if (!/^\d+$/.test(input.externalId)) {
		return Effect.fail(
			new MediaSandboxError({ message: "externalId must be a numeric TMDB show ID" }),
		);
	}
	return Effect.gen(function* () {
		const appended =
			input.level === "base"
				? "watch/providers,episode_groups,external_ids"
				: "watch/providers,episode_groups,external_ids,credits,aggregate_credits,recommendations";
		const [showData, imagesData] = yield* Effect.all([
			tmdbGet(host, `/tv/${input.externalId}`, { language, append_to_response: appended }, token),
			input.level === "base"
				? Effect.succeed<UnknownRecord>({})
				: tmdbArtworkInventory(host, `/tv/${input.externalId}`, language, token),
		]);
		const episodeOrderListData = asRecord(showData["episode_groups"]) ?? {};
		const listedSeasons = recordsValue(showData["seasons"]).flatMap((season) => {
			const value = numberValue(season["season_number"]);
			return value === null ? [] : [{ id: season["id"], number: Math.trunc(value) }];
		});
		const seasonChunks = Array.chunksOf(listedSeasons, SEASON_APPEND_LIMIT);
		const seasonDataList = (yield* Effect.forEach(seasonChunks, (seasons) =>
			tmdbGet(
				host,
				`/tv/${input.externalId}`,
				{ language, append_to_response: seasons.map(({ number }) => `season/${number}`).join(",") },
				token,
			).pipe(
				Effect.flatMap((chunkData) =>
					Effect.forEach(seasons, ({ id, number }) => {
						const seasonData = asRecord(chunkData[`season/${number}`]);
						if (!seasonData) {
							return Effect.fail(
								new MediaSandboxError({ message: `TMDB returned no object for season ${number}` }),
							);
						}
						if (!Array.isArray(seasonData["episodes"])) {
							return Effect.fail(
								new MediaSandboxError({
									message: `TMDB returned no episodes array for season ${number}`,
								}),
							);
						}
						// The root season list supplies the ID omitted from appended season responses.
						return Effect.succeed({ ...seasonData, id });
					}),
				),
			),
		)).flat();
		const episodeOrderHeaders = recordsValue(episodeOrderListData["results"]).flatMap((entry) => {
			const header = episodeOrderHeader(entry);
			return header ? [header] : [];
		});
		const episodeOrders = yield* Effect.forEach(episodeOrderHeaders, (header) =>
			tmdbGet(
				host,
				`/tv/episode_group/${encodeURIComponent(header.externalId)}`,
				{ language },
				token,
			).pipe(Effect.map((orderData) => ({ ...header, groups: episodeOrderGroups(orderData) }))),
		);
		const details = yield* Effect.try({
			catch: (error) => new MediaSandboxError({ message: mediaFailureMessage(error) }),
			try: () => buildDetailsResult(input, showData, imagesData, seasonDataList, episodeOrders),
		});
		const externalIds = asRecord(showData["external_ids"]);
		const imdbId = stringValue(externalIds?.["imdb_id"]);
		const tvdbId = numberValue(externalIds?.["tvdb_id"]);
		const childEntities = yield* enrichShowAirtimes(
			host,
			[
				...(imdbId === null ? [] : [{ id: imdbId, kind: "imdb" as const }]),
				...(tvdbId === null ? [] : [{ id: String(tvdbId), kind: "thetvdb" as const }]),
			],
			details.childEntities ?? [],
		);
		return { ...details, childEntities };
	});
};
