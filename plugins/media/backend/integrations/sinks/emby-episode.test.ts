import { describe, expect, it } from "@effect/vitest";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";

import { hostSuccess, httpSuccess } from "../../../tests/backend/automations/automation-test-utils";
import { findEmbyShow } from "./emby-episode";
import { manifest } from "./emby.sandbox";
import { findJellyfinShow } from "./jellyfin-episode";
import { parseMediaServer } from "./shared";

type LookupHost = Pick<
	ScriptHost,
	"httpCall" | "getPluginConfig" | "getCachedValue" | "setCachedValue"
>;

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const occurredAt = "2026-01-01T00:00:00.000Z";
const episode = {
	PlaybackInfo: { PositionTicks: 500 },
	Item: {
		IndexNumber: 2,
		Type: "Episode",
		Name: "Episode",
		SeriesName: "Show",
		RunTimeTicks: 1000,
		ParentIndexNumber: 1,
		ProviderIds: { Tmdb: "episode-42" },
	},
};

const lookupHost = (
	routes: Record<string, JsonValue> = {},
	cache = new Map<string, JsonValue>(),
	requests: string[] = [],
): LookupHost =>
	defineSandboxTestHost(manifest, {
		getCachedValue: (key) => hostSuccess(cache.get(key) ?? null),
		getPluginConfig: () => hostSuccess({ tmdbAccessToken: "test-token" }),
		setCachedValue: (key, value) => {
			cache.set(key, value);
			return hostSuccess(null);
		},
		httpCall: (_method, url) => {
			const parsed = new URL(url);
			const path = `${parsed.pathname}${parsed.search}`;
			requests.push(path);
			const response = routes[path];
			return response === undefined
				? Effect.fail({
						message: "Unexpected request",
						data: { body: "", status: 404, headers: {} },
					})
				: httpSuccess(response);
		},
	});

const parseEmby = (payload: unknown, host: LookupHost = lookupHost()) =>
	parseMediaServer("Emby", encodeJson(payload), {}, occurredAt, (value) =>
		findEmbyShow(value, host),
	);

