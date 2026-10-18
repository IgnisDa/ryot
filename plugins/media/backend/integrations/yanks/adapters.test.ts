import { describe, expect, it } from "@effect/vitest";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { genericImportChunkSchema } from "@ryot-app/plugin-backend-sdk/imports";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { TestClock } from "effect/testing";

import {
	execution,
	hostFailure,
	hostSuccess,
	httpSuccess,
	integrationRecord,
} from "../../../tests/backend/automations/automation-test-utils";
import { createMediaImportChunk } from "../../imports/chunks";
import { mediaFilesystem } from "../../imports/ingestion.test-support";
import type { MediaImportFailure, MediaIntegrationAdapterResult } from "../../imports/schemas";
import type { HistoryClient } from "../../lib/vendors/youtube-music";
import { integrationTestResult, runIntegrationTestScript } from "../artifacts.test-support";
import { confirmIntegrationSource } from "../source-state";
import komgaDefinition, {
	mangaRef as extractMangaRef,
	manifest as komgaManifest,
} from "./komga.sandbox";
import plexDefinition, { manifest as plexManifest } from "./plex.sandbox";
import {
	dailyProgressWindow,
	manifest as youtubeMusicManifest,
	runYoutubeMusicYank,
} from "./youtube-music.sandbox";

const failure = Symbol("failure");
type Route = JsonValue | typeof failure;
type HttpCall = Pick<
	ScriptHost,
	"getCurrentIntegration" | "httpCall" | "getPluginConfig" | "getCachedValue" | "setCachedValue"
>["httpCall"];
type EntityGroup = MediaIntegrationAdapterResult["entityGroups"][number];

const routeKey = (url: string) => {
	const parsed = new URL(url);
	return `${parsed.pathname}${parsed.search}`;
};

const httpCall =
	(routes: Record<string, Route>): HttpCall =>
	(_method, url) => {
		const response = routes[routeKey(url)];
		return response === failure || response === undefined
			? hostFailure("request failed")
			: httpSuccess(response);
	};

const libraries = (entries: Array<Record<string, JsonValue>>) => ({
	MediaContainer: { Directory: entries },
});

const metadata = (items: Array<Record<string, JsonValue>>) => ({
	MediaContainer: { Metadata: items },
});

const historyClient = (
	songs: ReadonlyArray<{ title: string; videoId: string }> = [{ videoId: "v1", title: "First" }],
): HistoryClient => ({
	getHistory: () =>
		Effect.succeed({
			contents: {
				singleColumnBrowseResultsRenderer: {
					tabs: [
						{
							tabRenderer: {
								content: {
									sectionListRenderer: {
										contents: [
											{
												musicShelfRenderer: {
													title: { runs: [{ text: "January 1, 2026" }] },
													contents: songs.map((song) => ({
														musicResponsiveListItemRenderer: {
															playlistItemData: { videoId: song.videoId },
															flexColumns: [
																{
																	musicResponsiveListItemFlexColumnRenderer: {
																		text: { runs: [{ text: song.title }] },
																	},
																},
															],
														},
													})),
												},
											},
										],
									},
								},
							},
						},
					],
				},
			},
		}),
});

const expectDistinctChunkFailureIds = (failures: ReadonlyArray<MediaImportFailure>) => {
	const ids = failures.map(({ operationId }) => operationId);
	expect(new Set(ids).size).toBe(ids.length);
	expect(() =>
		Schema.decodeSync(genericImportChunkSchema)(
			createMediaImportChunk(
				{ failures, entityGroups: [], populationResults: [] },
				"2026-01-01T00:00:00.000Z",
			),
		),
	).not.toThrow();
};

const progressValues = (result: MediaIntegrationAdapterResult) =>
	result.entityGroups.flatMap((group) =>
		group.events.map((event) => event.properties["progressPercent"]),
	);

