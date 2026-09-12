import { describe, expect, it } from "@effect/vitest";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";

import {
	execution,
	hostFailure,
	hostSuccess,
	httpSuccess,
	integrationRecord,
} from "../../../tests/backend/automations/automation-test-utils";
import { runIntegrationTestScript } from "../artifacts.test-support";
import browserDefinition, { manifest as browserManifest } from "./browser-extension.sandbox";
import embyDefinition, { manifest as embyManifest } from "./emby.sandbox";
import jellyfinDefinition, { manifest as jellyfinManifest } from "./jellyfin.sandbox";
import kodiDefinition, { manifest as kodiManifest, parseKodi } from "./kodi.sandbox";
import plexDefinition, { manifest as plexManifest } from "./plex.sandbox";

const json = "application/json";
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const sinkInput = (rawBody: string, contentType = json) => ({ rawBody, contentType });
const runKodi = (rawBody: string) =>
	Effect.runPromise(
		runIntegrationTestScript(
			kodiDefinition,
			sinkInput(rawBody),
			defineSandboxTestHost(kodiManifest, {
				getCurrentIntegration: () => hostSuccess(integrationRecord({ provider: "kodi" })),
			}),
			execution,
		),
	);
const multipart = (payload: unknown) =>
	`--abc\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${encodeJson(payload)}\r\n--abc--`;

describe("Kodi sink", () => {
	it("maps Kodi show progress to a TMDB show ref", () => {
		const result = Effect.runSync(
			parseKodi(
				encodeJson({
					lot: "show",
					progress: 45,
					identifier: "1234",
					show_season_number: 2,
					show_episode_number: 7,
				}),
				"2026-01-01T00:00:00.000Z",
			),
		);
		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "1234", entitySchemaSlug: "show", providerSlug: "show.tmdb" },
			events: [
				{
					eventSchemaSlug: "progress",
					properties: { consumedOn: "kodi", progressPercent: 45 },
					unresolvedEpisode: { type: "show", seasonNumber: 2, episodeNumber: 7 },
				},
			],
		});
		expect(result.entityGroups[0]?.events[0]?.occurredAt).toBe("2026-01-01T00:00:00.000Z");
	});

	it("returns an input_transformation failure for malformed payloads", () => {
		const result = Effect.runSync(parseKodi(encodeJson("not-json"), "2026-01-01T00:00:00.000Z"));
		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				stage: "input_transformation",
				message: "Could not parse Kodi webhook payload",
			},
		]);
	});

	it("returns an input_transformation failure for invalid show season and episode values", () => {
		const result = Effect.runSync(
			parseKodi(
				encodeJson({
					lot: "show",
					progress: 45,
					identifier: "1234",
					show_episode_number: 7.5,
					show_season_number: Number.NaN,
				}),
				"2026-01-01T00:00:00.000Z",
			),
		);
		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				stage: "input_transformation",
				message: "Kodi webhook payload is missing show episode coordinates",
			},
		]);
	});

	it.live("parses a Kodi webhook raw body", () =>
		Effect.gen(function* () {
			const result = yield* Effect.promise(() =>
				runKodi(encodeJson({ lot: "movie", progress: 30, identifier: "603" })),
			);
			expect(result.failures).toEqual([]);
			expect(result.entityGroups[0]?.entityRef).toMatchObject({
				externalId: "603",
				entitySchemaSlug: "movie",
				providerSlug: "movie.tmdb",
			});
		}),
	);
});

