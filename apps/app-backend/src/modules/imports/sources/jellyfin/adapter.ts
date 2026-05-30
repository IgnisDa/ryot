import { z } from "zod";

import {
	addCollectionMembership,
	createCompleteEvent,
	finalizeEntityGroups,
} from "../../media/book/shared";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/import-processor";
import {
	mapWithConcurrency,
	requestSourceJson,
	type SourceJsonRequestInput,
} from "../../runtime/source-api";
import {
	createSourceFetchFailure,
	isNotNullAdapterFailure,
	parseDateInput,
} from "../shared/adapter-utils";
import { buildMovieOrShowImportRef } from "../shared/provider-refs";

const JELLYFIN_CONCURRENCY = 5;
const JELLYFIN_AUTH_HEADER =
	'MediaBrowser Client="ryot", Device="ryot", DeviceId="ryot-import", Version="1.0.0"';

const jellyfinProviderIdsSchema = z
	.object({
		Imdb: z.string().optional(),
		Tmdb: z.string().optional(),
		Tvdb: z.string().optional(),
	})
	.optional();

const jellyfinUserDataSchema = z
	.object({
		IsFavorite: z.boolean().optional(),
		LastPlayedDate: z.string().optional(),
	})
	.optional();

const jellyfinItemSchema = z.object({
	Id: z.string(),
	Name: z.string(),
	Type: z.string().optional(),
	SeriesId: z.string().optional(),
	UserData: jellyfinUserDataSchema,
	SeriesName: z.string().optional(),
	ProviderIds: jellyfinProviderIdsSchema,
	IndexNumber: z.number().int().optional(),
	ParentIndexNumber: z.number().int().optional(),
});

const jellyfinItemsResponseSchema = z.object({
	Items: z.array(jellyfinItemSchema),
});

const jellyfinAuthResponseSchema = z.object({
	AccessToken: z.string(),
	User: z.object({ Id: z.string() }),
});

type JellyfinAdapterInput = {
	apiUrl: string;
	username: string;
	password?: string;
	allowInsecureConnections?: boolean;
};

type JellyfinImportAdapterDeps = {
	mapWithConcurrency: typeof mapWithConcurrency;
	requestJson: <T>(input: SourceJsonRequestInput) => Promise<T>;
};

const jellyfinImportAdapterDeps: JellyfinImportAdapterDeps = {
	mapWithConcurrency,
	requestJson: requestSourceJson,
};

const createJellyfinAuthHeaders = (accessToken?: string): Record<string, string> => ({
	Accept: "application/json",
	Authorization: accessToken
		? `${JELLYFIN_AUTH_HEADER}, Token="${accessToken}"`
		: JELLYFIN_AUTH_HEADER,
	"Content-Type": "application/json",
});

export const adaptJellyfinData = async (
	input: JellyfinAdapterInput,
	deps: JellyfinImportAdapterDeps = jellyfinImportAdapterDeps,
): Promise<MediaImportAdapterResult> => {
	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ReturnType<typeof getOrCreateMediaEntityGroup>>();
	const host = new URL(input.apiUrl).host;

	const authResponse = jellyfinAuthResponseSchema.parse(
		await deps.requestJson({
			method: "POST",
			baseUrl: input.apiUrl,
			sourceName: "Jellyfin",
			path: "Users/AuthenticateByName",
			headers: createJellyfinAuthHeaders(),
			allowInsecureConnections: input.allowInsecureConnections,
			body: JSON.stringify({ Pw: input.password ?? "", Username: input.username }),
		}),
	);

	const accessToken = authResponse.AccessToken;
	const userId = authResponse.User.Id;
	const headers = createJellyfinAuthHeaders(accessToken);

	const libraryResponse = jellyfinItemsResponseSchema.parse(
		await deps.requestJson({
			headers,
			baseUrl: input.apiUrl,
			sourceName: "Jellyfin",
			path: `Users/${userId}/Items`,
			allowInsecureConnections: input.allowInsecureConnections,
			query: { fields: "ProviderIds", IsPlayed: true, recursive: true },
		}),
	);

	const seriesRefCache = new Map<string, Promise<z.infer<typeof jellyfinItemSchema>>>();
	const getSeriesDetails = async (seriesId: string) => {
		let current = seriesRefCache.get(seriesId);
		if (!current) {
			current = deps
				.requestJson({
					headers,
					baseUrl: input.apiUrl,
					sourceName: "Jellyfin",
					path: `Items/${seriesId}`,
					allowInsecureConnections: input.allowInsecureConnections,
				})
				.then((response) => jellyfinItemSchema.parse(response))
				.catch((error) => {
					seriesRefCache.delete(seriesId);
					throw error;
				});
			seriesRefCache.set(seriesId, current);
		}
		return current;
	};

	const itemFailures = await deps.mapWithConcurrency(
		libraryResponse.Items,
		JELLYFIN_CONCURRENCY,
		async (item, itemIndex) => {
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

			let seriesDetails: z.infer<typeof jellyfinItemSchema>;
			try {
				seriesDetails = await getSeriesDetails(item.SeriesId);
			} catch (error) {
				return createSourceFetchFailure({
					host,
					error,
					itemIndex,
					sourceIdentifier: item.Id,
					sourceLabel: item.SeriesName ?? item.Name,
					message: "Failed to fetch Jellyfin series details",
				});
			}

			const ref = buildMovieOrShowImportRef({
				entitySchemaSlug: "show",
				sourceLabel: item.SeriesName ?? seriesDetails.Name,
				providerIds: {
					imdb: seriesDetails.ProviderIds?.Imdb,
					tmdb: seriesDetails.ProviderIds?.Tmdb,
					tvdb: seriesDetails.ProviderIds?.Tvdb,
				},
			});
			if (!ref) {
				return {
					itemIndex,
					sourceIdentifier: item.Id,
					stage: "input_transformation",
					sourceLabel: item.SeriesName ?? seriesDetails.Name,
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
		},
	);

	failures.push(...itemFailures.filter(isNotNullAdapterFailure));

	return { failures, entityGroups: finalizeEntityGroups(groupMap) };
};