const runPlex = (routes: Record<string, Route>, syncOwnership = false) =>
	Effect.runPromise(
		runIntegrationTestScript(
			plexDefinition,
			{},
			defineSandboxTestHost(plexManifest, {
				httpCall: httpCall(routes),
				getCurrentIntegration: () =>
					hostSuccess(
						integrationRecord({
							syncOwnership,
							provider: "plex_yank",
							providerSpecifics: { token: "token", baseUrl: "http://plex.test:32400" },
						}),
					),
			}),
			execution,
		),
	);

describe("Plex yank", () => {
	it.live("maps watched movies and per-episode show coverage by guid", () =>
		Effect.gen(function* () {
			const result = yield* Effect.promise(() =>
				runPlex({
					"/library/sections": libraries([
						{ key: "1", type: "movie", title: "Movies" },
						{ key: "2", type: "show", title: "Shows" },
					]),
					"/library/metadata/555/allLeaves": metadata([
						{ index: 3, key: "/e/1", title: "Ep1", parentIndex: 1, lastViewedAt: 1_700_000_100 },
					]),
					"/library/sections/1/all?includeGuids=1": metadata([
						{
							key: "/m/1",
							type: "movie",
							title: "Arrival",
							lastViewedAt: 1_700_000_000,
							Guid: [{ id: "tmdb://329865" }],
						},
					]),
					"/library/sections/2/all?includeGuids=1": metadata([
						{
							key: "/s/1",
							type: "show",
							ratingKey: "555",
							title: "Severance",
							lastViewedAt: 1_700_000_000,
							Guid: [{ id: "tmdb://95396" }],
						},
					]),
				}),
			);
			expect(result.failures).toEqual([]);
			expect(result.entityGroups).toHaveLength(2);
			expect(result.entityGroups[0]).toMatchObject({
				events: [{ eventSchemaSlug: "complete" }],
				entityRef: { externalId: "329865", entitySchemaSlug: "movie", providerSlug: "movie.tmdb" },
			});
			expect(result.entityGroups[1]).toMatchObject({
				entityRef: { externalId: "95396", entitySchemaSlug: "show", providerSlug: "show.tmdb" },
				events: [
					{
						eventSchemaSlug: "progress",
						properties: { progressPercent: 100 },
						unresolvedEpisode: { type: "show", seasonNumber: 1, episodeNumber: 3 },
					},
				],
			});
		}),
	);

	it.live("records a failure for a watched item without a provider id", () =>
		Effect.gen(function* () {
			const result = yield* Effect.promise(() =>
				runPlex({
					"/library/sections": libraries([{ key: "1", type: "movie", title: "Movies" }]),
					"/library/sections/1/all?includeGuids=1": metadata([
						{ key: "/m/9", type: "movie", title: "No Ids", lastViewedAt: 1_700_000_000 },
					]),
				}),
			);
			expect(result.entityGroups).toEqual([]);
			expect(result.failures).toHaveLength(1);
			expect(result.failures[0]).toMatchObject({
				itemIndex: 0,
				sourceLabel: "No Ids",
				stage: "input_transformation",
				message: "Plex item has no TMDB, TVDB, or IMDb identifier",
			});
		}),
	);

	it.live(
		"gives consecutive failing library fetches and the next library's first item distinct rows",
		() =>
			Effect.gen(function* () {
				const result = yield* Effect.promise(() =>
					runPlex({
						"/library/sections/3/all?includeGuids=1": metadata([
							{ key: "/m/9", type: "movie", title: "No Ids", lastViewedAt: 1_700_000_000 },
						]),
						"/library/sections": libraries([
							{ key: "1", type: "movie", title: "Movies" },
							{ key: "2", type: "movie", title: "Films" },
							{ key: "3", type: "movie", title: "Clips" },
						]),
					}),
				);
				expect(result.failures.map(({ itemIndex }) => itemIndex)).toEqual([0, 1, 2]);
				expectDistinctChunkFailureIds(result.failures);
			}),
	);

	it.live("returns owned movies and shows regardless of watch state", () =>
		Effect.gen(function* () {
			const result = yield* Effect.promise(() =>
				runPlex(
					{
						"/library/sections": libraries([
							{ key: "1", type: "movie", title: "Movies" },
							{ key: "2", type: "show", title: "Shows" },
						]),
						"/library/sections/1/all?includeGuids=1": metadata([
							{ key: "/m/1", type: "movie", title: "Arrival", Guid: [{ id: "tmdb://329865" }] },
						]),
						"/library/sections/2/all?includeGuids=1": metadata([
							{ key: "/s/1", type: "show", title: "Severance", Guid: [{ id: "tmdb://95396" }] },
						]),
					},
					true,
				),
			);
			const owned = result.entityGroups.filter(
				(group: EntityGroup) => group.ownershipProvider === "plex_yank",
			);
			expect(owned).toHaveLength(2);
			expect(owned.map((group: EntityGroup) => group.entityRef)).toMatchObject([
				{ externalId: "329865", entitySchemaSlug: "movie" },
				{ externalId: "95396", entitySchemaSlug: "show" },
			]);
		}),
	);

	it.live("omits owned items without a provider id", () =>
		Effect.gen(function* () {
			const result = yield* Effect.promise(() =>
				runPlex(
					{
						"/library/sections": libraries([{ key: "1", type: "movie", title: "Movies" }]),
						"/library/sections/1/all?includeGuids=1": metadata([
							{ key: "/m/1", type: "movie", title: "With Id", Guid: [{ id: "tmdb://1" }] },
							{ key: "/m/2", type: "movie", title: "No Id" },
						]),
					},
					true,
				),
			);
			expect(
				result.entityGroups.filter((group: EntityGroup) => group.ownershipProvider),
			).toHaveLength(1);
		}),
	);

	it.live("skips a section whose item fetch fails and keeps the rest", () =>
		Effect.gen(function* () {
			const result = yield* Effect.promise(() =>
				runPlex(
					{
						"/library/sections/2/all?includeGuids=1": failure,
						"/library/sections": libraries([
							{ key: "1", type: "movie", title: "Movies" },
							{ key: "2", type: "show", title: "Shows" },
						]),
						"/library/sections/1/all?includeGuids=1": metadata([
							{ key: "/m/1", type: "movie", title: "Arrival", Guid: [{ id: "tmdb://329865" }] },
						]),
					},
					true,
				),
			);
			expect(
				result.entityGroups.filter((group: EntityGroup) => group.ownershipProvider),
			).toHaveLength(1);
			expect(result.failures[0]).toMatchObject({ stage: "source_fetch" });
		}),
	);

	it.live("falls back to an unresolved IMDb ref", () =>
		Effect.gen(function* () {
			const result = yield* Effect.promise(() =>
				runPlex({
					"/library/sections": libraries([{ key: "1", type: "movie", title: "Movies" }]),
					"/library/sections/1/all?includeGuids=1": metadata([
						{
							key: "/m/1",
							type: "movie",
							title: "Primer",
							lastViewedAt: 1_700_000_000,
							Guid: [{ id: "imdb://tt0390384" }, { id: "tvdb://123" }],
						},
					]),
				}),
			);
			expect(result.entityGroups[0]?.entityRef).toEqual({
				kind: "unresolved",
				sourceLabel: "Primer",
				identifierType: "imdb",
				entitySchemaSlug: "movie",
				identifierValue: "tt0390384",
			});
		}),
	);

	it.live("isolates a show episode request failure and continues later rows", () =>
		Effect.gen(function* () {
			const result = yield* Effect.promise(() =>
				runPlex({
					"/library/metadata/1/allLeaves": failure,
					"/library/sections": libraries([{ key: "1", type: "show", title: "Shows" }]),
					"/library/metadata/2/allLeaves": metadata([
						{
							index: 1,
							key: "/e/2",
							parentIndex: 1,
							title: "Episode",
							lastViewedAt: 1_700_000_100,
						},
					]),
					"/library/sections/1/all?includeGuids=1": metadata([
						{
							key: "/s/1",
							type: "show",
							ratingKey: "1",
							title: "Broken",
							Guid: [{ id: "tmdb://1" }],
							lastViewedAt: 1_700_000_000,
						},
						{
							key: "/s/2",
							type: "show",
							ratingKey: "2",
							title: "Working",
							Guid: [{ id: "tmdb://2" }],
							lastViewedAt: 1_700_000_000,
						},
					]),
				}),
			);
			expect(result.failures[0]).toMatchObject({
				itemIndex: 0,
				stage: "source_fetch",
				message: "Failed to fetch watched episodes from Plex",
			});
			expect(result.entityGroups[0]?.entityRef).toMatchObject({ externalId: "2" });
		}),
	);
});