describe("media server sinks", () => {
	it.live("maps an Emby episode webhook to a TMDB show ref", () =>
		Effect.gen(function* () {
			const rawBody = encodeJson({
				IndexNumber: 3,
				PositionTicks: 50,
				RunTimeTicks: 100,
				ItemType: "Episode",
				ParentIndexNumber: 1,
				SeriesName: "Severance",
				SeriesProvider_tmdb: "95396",
			});
			const result = yield* runIntegrationTestScript(
				embyDefinition,
				sinkInput(rawBody),
				defineSandboxTestHost(embyManifest, {
					getCurrentIntegration: () => hostSuccess(integrationRecord({ provider: "emby" })),
				}),
				execution,
			);
			expect(result.failures).toEqual([]);
			expect(result.entityGroups[0]).toMatchObject({
				entityRef: { externalId: "95396", entitySchemaSlug: "show", providerSlug: "show.tmdb" },
				events: [
					{
						properties: { consumedOn: "emby", progressPercent: 50 },
						unresolvedEpisode: { type: "show", seasonNumber: 1, episodeNumber: 3 },
					},
				],
			});
		}),
	);

	it.live("maps a Jellyfin episode webhook to a TMDB show ref with an episode locator", () =>
		Effect.gen(function* () {
			const rawBody = encodeJson({
				IndexNumber: 4,
				RunTimeTicks: 100,
				PositionTicks: 25,
				SeriesName: "Silo",
				ItemType: "Episode",
				ParentIndexNumber: 2,
				SeriesProvider_tmdb: "125988",
			});
			const result = yield* runIntegrationTestScript(
				jellyfinDefinition,
				sinkInput(rawBody),
				defineSandboxTestHost(jellyfinManifest, {
					getCurrentIntegration: () =>
						hostSuccess(integrationRecord({ provider: "jellyfin_sink" })),
				}),
				execution,
			);
			expect(result.failures).toEqual([]);
			expect(result.entityGroups[0]).toMatchObject({
				entityRef: { externalId: "125988", entitySchemaSlug: "show", providerSlug: "show.tmdb" },
				events: [
					{
						properties: { progressPercent: 25, consumedOn: "jellyfin_sink" },
						unresolvedEpisode: { type: "show", seasonNumber: 2, episodeNumber: 4 },
					},
				],
			});
		}),
	);

	it.live("skips a Jellyfin webhook when the username does not match", () =>
		Effect.gen(function* () {
			const result = yield* runIntegrationTestScript(
				jellyfinDefinition,
				sinkInput(
					encodeJson({
						ItemType: "Movie",
						PositionTicks: 50,
						RunTimeTicks: 100,
						Provider_tmdb: "603",
						User: { Name: "bob" },
					}),
				),
				defineSandboxTestHost(jellyfinManifest, {
					getCurrentIntegration: () =>
						hostSuccess(integrationRecord({ providerSpecifics: { username: "alice" } })),
				}),
				execution,
			);
			expect(result.entityGroups).toEqual([]);
			expect(result.failures).toEqual([]);
		}),
	);
});

const runJellyfin = (payload: unknown, providerSpecifics?: Record<string, string>) =>
	runIntegrationTestScript(
		jellyfinDefinition,
		sinkInput(encodeJson(payload)),
		defineSandboxTestHost(jellyfinManifest, {
			getCurrentIntegration: () =>
				hostSuccess(
					integrationRecord({
						provider: "jellyfin_sink",
						...(providerSpecifics ? { providerSpecifics } : {}),
					}),
				),
		}),
		execution,
	);