describe("Emby episode show resolution", () => {
	it.effect("never emits the nested episode TMDB ID as a show ID", () =>
		Effect.gen(function* () {
			const result = yield* parseEmby(
				episode,
				lookupHost({
					"/3/search/tv?query=Show": { results: [{ id: 101 }] },
					"/3/tv/101/season/1": { episodes: [{ id: 42, name: "Episode", episode_number: 2 }] },
				}),
			);
			expect(result.entityGroups).toEqual([]);
			expect(result.failures).toEqual([
				{
					itemIndex: 0,
					stage: "provider_resolution",
					message: "Could not resolve Emby episode to a TMDB show",
				},
			]);
		}),
	);

	it.effect("resolves a title search only after verifying the TMDB episode ID", () =>
		Effect.gen(function* () {
			const requests: string[] = [];
			const result = yield* parseEmby(
				{ ...episode, Item: { ...episode.Item, ProviderIds: { Tmdb: "42" } } },
				lookupHost(
					{
						"/3/tv/101/season/1": { episodes: [{ id: 42 }] },
						"/3/tv/100/season/1": { episodes: [{ id: 999 }] },
						"/3/search/tv?query=Show": { results: [{ id: 100 }, { id: 101 }] },
					},
					undefined,
					requests,
				),
			);
			expect(result.failures).toEqual([]);
			expect(result.entityGroups[0]).toMatchObject({
				entityRef: { externalId: "101", entitySchemaSlug: "show", providerSlug: "show.tmdb" },
				events: [
					{
						occurredAt,
						properties: { consumedOn: "Emby", progressPercent: 50 },
						unresolvedEpisode: { type: "show", seasonNumber: 1, episodeNumber: 2 },
					},
				],
			});
			expect(requests).toEqual([
				"/3/search/tv?query=Show",
				"/3/tv/100/season/1",
				"/3/tv/101/season/1",
			]);
		}),
	);

	it.effect.each([
		{ Series: { Type: "Series", ProviderIds: { TMDB: "101" } } },
		{ SeriesProvider_tmdb: "101" },
		{ SeriesProvidertmdb: "101" },
		{ SeriesProviderIds: { Tmdb: "101" } },
	])("uses explicit series IDs without any host calls (%j)", (series) =>
		Effect.gen(function* () {
			const calls: string[] = [];
			const fail = (method: string) => {
				calls.push(method);
				return Effect.fail({ message: "Unexpected host call" });
			};
			const result = yield* parseEmby(
				{ ...episode, ...series },
				{
					httpCall: () => fail("httpCall"),
					getCachedValue: () => fail("getCachedValue"),
					setCachedValue: () => fail("setCachedValue"),
					getPluginConfig: () => fail("getPluginConfig"),
				},
			);
			expect(result.failures).toEqual([]);
			expect(result.entityGroups[0]?.entityRef).toMatchObject({ externalId: "101" });
			expect(calls).toEqual([]);
		}),
	);

	it.effect.each([
		{ provider: "Imdb", source: "imdb_id" },
		{ provider: "Tvdb", source: "tvdb_id" },
	])(
		"resolves nested $provider episode IDs and caches successful results",
		({ source, provider }) =>
			Effect.gen(function* () {
				const payload = {
					...episode,
					Item: { ...episode.Item, ProviderIds: { [provider]: "external-42" } },
				};
				const cache = new Map<string, JsonValue>();
				const first = yield* parseEmby(
					payload,
					lookupHost(
						{
							[`/3/find/external-42?external_source=${source}`]: {
								tv_episode_results: [{ show_id: 101 }],
							},
						},
						cache,
					),
				);
				const requests: string[] = [];
				const second = yield* parseEmby(payload, lookupHost({}, cache, requests));
				for (const result of [first, second]) {
					expect(result.failures).toEqual([]);
					expect(result.entityGroups[0]?.entityRef).toMatchObject({ externalId: "101" });
				}
				expect(requests).toEqual([]);
				expect(cache.size).toBe(1);
			}),
	);

	it.effect("retries external-only misses and keeps IMDb and TVDB cache identities separate", () =>
		Effect.gen(function* () {
			const cache = new Map<string, JsonValue>();
			const payload = {
				...episode,
				Item: { ...episode.Item, SeriesName: "", ProviderIds: { Imdb: "42" } },
			};
			const missing = yield* parseEmby(
				payload,
				lookupHost({ "/3/find/42?external_source=imdb_id": { tv_episode_results: [] } }, cache),
			);
			expect(missing.entityGroups).toEqual([]);
			expect(missing.failures[0]?.stage).toBe("provider_resolution");
			expect(cache.size).toBe(0);
			const found = yield* parseEmby(
				payload,
				lookupHost(
					{ "/3/find/42?external_source=imdb_id": { tv_episode_results: [{ show_id: 101 }] } },
					cache,
				),
			);
			expect(found.entityGroups[0]?.entityRef).toMatchObject({ externalId: "101" });
			const other = yield* parseEmby(
				{ ...payload, Item: { ...payload.Item, ProviderIds: { Tvdb: "42" } } },
				lookupHost(
					{ "/3/find/42?external_source=tvdb_id": { tv_episode_results: [{ show_id: 102 }] } },
					cache,
				),
			);
			expect(other.entityGroups[0]?.entityRef).toMatchObject({ externalId: "102" });
		}),
	);

	it.effect.each(["unique", "ambiguous", "mismatch", "wrong-series", "paginated"])(
		"validates series title, episode title and coordinates for name-only lookup (%s)",
		(scenario) =>
			Effect.gen(function* () {
				const result = yield* parseEmby(
					{ ...episode, Item: { ...episode.Item, ProviderIds: {} } },
					lookupHost({
						"/3/tv/100/season/1": {
							episodes: [{ name: "Episode", episode_number: scenario === "ambiguous" ? 2 : 3 }],
						},
						"/3/tv/101/season/1": {
							episodes: [
								{ episode_number: 2, name: scenario === "mismatch" ? "Other" : "Episode" },
							],
						},
						"/3/search/tv?query=Show": {
							total_pages: scenario === "paginated" ? 2 : 1,
							results: [
								{ id: 100, name: "Show" },
								{ id: 101, name: scenario === "wrong-series" ? "Other" : "Show" },
							],
						},
					}),
				);
				if (scenario === "unique") {
					expect(result.failures).toEqual([]);
					expect(result.entityGroups[0]?.entityRef).toMatchObject({ externalId: "101" });
				} else {
					expect(result.entityGroups).toEqual([]);
					expect(result.failures[0]?.stage).toBe("provider_resolution");
				}
			}),
	);

	it.effect("scopes name-only cache entries by episode identity", () =>
		Effect.gen(function* () {
			const cache = new Map<string, JsonValue>();
			const payload = { ...episode, Item: { ...episode.Item, ProviderIds: {} } };
			const found = yield* parseEmby(
				payload,
				lookupHost(
					{
						"/3/search/tv?query=Show": { results: [{ id: 101, name: "Show" }] },
						"/3/tv/101/season/1": { episodes: [{ name: "Episode", episode_number: 2 }] },
					},
					cache,
				),
			);
			expect(found.failures).toEqual([]);
			const missing = yield* parseEmby(
				{ ...payload, Item: { ...payload.Item, Name: "Other", IndexNumber: 3 } },
				lookupHost({ "/3/search/tv?query=Show": { results: [] } }, cache),
			);
			expect(missing.entityGroups).toEqual([]);
			expect(missing.failures[0]?.stage).toBe("provider_resolution");
		}),
	);

	it.effect("reports lookup failures clearly", () =>
		Effect.gen(function* () {
			const result = yield* parseEmby(episode);
			expect(result.entityGroups).toEqual([]);
			expect(result.failures).toEqual([
				{
					itemIndex: 0,
					stage: "provider_resolution",
					message: "Could not look up Emby episode on TMDB: Unexpected request",
				},
			]);
		}),
	);

	it.effect("reports insufficient episode identity without emitting a show", () =>
		Effect.gen(function* () {
			const result = yield* parseEmby({
				...episode,
				Item: { ...episode.Item, SeriesName: "", ProviderIds: {} },
			});
			expect(result.entityGroups).toEqual([]);
			expect(result.failures[0]?.stage).toBe("provider_resolution");
		}),
	);

	it.effect("preserves Emby movie and unofficial Jellyfin episode behavior without lookups", () =>
		Effect.gen(function* () {
			const requests: string[] = [];
			const host = lookupHost({}, undefined, requests);
			const movie = yield* parseEmby(
				{ ...episode, Item: { ...episode.Item, Type: "Movie", ProviderIds: { Tmdb: "42" } } },
				host,
			);
			const jellyfin = yield* parseMediaServer(
				"Jellyfin",
				encodeJson(episode),
				{},
				occurredAt,
				(value, provider) => findJellyfinShow(value, provider, host),
			);
			expect(movie.failures).toEqual([]);
			expect(movie.entityGroups[0]?.entityRef).toMatchObject({
				externalId: "42",
				providerSlug: "movie.tmdb",
			});
			expect(jellyfin.failures).toEqual([]);
			expect(jellyfin.entityGroups[0]?.entityRef).toMatchObject({
				externalId: "episode-42",
				providerSlug: "show.tmdb",
			});
			expect(requests).toEqual([]);
		}),
	);
});