describe("Komga yank", () => {
	it("maps an AniList manga link to a resolved manga.anilist ref", () => {
		expect(
			extractMangaRef([{ label: "AniList", url: "https://anilist.co/manga/30002" }], "Berserk"),
		).toEqual({
			kind: "resolved",
			externalId: "30002",
			sourceLabel: "Berserk",
			entitySchemaSlug: "manga",
			providerSlug: "manga.anilist",
		});
	});

	it("maps a MyAnimeList link to manga.myanimelist", () => {
		expect(
			extractMangaRef(
				[{ label: "MyAnimeList", url: "https://myanimelist.net/manga/2/Berserk" }],
				"Berserk",
			),
		).toMatchObject({ externalId: "2", providerSlug: "manga.myanimelist" });
	});

	it("maps a MangaUpdates link to manga.manga-updates", () => {
		expect(
			extractMangaRef(
				[{ label: "MangaUpdates", url: "https://www.mangaupdates.com/series/pb8uwds/one-piece" }],
				"Berserk",
			),
		).toMatchObject({ externalId: "55099564912", providerSlug: "manga.manga-updates" });
	});

	it("returns null for links without a supported manga resolver", () => {
		expect(
			extractMangaRef(
				[{ label: "Hardcover", url: "https://hardcover.app/books/berserk" }],
				"Berserk",
			),
		).toBeNull();
	});

	it("returns null when there are no links", () => {
		expect(extractMangaRef([], "Berserk")).toBeNull();
	});

	it.live("accepts null and unread progress while preserving ownership", () =>
		Effect.gen(function* () {
			const book = {
				id: "book1",
				readProgress: null,
				media: { pagesCount: 100 },
				metadata: {
					title: "Berserk",
					links: [{ label: "AniList", url: "https://anilist.co/manga/30002" }],
				},
			};
			const result = yield* runIntegrationTestScript(
				komgaDefinition,
				{},
				defineSandboxTestHost(komgaManifest, {
					httpCall: httpCall({
						"/api/v1/books/list?page=0&size=500": {
							totalPages: 1,
							content: [book, { ...book, id: "unread", readProgress: { page: 0 } }],
						},
					}),
					getCurrentIntegration: () =>
						hostSuccess(
							integrationRecord({
								provider: "komga",
								syncOwnership: true,
								providerSpecifics: { apiKey: "key", baseUrl: "http://komga.test" },
							}),
						),
				}),
				execution,
			);
			expect(result.failures).toEqual([]);
			expect(result.entityGroups).toEqual([
				expect.objectContaining({ events: [], ownershipProvider: "komga" }),
				expect.objectContaining({ events: [], ownershipProvider: "komga" }),
			]);
		}),
	);
});