describe("Jellyfin official webhook plugin", () => {
	it.live("records a completed movie stop as full progress without ticks", () =>
		Effect.gen(function* () {
			const result = yield* runJellyfin({
				ItemType: "Movie",
				Provider_tmdb: "789",
				PlayedToCompletion: true,
				NotificationType: "PlaybackStop",
			});
			expect(result.failures).toEqual([]);
			expect(result.entityGroups[0]).toMatchObject({
				events: [{ properties: { progressPercent: 100 } }],
				entityRef: { externalId: "789", entitySchemaSlug: "movie" },
			});
		}),
	);

	it.live("prefers the series id for an episode start", () =>
		Effect.gen(function* () {
			const result = yield* runJellyfin({
				SeasonNumber: 1,
				EpisodeNumber: 2,
				RunTimeTicks: 2000,
				ItemType: "Episode",
				Provider_tmdb: "999",
				PlayedToCompletion: false,
				PlaybackPositionTicks: 500,
				NotificationType: "PlaybackStart",
				Series: { ProviderIds: { Tmdb: "101" } },
			});
			expect(result.failures).toEqual([]);
			expect(result.entityGroups[0]).toMatchObject({
				entityRef: { externalId: "101", entitySchemaSlug: "show" },
				events: [
					{
						properties: { progressPercent: 25 },
						unresolvedEpisode: { seasonNumber: 1, episodeNumber: 2 },
					},
				],
			});
		}),
	);

	it.live("coerces string values and case-insensitive provider keys", () =>
		Effect.gen(function* () {
			const result = yield* runJellyfin({
				ItemType: "Episode",
				Provider_TMDB: "202",
				RuntimeTicks: "2000",
				SeasonNumber00: "01",
				EpisodeNumber00: "02",
				PlayedToCompletion: "False",
				PlaybackPositionTicks: "500",
				NotificationType: "PlaybackProgress",
			});
			expect(result.failures).toEqual([]);
			expect(result.entityGroups[0]).toMatchObject({
				entityRef: { externalId: "202" },
				events: [
					{
						properties: { progressPercent: 25 },
						unresolvedEpisode: { seasonNumber: 1, episodeNumber: 2 },
					},
				],
			});
		}),
	);

	it.live.each(["ItemAdded", "SessionStart", "MarkUnplayed"])(
		"ignores the %s notification type",
		(notificationType) =>
			Effect.gen(function* () {
				const result = yield* runJellyfin({
					ItemType: "Movie",
					RunTimeTicks: 100,
					Provider_tmdb: "404",
					PlaybackPositionTicks: 10,
					NotificationType: notificationType,
				});
				expect(result).toEqual({ failures: [], entityGroups: [] });
			}),
	);

	it.live("treats numeric and yes completion flags as played", () =>
		Effect.gen(function* () {
			const numeric = yield* runJellyfin({
				ItemType: "Movie",
				Provider_tmdb: "707",
				PlayedToCompletion: 1,
				NotificationType: "PlaybackStop",
			});
			const yes = yield* runJellyfin({
				Played: "yes",
				ItemType: "Movie",
				Provider_tmdb: "707",
				NotificationType: "PlaybackStop",
			});
			expect(numeric.entityGroups[0]?.events[0]?.properties).toMatchObject({
				progressPercent: 100,
			});
			expect(yes.entityGroups[0]?.events[0]?.properties).toMatchObject({ progressPercent: 100 });
		}),
	);

	it.live("ignores unsupported item types", () =>
		Effect.gen(function* () {
			const result = yield* runJellyfin({
				ItemType: "Audio",
				RunTimeTicks: 100,
				Provider_tmdb: "808",
				PlaybackPositionTicks: 10,
				NotificationType: "PlaybackStart",
			});
			expect(result).toEqual({ failures: [], entityGroups: [] });
		}),
	);

	it.live("uses the item type instead of the series type", () =>
		Effect.gen(function* () {
			const result = yield* runJellyfin({
				Event: "Play",
				Session: { PlayState: { PositionTicks: 50 } },
				Series: { Type: "Series", ProviderIds: { Tmdb: "101" } },
				Item: {
					IndexNumber: 2,
					Type: "Episode",
					RunTimeTicks: 100,
					ParentIndexNumber: 1,
					ProviderIds: { Tmdb: "999" },
				},
			});
			expect(result.failures).toEqual([]);
			expect(result.entityGroups[0]).toMatchObject({
				events: [{ properties: { progressPercent: 50 } }],
				entityRef: { externalId: "101", entitySchemaSlug: "show" },
			});
		}),
	);

	it.live("reads the played flag only from the item user data", () =>
		Effect.gen(function* () {
			const item = { Type: "Movie", RunTimeTicks: 100, ProviderIds: { Tmdb: "909" } };
			const sessionPlayed = yield* runJellyfin({
				Item: item,
				Event: "Stop",
				Session: { UserData: { Played: true }, PlayState: { PositionTicks: 40 } },
			});
			const itemPlayed = yield* runJellyfin({
				Event: "Stop",
				Item: { ...item, UserData: { Played: true } },
				Session: { PlayState: { PositionTicks: 40 } },
			});
			expect(sessionPlayed.entityGroups[0]?.events[0]?.properties).toMatchObject({
				progressPercent: 40,
			});
			expect(itemPlayed.entityGroups[0]?.events[0]?.properties).toMatchObject({
				progressPercent: 100,
			});
		}),
	);

	it.live("filters by the user name rather than the session user name", () =>
		Effect.gen(function* () {
			const result = yield* runJellyfin(
				{
					Event: "Play",
					User: { Name: "bob" },
					Session: { UserName: "alice", PlayState: { PositionTicks: 50 } },
					Item: { Type: "Movie", RunTimeTicks: 100, ProviderIds: { Tmdb: "303" } },
				},
				{ username: "alice" },
			);
			expect(result).toEqual({ failures: [], entityGroups: [] });
		}),
	);

	it.live("completes an unofficial MarkPlayed event and ignores MarkUnplayed", () =>
		Effect.gen(function* () {
			const item = { Type: "Movie", ProviderIds: { Tmdb: "606" } };
			const played = yield* runJellyfin({ Item: item, Event: "MarkPlayed" });
			const unplayed = yield* runJellyfin({ Item: item, Event: "MarkUnplayed" });
			expect(played.entityGroups[0]).toMatchObject({
				entityRef: { externalId: "606" },
				events: [{ properties: { progressPercent: 100 } }],
			});
			expect(unplayed).toEqual({ failures: [], entityGroups: [] });
		}),
	);
});

