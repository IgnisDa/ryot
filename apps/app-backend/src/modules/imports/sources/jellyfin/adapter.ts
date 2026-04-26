import { Effect, Either, Schema } from "effect";

import {
	addCollectionMembership,
	createCompleteEvent,
	finalizeEntityGroups,
} from "../../media/book/shared";
import { parseDateInput } from "../../media/dates";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/import-processor";
import { requestSourceJson } from "../../runtime/source-api";
import { createSourceFetchFailure, isNotNullAdapterFailure } from "../shared/adapter-utils";
import { buildMovieOrShowImportRef } from "../shared/provider-refs";

const JELLYFIN_CONCURRENCY = 5;
const JELLYFIN_AUTH_HEADER =
	'MediaBrowser Client="ryot", Device="ryot", DeviceId="ryot-import", Version="1.0.0"';

const JellyfinProviderIds = Schema.optional(
	Schema.Struct({
		Imdb: Schema.optional(Schema.String),
		Tmdb: Schema.optional(Schema.String),
		Tvdb: Schema.optional(Schema.String),
	}),
);

const JellyfinUserData = Schema.optional(
	Schema.Struct({
		IsFavorite: Schema.optional(Schema.Boolean),
		LastPlayedDate: Schema.optional(Schema.String),
	}),
);

const JellyfinItem = Schema.Struct({
	Id: Schema.String,
	Name: Schema.String,
	UserData: JellyfinUserData,
	ProviderIds: JellyfinProviderIds,
	Type: Schema.optional(Schema.String),
	SeriesId: Schema.optional(Schema.String),
	IndexNumber: Schema.optional(Schema.Int),
	SeriesName: Schema.optional(Schema.String),
	ParentIndexNumber: Schema.optional(Schema.Int),
});

type JellyfinItem = typeof JellyfinItem.Type;

const JellyfinItemsResponse = Schema.Struct({ Items: Schema.Array(JellyfinItem) });

const JellyfinAuthResponse = Schema.Struct({
	AccessToken: Schema.String,
	User: Schema.Struct({ Id: Schema.String }),
});

const JellyfinAuthRequest = Schema.Struct({
	Pw: Schema.String,
	Username: Schema.String,
});

const decodeAuth = Schema.decodeUnknown(JellyfinAuthResponse);
const decodeItems = Schema.decodeUnknown(JellyfinItemsResponse);
const decodeItem = Schema.decodeUnknown(JellyfinItem);
const encodeAuthRequest = Schema.encodeSync(Schema.parseJson(JellyfinAuthRequest));

type JellyfinAdapterInput = {
	apiUrl: string;
	username: string;
	password?: string;
	allowInsecureConnections?: boolean;
};

const createJellyfinAuthHeaders = (accessToken?: string): Record<string, string> => ({
	Accept: "application/json",
	"Content-Type": "application/json",
	Authorization: accessToken
		? `${JELLYFIN_AUTH_HEADER}, Token="${accessToken}"`
		: JELLYFIN_AUTH_HEADER,
});