const setup = (
	songs?: ReadonlyArray<{ title: string; videoId: string }>,
	providerSpecifics: Record<string, string> = { timezone: "UTC", authCookie: "cookie" },
) => {
	const claims = new Set<string>();
	const host = defineSandboxTestHost(youtubeMusicManifest, {
		httpCall: httpCall({}),
		log: () => hostSuccess(null),
		span: () => hostSuccess(null),
		getPersistentValue: (key) => hostSuccess(claims.has(key) ? true : null),
		getCurrentIntegration: () =>
			hostSuccess(integrationRecord({ lot: "yank", providerSpecifics, provider: "youtube_music" })),
		claimPersistentValue: (key) => {
			if (claims.has(key)) {
				return hostSuccess({ value: true, claimed: false });
			}
			claims.add(key);
			return hostSuccess({ claimed: true });
		},
	});
	const run = (startedAt: string) =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.parse(startedAt));
			const fs = mediaFilesystem({});
			yield* runYoutubeMusicYank({}, host, { ...execution, startedAt }, () =>
				Effect.succeed(historyClient(songs)),
			);
			const records = yield* fs.records();
			yield* confirmIntegrationSource(
				{
					part: 0,
					final: true,
					runId: "run",
					batchId: startedAt,
					inputFingerprint: startedAt,
					confirmed: records.flatMap(
						({ group }) =>
							group?.events.flatMap((event) =>
								event.operationId && event.attribution
									? [
											{
												reason: null,
												result: "created" as const,
												operationId: event.operationId,
												attribution: event.attribution,
											},
										]
									: [],
							) ?? [],
					),
				},
				host,
			);
			return integrationTestResult(records);
		});
	return { run, claims };
};