const notFound = Symbol("notFound");
type Route = JsonValue | typeof notFound;
type PlexHost = Pick<
	ScriptHost,
	"getCurrentIntegration" | "httpCall" | "getPluginConfig" | "getCachedValue" | "setCachedValue"
>;

const tmdbRoutes =
	(routes: Record<string, Route>): PlexHost["httpCall"] =>
	(_method, url) => {
		const parsed = new URL(url);
		const response = routes[`${parsed.pathname}${parsed.search}`];
		if (response === notFound) {
			return Effect.fail({ message: "not found", data: { body: "", status: 404, headers: {} } });
		}
		return response === undefined ? hostFailure("request failed") : httpSuccess(response);
	};

const runPlex = (
	payload: unknown,
	options: {
		username?: string;
		routes?: Record<string, Route>;
		cache?: Map<string, JsonValue>;
	} = {},
) => {
	const cache = options.cache ?? new Map<string, JsonValue>();
	return Effect.runPromise(
		runIntegrationTestScript(
			plexDefinition,
			sinkInput(multipart(payload), "multipart/form-data; boundary=abc"),
			defineSandboxTestHost(plexManifest, {
				httpCall: tmdbRoutes(options.routes ?? {}),
				getCachedValue: (key) => hostSuccess(cache.get(key) ?? null),
				setCachedValue: (key, value) => {
					cache.set(key, value);
					return hostSuccess(null);
				},
				getPluginConfig: ({ required: keys = [] }) =>
					hostSuccess(Object.fromEntries(keys.map((key) => [key, "token"]))),
				getCurrentIntegration: () =>
					hostSuccess(
						integrationRecord({
							provider: "plex_sink",
							providerSpecifics:
								options.username === undefined ? {} : { username: options.username },
						}),
					),
			}),
			execution,
		),
	);
};

const plexEpisode = (Guid: Array<{ id: string }>) => ({
	event: "media.pause",
	Metadata: {
		Guid,
		index: 5,
		duration: 100,
		viewOffset: 80,
		parentIndex: 3,
		type: "episode",
		grandparentTitle: "Foundation",
	},
});

