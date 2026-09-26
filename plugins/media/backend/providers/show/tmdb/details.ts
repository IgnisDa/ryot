import { Effect } from "@ryot-app/sandbox-sdk/effect";
import type {
	ProviderDetailsChildEntity,
	ProviderDetailsInput,
	ProviderDetailsResult,
} from "@ryot-app/sandbox-sdk/provider";

import type { ShowEpisodeOrder } from "../../../../shared/show-episode-order";
import { parsePublishYear } from "../../../lib/parse-publish-year";
import { type UnknownRecord, numberValue, recordsValue, stringValue } from "../../../lib/records";
import {
	collectCompanies,
	collectGenres,
	collectImages,
	collectPeople,
	collectSuggestions,
	collectWatchProviders,
	getImageUrl,
	tmdbGet,
	type TmdbHost,
} from "../../../lib/vendors/tmdb";

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
	return { name, type, externalId, description: stringValue(listEntry["description"]) };
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

const HTTP_CALL_LIMIT = 50;

const loadInBatches = <A, B>(items: readonly A[], load: (item: A) => Effect.Effect<B, unknown>) =>
	Array.from({ length: Math.ceil(items.length / 5) }, (_, index) =>
		items.slice(index * 5, index * 5 + 5),
	).reduce<Effect.Effect<B[], unknown>>(
		(loaded, batch) =>
			Effect.flatMap(loaded, (results) =>
				Effect.map(Effect.all(batch.map(load)), (batchResults) => [...results, ...batchResults]),
			),
		Effect.succeed([]),
	);

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
					...(imageUrl
						? { images: [{ url: imageUrl, type: "remote" as const, purpose: "still" as const }] }
						: {}),
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
			description: stringValue(seasonData["overview"]),
			releaseDate: stringValue(seasonData["air_date"]),
			...(posterUrl
				? { images: [{ url: posterUrl, type: "remote" as const, purpose: "cover" as const }] }
				: {}),
		},
	};
};

const buildDetailsResult = (
	input: ProviderDetailsInput,
	showData: UnknownRecord,
	imagesData: UnknownRecord,
	creditsData: UnknownRecord,
	recommendationsData: UnknownRecord,
	watchProvidersData: UnknownRecord,
	seasonDataList: readonly UnknownRecord[],
	episodeOrders: readonly ShowEpisodeOrder[],
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
	const { unlinkedCreators, relatedEntities: people } = collectPeople(
		creditsData["cast"],
		creditsData["crew"],
		showData["created_by"],
	);
	return {
		name: title,
		childEntities,
		expectedChildEntitySchemaSlug: "show-season",
		properties: {
			totalEpisodes,
			episodeOrders,
			providerRating,
			unlinkedCreators,
			totalSeasons: childEntities.length,
			genres: collectGenres(showData["genres"]),
			description: stringValue(showData["overview"]),
			isNsfw: showData["adult"] === true ? true : null,
			productionStatus: stringValue(showData["status"]),
			publishYear: parsePublishYear(showData["first_air_date"]),
			watchProviders: collectWatchProviders(watchProvidersData),
			sourceUrl: `https://www.themoviedb.org/tv/${input.externalId}`,
			images: collectImages(
				showData["poster_path"],
				showData["backdrop_path"],
				imagesData["posters"],
				imagesData["backdrops"],
			),
		},
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
					providerSlug: "show.tmdb",
					nameKeys: ["name", "original_name"],
				}),
			},
		],
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
		const [
			showData,
			imagesData,
			creditsData,
			recommendationsData,
			watchProvidersData,
			episodeOrderListData,
		] = yield* Effect.all([
			tmdbGet(host, `/tv/${input.externalId}`, { language }, token),
			tmdbGet(host, `/tv/${input.externalId}/images`, {}, token),
			tmdbGet(host, `/tv/${input.externalId}/credits`, { language }, token),
			tmdbGet(host, `/tv/${input.externalId}/recommendations`, { language }, token),
			tmdbGet(host, `/tv/${input.externalId}/watch/providers`, {}, token),
			tmdbGet(host, `/tv/${input.externalId}/episode_groups`, { language }, token),
		]);
		const seasonNumbers = recordsValue(showData["seasons"]).flatMap((season) => {
			const value = numberValue(season["season_number"]);
			return value === null ? [] : [Math.trunc(value)];
		});
		const seasonDataList = yield* loadInBatches(seasonNumbers, (number) =>
			tmdbGet(host, `/tv/${input.externalId}/season/${number}`, { language }, token),
		);
		const episodeOrderHeaders = recordsValue(episodeOrderListData["results"]).flatMap((entry) => {
			const header = episodeOrderHeader(entry);
			return header ? [header] : [];
		});
		const episodeOrderBudget = Math.max(0, HTTP_CALL_LIMIT - 6 - seasonNumbers.length);
		const episodeOrders = yield* loadInBatches(
			episodeOrderHeaders.slice(0, episodeOrderBudget),
			(header) =>
				tmdbGet(
					host,
					`/tv/episode_group/${encodeURIComponent(header.externalId)}`,
					{ language },
					token,
				).pipe(Effect.map((orderData) => ({ ...header, groups: episodeOrderGroups(orderData) }))),
		);
		return yield* Effect.try({
			catch: (error) => (error instanceof Error ? error : new Error(String(error))),
			try: () =>
				buildDetailsResult(
					input,
					showData,
					imagesData,
					creditsData,
					recommendationsData,
					watchProvidersData,
					seasonDataList,
					episodeOrders,
				),
		});
	});
};