describe("YouTube Music yank", () => {
	it("returns a zone-local date and a positive sub-day TTL for a valid timezone", () => {
		const { localDate, ttlSeconds } = dailyProgressWindow(
			"America/New_York",
			"2026-01-01T00:00:00.000Z",
		);
		expect(localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(ttlSeconds).toBeGreaterThan(0);
		expect(ttlSeconds).toBeLessThanOrEqual(86_400);
	});

	it.effect("rejects a stored timezone that is not an IANA zone", () =>
		Effect.gen(function* () {
			const { run } = setup([], { authCookie: "cookie", timezone: "Not/AZone" });
			const error = yield* Effect.flip(run("2026-01-01T00:00:00.000Z"));
			expect(error.message).toContain("timezone must be an IANA time zone");
		}),
	);

	it("accounts for a longer local day when daylight saving time ends", () => {
		const { ttlSeconds } = dailyProgressWindow("America/New_York", "2026-11-01T04:00:00.000Z");
		expect(ttlSeconds).toBe(25 * 60 * 60);
	});

	it("starts the final window ten minutes before local midnight", () => {
		expect(dailyProgressWindow("UTC", "2026-01-01T23:49:59.000Z").isFinalWindow).toBe(false);
		expect(dailyProgressWindow("UTC", "2026-01-01T23:50:00.000Z").isFinalWindow).toBe(true);
	});

	it.effect("emits 35 once, emits 100 once, then skips songs already completed that day", () =>
		Effect.gen(function* () {
			const { run } = setup([
				{ videoId: "v1", title: "First" },
				{ videoId: "v2", title: "Second" },
				{ videoId: "v1", title: "First duplicate" },
			]);
			expect(progressValues(yield* run("2026-01-01T12:00:00.000Z"))).toEqual([35, 35]);
			expect(progressValues(yield* run("2026-01-01T12:05:00.000Z"))).toEqual([100, 100]);
			expect(progressValues(yield* run("2026-01-01T12:10:00.000Z"))).toEqual([]);
		}),
	);

	it.effect("completes a song directly when first found in the final ten minutes", () =>
		Effect.gen(function* () {
			const { run, claims } = setup();
			expect(progressValues(yield* run("2026-01-01T23:50:00.000Z"))).toEqual([100]);
			expect(progressValues(yield* run("2026-01-01T23:55:00.000Z"))).toEqual([]);
			expect([...claims]).toEqual([
				expect.stringMatching(/:v1:2026-01-01:seen$/),
				expect.stringMatching(/:v1:2026-01-01:completed$/),
			]);
		}),
	);
});