describe("Plex sink", () => {
	it.live("maps a Plex scrobble multipart webhook to a movie ref", () =>
		Effect.gen(function* () {
			const result = yield* Effect.promise(() =>
				runPlex({
					event: "media.scrobble",
					Metadata: { type: "movie", title: "Inception", Guid: [{ id: "tmdb://27205" }] },
				}),
			);
			expect(result.failures).toEqual([]);
			expect(result.entityGroups[0]).toMatchObject({
				events: [{ properties: { progressPercent: 100, consumedOn: "plex_sink" } }],
				entityRef: { externalId: "27205", entitySchemaSlug: "movie", providerSlug: "movie.tmdb" },
			});
		}),
	);

	it.live("resolves a Plex episode to its TMDB show through the episode IMDb id", () =>
		Effect.gen(function* () {
			const result = yield* Effect.promise(() =>
				runPlex(plexEpisode([{ id: "imdb://tt1234" }, { id: "tmdb://5221957" }]), {
					routes: {
						"/3/find/tt1234?external_source=imdb_id": {
							tv_episode_results: [{ id: 5221957, show_id: 93740 }],
						},
					},
				}),
			);
			expect(result.failures).toEqual([]);
			expect(result.entityGroups[0]).toMatchObject({
				entityRef: { externalId: "93740", entitySchemaSlug: "show", providerSlug: "show.tmdb" },
				events: [
					{
						properties: { progressPercent: 80, consumedOn: "plex_sink" },
						unresolvedEpisode: { type: "show", seasonNumber: 3, episodeNumber: 5 },
					},
				],
			});
		}),
	);

	it.live("falls back to a title search confirmed by the season episode ids", () =>
		Effect.gen(function* () {
			const cache = new Map<string, JsonValue>();
			const episode = plexEpisode([{ id: "tvdb://777" }, { id: "tmdb://5221957" }]);
			const result = yield* Effect.promise(() =>
				runPlex(episode, {
					cache,
					routes: {
						"/3/tv/1/season/3": notFound,
						"/3/tv/2/season/3": { episodes: [{ id: 11 }] },
						"/3/find/777?external_source=tvdb_id": { tv_episode_results: [] },
						"/3/tv/93740/season/3": { episodes: [{ id: 10 }, { id: 5221957 }] },
						"/3/search/tv?query=Foundation": { results: [{ id: 1 }, { id: 2 }, { id: 93740 }] },
					},
				}),
			);
			const cached = yield* Effect.promise(() => runPlex(episode, { cache }));
			expect(result.failures).toEqual([]);
			expect(result.entityGroups[0]?.entityRef).toMatchObject({ externalId: "93740" });
			expect(cached.entityGroups[0]?.entityRef).toMatchObject({ externalId: "93740" });
		}),
	);

	it.live("reports a Plex episode whose show is not on TMDB", () =>
		Effect.gen(function* () {
			const result = yield* Effect.promise(() =>
				runPlex(plexEpisode([{ id: "tmdb://5221957" }]), {
					routes: { "/3/search/tv?query=Foundation": { results: [] } },
				}),
			);
			expect(result).toEqual({
				entityGroups: [],
				failures: [
					{
						itemIndex: 0,
						stage: "provider_resolution",
						message: 'No show found on TMDB for series "Foundation" and episode 5221957',
					},
				],
			});
		}),
	);

	it.live("reports a failed TMDB show lookup", () =>
		Effect.gen(function* () {
			const result = yield* Effect.promise(() =>
				runPlex(plexEpisode([{ id: "imdb://tt1234" }, { id: "tmdb://5221957" }])),
			);
			expect(result.entityGroups).toEqual([]);
			expect(result.failures[0]?.message).toMatch(
				/^Could not look up Plex episode 5221957 on TMDB/,
			);
		}),
	);

	it.live.each([
		{
			skipped: false,
			username: "   ",
			name: "accepts a Plex webhook from any user when the configured username is blank",
		},
		{
			skipped: true,
			username: "alice",
			name: "skips a Plex webhook when the configured username does not match",
		},
		{
			skipped: false,
			username: "  bob  ",
			name: "trims a whitespace-padded Plex username before matching",
		},
	])("$name", ({ skipped, username }) =>
		Effect.gen(function* () {
			const result = yield* Effect.promise(() =>
				runPlex(
					{
						event: "media.scrobble",
						Account: { title: "bob" },
						Metadata: { type: "movie", title: "Inception", Guid: [{ id: "tmdb://27205" }] },
					},
					{ username },
				),
			);
			expect(result.failures).toEqual([]);
			if (skipped) {
				expect(result.entityGroups).toEqual([]);
			} else {
				expect(result.entityGroups[0]?.entityRef).toMatchObject({ externalId: "27205" });
			}
		}),
	);
});

const runBrowser = (rawBody: string, disabledSites: string[] = []) =>
	Effect.runPromise(
		runIntegrationTestScript(
			browserDefinition,
			sinkInput(rawBody),
			defineSandboxTestHost(browserManifest, {
				getCurrentIntegration: () =>
					hostSuccess(integrationRecord({ providerSpecifics: { disabledSites } })),
			}),
			execution,
		),
	);

describe("browser extension sink", () => {
	it.live("ignores browser extension events from disabled sites", () =>
		Effect.gen(function* () {
			const result = yield* Effect.promise(() =>
				runBrowser(
					encodeJson({
						url: "https://www.youtube.com/watch?v=1",
						data: { progress: 80, lot: "movie", identifier: "12345" },
					}),
					["youtube.com"],
				),
			);
			expect(result.entityGroups).toEqual([]);
			expect(result.failures).toEqual([]);
		}),
	);

	it.live("maps a browser extension show webhook to a TMDB show ref with an episode locator", () =>
		Effect.gen(function* () {
			const result = yield* Effect.promise(() =>
				runBrowser(
					encodeJson({
						url: "https://www.max.com/watch/1",
						data: {
							lot: "show",
							progress: 80,
							identifier: "94997",
							show_season_number: 1,
							show_episode_number: 6,
						},
					}),
				),
			);
			expect(result.failures).toEqual([]);
			expect(result.entityGroups[0]).toMatchObject({
				entityRef: { externalId: "94997", entitySchemaSlug: "show", providerSlug: "show.tmdb" },
				events: [
					{
						properties: { consumedOn: "max", progressPercent: 80 },
						unresolvedEpisode: { type: "show", seasonNumber: 1, episodeNumber: 6 },
					},
				],
			});
		}),
	);
});
