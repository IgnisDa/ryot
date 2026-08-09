import { Effect, Result, Schema } from "@ryot/sandbox-sdk/effect";

import { parseDateInput } from "./dates";
import { getOrCreateMediaEntityGroup, type ImportMediaEntityGroupBuilder } from "./groups";
import { addCollectionMembership, createCompleteEvent, finalizeEntityGroups } from "./helpers";
import type { MediaImportAdapterFailure } from "./schemas";
import {
	requestSourceJson,
	sourceApiHost,
	withSourceRequestOptions,
	type HttpHost,
} from "./source-api";
import { movieOrShowImportRef, sourceFetchFailure } from "./source-helpers";

const AUTH = 'MediaBrowser Client="ryot", Device="ryot", DeviceId="ryot-import", Version="1.0.0"';
const ProviderIds = Schema.optional(
	Schema.Struct({
		Imdb: Schema.optional(Schema.String),
		Tmdb: Schema.optional(Schema.String),
		Tvdb: Schema.optional(Schema.String),
	}),
);
const Item = Schema.Struct({
	Id: Schema.String,
	Name: Schema.String,
	ProviderIds,
	Type: Schema.optional(Schema.String),
	SeriesId: Schema.optional(Schema.String),
	IndexNumber: Schema.optional(Schema.Int),
	SeriesName: Schema.optional(Schema.String),
	ParentIndexNumber: Schema.optional(Schema.Int),
	UserData: Schema.optional(
		Schema.Struct({
			IsFavorite: Schema.optional(Schema.Boolean),
			LastPlayedDate: Schema.optional(Schema.String),
		}),
	),
});
const AuthResponse = Schema.Struct({
	AccessToken: Schema.String,
	User: Schema.Struct({ Id: Schema.String }),
});
const ItemsResponse = Schema.Struct({ Items: Schema.Array(Item) });
const headers = (token?: string) => ({
	Accept: "application/json",
	"Content-Type": "application/json",
	Authorization: token ? `${AUTH}, Token="${token}"` : AUTH,
});

export const adaptJellyfinData = (
	input: {
		apiUrl: string;
		username: string;
		password?: string | undefined;
		allowInsecureConnections?: boolean | undefined;
	},
	host: HttpHost,
) =>
	Effect.gen(function* () {
		const requestHost = withSourceRequestOptions(host, input.allowInsecureConnections);
		const auth = yield* requestSourceJson(requestHost, {
			method: "POST",
			baseUrl: input.apiUrl,
			path: "Users/AuthenticateByName",
			headers: headers(),
			body: JSON.stringify({ Pw: input.password ?? "", Username: input.username }),
		}).pipe(Effect.flatMap(Schema.decodeUnknownEffect(AuthResponse)));
		const requestHeaders = headers(auth.AccessToken);
		const library = yield* requestSourceJson(requestHost, {
			headers: requestHeaders,
			baseUrl: input.apiUrl,
			path: `Users/${auth.User.Id}/Items`,
			query: { fields: "ProviderIds", IsPlayed: true, recursive: true },
		}).pipe(Effect.flatMap(Schema.decodeUnknownEffect(ItemsResponse)));
		const failures: MediaImportAdapterFailure[] = [];
		const groups = new Map<string, ImportMediaEntityGroupBuilder>();
		const seriesCache = new Map<string, typeof Item.Type>();
		for (const [itemIndex, item] of library.Items.entries()) {
			const occurredAt = parseDateInput(item.UserData?.LastPlayedDate);
			if (!occurredAt) {
				failures.push({
					itemIndex,
					sourceLabel: item.Name,
					sourceIdentifier: item.Id,
					stage: "input_transformation",
					message: "Jellyfin item has no played timestamp",
				});
				continue;
			}
			if (item.Type === "Movie") {
				const ref = movieOrShowImportRef({
					sourceLabel: item.Name,
					entitySchemaSlug: "movie",
					providerIds: {
						imdb: item.ProviderIds?.Imdb,
						tmdb: item.ProviderIds?.Tmdb,
						tvdb: item.ProviderIds?.Tvdb,
					},
				});
				if (!ref) {
					failures.push({
						itemIndex,
						sourceLabel: item.Name,
						sourceIdentifier: item.Id,
						stage: "input_transformation",
						message: "Jellyfin movie has no TMDB, TVDB, or IMDb identifier",
					});
					continue;
				}
				const group = getOrCreateMediaEntityGroup(groups, ref, itemIndex);
				group.events.push(createCompleteEvent({ occurredAt, completedOn: occurredAt }));
				if (item.UserData?.IsFavorite) {
					addCollectionMembership(group, "Favorites");
				}
				continue;
			}
			if (item.Type !== "Episode") {
				continue;
			}
			if (!item.SeriesId || item.ParentIndexNumber == null || item.IndexNumber == null) {
				failures.push({
					itemIndex,
					sourceLabel: item.Name,
					sourceIdentifier: item.Id,
					stage: "input_transformation",
					message: "Jellyfin episode is missing series or coverage data",
				});
				continue;
			}
			let series = seriesCache.get(item.SeriesId);
			if (!series) {
				const result = yield* requestSourceJson(requestHost, {
					headers: requestHeaders,
					baseUrl: input.apiUrl,
					path: `Items/${item.SeriesId}`,
				}).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Item)), Effect.result);
				if (Result.isFailure(result)) {
					failures.push(
						sourceFetchFailure({
							itemIndex,
							sourceIdentifier: item.Id,
							host: sourceApiHost(input.apiUrl),
							sourceLabel: item.SeriesName ?? item.Name,
							message: "Failed to fetch Jellyfin series details",
						}),
					);
					continue;
				}
				series = result.success;
				seriesCache.set(item.SeriesId, series);
			}
			const label = item.SeriesName ?? series.Name;
			const ref = movieOrShowImportRef({
				sourceLabel: label,
				entitySchemaSlug: "show",
				providerIds: {
					imdb: series.ProviderIds?.Imdb,
					tmdb: series.ProviderIds?.Tmdb,
					tvdb: series.ProviderIds?.Tvdb,
				},
			});
			if (!ref) {
				failures.push({
					itemIndex,
					sourceLabel: label,
					sourceIdentifier: item.Id,
					stage: "input_transformation",
					message: "Jellyfin show has no TMDB, TVDB, or IMDb identifier",
				});
				continue;
			}
			const group = getOrCreateMediaEntityGroup(groups, ref, itemIndex);
			group.events.push({
				occurredAt,
				eventSchemaSlug: "progress",
				properties: { progressPercent: 100 },
				unresolvedEpisode: {
					type: "show",
					episodeNumber: item.IndexNumber,
					seasonNumber: item.ParentIndexNumber,
				},
			});
			if (item.UserData?.IsFavorite) {
				addCollectionMembership(group, "Favorites");
			}
		}
		return {
			failures,
			totalItems: library.Items.length,
			entityGroups: finalizeEntityGroups(groups.values()),
		};
	});