export const adaptJellyfinData = (input: JellyfinAdapterInput) =>
	Effect.gen(function* () {
		const failures: MediaImportAdapterFailure[] = [];
		const groupMap = new Map<string, ReturnType<typeof getOrCreateMediaEntityGroup>>();
		const host = new URL(input.apiUrl).host;

		const authResponse = yield* requestSourceJson({
			method: "POST",
			baseUrl: input.apiUrl,
			sourceName: "Jellyfin",
			path: "Users/AuthenticateByName",
			headers: createJellyfinAuthHeaders(),
			allowInsecureConnections: input.allowInsecureConnections,
			body: encodeAuthRequest({ Pw: input.password ?? "", Username: input.username }),
		}).pipe(Effect.flatMap(decodeAuth));

		const accessToken = authResponse.AccessToken;
		const userId = authResponse.User.Id;
		const headers = createJellyfinAuthHeaders(accessToken);

		const libraryResponse = yield* requestSourceJson({
			headers,
			baseUrl: input.apiUrl,
			sourceName: "Jellyfin",
			path: `Users/${userId}/Items`,
			allowInsecureConnections: input.allowInsecureConnections,
			query: { fields: "ProviderIds", IsPlayed: true, recursive: true },
		}).pipe(Effect.flatMap(decodeItems));

		const seriesCache = new Map<string, JellyfinItem>();
		const getSeriesDetails = (seriesId: string) =>
			Effect.gen(function* () {
				const cached = seriesCache.get(seriesId);
				if (cached) {
					return cached;
				}
				const details = yield* requestSourceJson({
					headers,
					baseUrl: input.apiUrl,
					sourceName: "Jellyfin",
					path: `Items/${seriesId}`,
					allowInsecureConnections: input.allowInsecureConnections,
				}).pipe(Effect.flatMap(decodeItem));
				seriesCache.set(seriesId, details);
				return details;
			});

		const itemFailures = yield* Effect.forEach(
			libraryResponse.Items,
			(item, itemIndex) =>
				Effect.gen(function* () {
					const occurredAt = parseDateInput(item.UserData?.LastPlayedDate);
					if (!occurredAt) {
						return {
							itemIndex,
							sourceLabel: item.Name,
							sourceIdentifier: item.Id,
							stage: "input_transformation",
							message: "Jellyfin item has no played timestamp",
						} satisfies MediaImportAdapterFailure;
					}

					if (item.Type === "Movie") {
						const ref = buildMovieOrShowImportRef({
							sourceLabel: item.Name,
							entitySchemaSlug: "movie",
							providerIds: {
								imdb: item.ProviderIds?.Imdb,
								tmdb: item.ProviderIds?.Tmdb,
								tvdb: item.ProviderIds?.Tvdb,
							},
						});
						if (!ref) {
							return {
								itemIndex,
								sourceLabel: item.Name,
								sourceIdentifier: item.Id,
								stage: "input_transformation",
								message: "Jellyfin movie has no TMDB, TVDB, or IMDb identifier",
							} satisfies MediaImportAdapterFailure;
						}
						const group = getOrCreateMediaEntityGroup(groupMap, ref, itemIndex);
						group.events.push(createCompleteEvent({ occurredAt, completedOn: occurredAt }));
						if (item.UserData?.IsFavorite) {
							addCollectionMembership(group, "Favorites");
						}
						return null;
					}

					if (item.Type !== "Episode") {
						return null;
					}

					if (!item.SeriesId || item.ParentIndexNumber == null || item.IndexNumber == null) {
						return {
							itemIndex,
							sourceLabel: item.Name,
							sourceIdentifier: item.Id,
							stage: "input_transformation",
							message: "Jellyfin episode is missing series or coverage data",
						} satisfies MediaImportAdapterFailure;
					}

					const seriesDetails = yield* getSeriesDetails(item.SeriesId).pipe(Effect.either);
					if (Either.isLeft(seriesDetails)) {
						return createSourceFetchFailure({
							host,
							itemIndex,
							error: seriesDetails.left,
							sourceIdentifier: item.Id,
							sourceLabel: item.SeriesName ?? item.Name,
							message: "Failed to fetch Jellyfin series details",
						});
					}

					const ref = buildMovieOrShowImportRef({
						entitySchemaSlug: "show",
						sourceLabel: item.SeriesName ?? seriesDetails.right.Name,
						providerIds: {
							imdb: seriesDetails.right.ProviderIds?.Imdb,
							tmdb: seriesDetails.right.ProviderIds?.Tmdb,
							tvdb: seriesDetails.right.ProviderIds?.Tvdb,
						},
					});
					if (!ref) {
						return {
							itemIndex,
							sourceIdentifier: item.Id,
							stage: "input_transformation",
							sourceLabel: item.SeriesName ?? seriesDetails.right.Name,
							message: "Jellyfin show has no TMDB, TVDB, or IMDb identifier",
						} satisfies MediaImportAdapterFailure;
					}

					const group = getOrCreateMediaEntityGroup(groupMap, ref, itemIndex);
					group.events.push({
						occurredAt,
						eventSchemaSlug: "progress",
						properties: {
							progressPercent: 100,
							showEpisode: item.IndexNumber,
							showSeason: item.ParentIndexNumber,
						},
					});
					if (item.UserData?.IsFavorite) {
						addCollectionMembership(group, "Favorites");
					}
					return null;
				}),
			{ concurrency: JELLYFIN_CONCURRENCY },
		);

		failures.push(...itemFailures.filter(isNotNullAdapterFailure));

		return {
			failures,
			entityGroups: finalizeEntityGroups(groupMap),
		} satisfies MediaImportAdapterResult;
	});
