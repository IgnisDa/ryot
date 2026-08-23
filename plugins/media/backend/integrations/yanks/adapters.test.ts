import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import {
	execution,
	hostFailure,
	hostSuccess,
	httpSuccess,
	integrationRecord,
} from "../../../tests/backend/automations/automation-test-utils";
import type { MediaIntegrationAdapterResult } from "../../imports/schemas";
import type { HistoryClient } from "../../lib/vendors/youtube-music";
import audiobookshelfDefinition, {
	manifest as audiobookshelfManifest,
} from "./audiobookshelf.sandbox";
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
type HttpCall = SandboxHost<typeof plexManifest.capabilities>["httpCall"];
type EntityGroup = MediaIntegrationAdapterResult["entityGroups"][number];

const routeKey = (url: string) => {
	const parsed = new URL(url);
	return `${parsed.pathname}${parsed.search}`;
};

const httpCall = (routes: Record<string, Route>): HttpCall =>
	((_method, url) => {
		const response = routes[routeKey(url)];
		return response === failure || response === undefined
			? hostFailure("request failed")
			: httpSuccess(response);
	}) as HttpCall;

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
		Promise.resolve({
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

const progressValues = (result: MediaIntegrationAdapterResult) =>
	result.entityGroups.flatMap((group) =>
		group.events.map((event) => event.properties["progressPercent"]),
	);

const runPlex = (routes: Record<string, Route>, syncOwnership = false) =>
	Effect.runPromise(
		runSandboxTestScript(
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

const runAudiobookshelf = (routes: Record<string, Route>, syncOwnership = false) =>
	Effect.runPromise(
		runSandboxTestScript(
			audiobookshelfDefinition,
			{},
			defineSandboxTestHost(audiobookshelfManifest, {
				httpCall: httpCall(routes),
				getCurrentIntegration: () =>
					hostSuccess(
						integrationRecord({
							syncOwnership,
							provider: "audiobookshelf",
							providerSpecifics: { token: "key", baseUrl: "http://abs.test" },
						}),
					),
			}),
			execution,
		),
	);

describe("Plex yank", () => {
	it("maps watched movies and per-episode show coverage by guid", async () => {
		const result = await runPlex({
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
		});
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
	});

	it("records a failure for a watched item without a provider id", async () => {
		const result = await runPlex({
			"/library/sections": libraries([{ key: "1", type: "movie", title: "Movies" }]),
			"/library/sections/1/all?includeGuids=1": metadata([
				{ key: "/m/9", type: "movie", title: "No Ids", lastViewedAt: 1_700_000_000 },
			]),
		});
		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toMatchObject({
			itemIndex: 0,
			sourceLabel: "No Ids",
			stage: "input_transformation",
			message: "Plex item has no TMDB, TVDB, or IMDb identifier",
		});
	});

	it("returns owned movies and shows regardless of watch state", async () => {
		const result = await runPlex(
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
		);
		const owned = result.entityGroups.filter(
			(group: EntityGroup) => group.ownershipProvider === "plex_yank",
		);
		expect(owned).toHaveLength(2);
		expect(owned.map((group: EntityGroup) => group.entityRef)).toMatchObject([
			{ externalId: "329865", entitySchemaSlug: "movie" },
			{ externalId: "95396", entitySchemaSlug: "show" },
		]);
	});

	it("omits owned items without a provider id", async () => {
		const result = await runPlex(
			{
				"/library/sections": libraries([{ key: "1", type: "movie", title: "Movies" }]),
				"/library/sections/1/all?includeGuids=1": metadata([
					{ key: "/m/1", type: "movie", title: "With Id", Guid: [{ id: "tmdb://1" }] },
					{ key: "/m/2", type: "movie", title: "No Id" },
				]),
			},
			true,
		);
		expect(
			result.entityGroups.filter((group: EntityGroup) => group.ownershipProvider),
		).toHaveLength(1);
	});

	it("skips a section whose item fetch fails and keeps the rest", async () => {
		const result = await runPlex(
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
		);
		expect(
			result.entityGroups.filter((group: EntityGroup) => group.ownershipProvider),
		).toHaveLength(1);
		expect(result.failures[0]).toMatchObject({ stage: "source_fetch" });
	});

	it("falls back to an unresolved IMDb ref", async () => {
		const result = await runPlex({
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
		});
		expect(result.entityGroups[0]?.entityRef).toEqual({
			kind: "unresolved",
			sourceLabel: "Primer",
			identifierType: "imdb",
			entitySchemaSlug: "movie",
			identifierValue: "tt0390384",
		});
	});

	it("isolates a show episode request failure and continues later rows", async () => {
		const result = await runPlex({
			"/library/metadata/1/allLeaves": failure,
			"/library/sections": libraries([{ key: "1", type: "show", title: "Shows" }]),
			"/library/metadata/2/allLeaves": metadata([
				{ index: 1, key: "/e/2", parentIndex: 1, title: "Episode", lastViewedAt: 1_700_000_100 },
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
		});
		expect(result.failures[0]).toMatchObject({
			itemIndex: 0,
			stage: "source_fetch",
			message: "Failed to fetch watched episodes from Plex",
		});
		expect(result.entityGroups[0]?.entityRef).toMatchObject({ externalId: "2" });
	});
});

describe("Audiobookshelf yank", () => {
	const libraryResponse = { libraries: [{ id: "lib1", mediaType: "book", name: "Audiobooks" }] };
	const itemRoutes = (items: JsonValue[]) => ({
		"/api/libraries": libraryResponse,
		"/api/libraries/lib1/items?expanded=1&filter=progress.ZmluaXNoZWQ=": { results: items },
	});

	it("maps Audible audiobooks and ISBN ebooks into library collections", async () => {
		const result = await runAudiobookshelf(
			itemRoutes([
				{
					id: "a1",
					media: {
						ebookFormat: null,
						metadata: { asin: "B08G9PRS1K", title: "Project Hail Mary" },
					},
				},
				{
					id: "b1",
					media: { ebookFormat: "epub", metadata: { title: "Dune", isbn: "9780441013593" } },
				},
			]),
		);
		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toHaveLength(2);
		expect(result.entityGroups[0]).toMatchObject({
			events: [{ eventSchemaSlug: "complete" }],
			collectionMemberships: [{ collectionName: "Audiobooks" }],
			entityRef: { externalId: "B08G9PRS1K", providerSlug: "audiobook.audible" },
		});
		expect(result.entityGroups[1]).toMatchObject({
			collectionMemberships: [{ collectionName: "Audiobooks" }],
			entityRef: { kind: "unresolved", identifierType: "isbn", identifierValue: "9780441013593" },
		});
	});

	it("records a failure for an item missing media metadata", async () => {
		const result = await runAudiobookshelf(itemRoutes([{ id: "x1", name: "Broken" }]));
		expect(result.entityGroups).toEqual([]);
		expect(result.failures[0]).toMatchObject({
			itemIndex: 0,
			sourceIdentifier: "x1",
			stage: "input_transformation",
			message: "Audiobookshelf item is missing media metadata",
		});
	});

	it("rejects an ebook with an invalid ISBN", async () => {
		const result = await runAudiobookshelf(
			itemRoutes([
				{
					id: "bad-isbn",
					media: { ebookFormat: "epub", metadata: { title: "Invalid", isbn: "9780441013594" } },
				},
			]),
		);
		expect(result.entityGroups).toEqual([]);
		expect(result.failures[0]).toMatchObject({
			itemIndex: 0,
			sourceIdentifier: "bad-isbn",
			stage: "input_transformation",
			message: "Audiobookshelf ebook is missing a valid ISBN",
		});
	});

	it("returns owned audiobooks and ebooks regardless of finished state", async () => {
		const items: JsonValue[] = [
			{
				id: "a1",
				media: { ebookFormat: null, metadata: { asin: "B08G9PRS1K", title: "Project Hail Mary" } },
			},
			{
				id: "b1",
				media: { ebookFormat: "epub", metadata: { title: "Dune", isbn: "9780441013593" } },
			},
		];
		const result = await runAudiobookshelf(
			{ ...itemRoutes(items), "/api/libraries/lib1/items?expanded=1": { results: items } },
			true,
		);
		const owned = result.entityGroups.filter(
			(group: EntityGroup) => group.ownershipProvider === "audiobookshelf",
		);
		expect(owned).toHaveLength(2);
		expect(owned.map((group: EntityGroup) => group.entityRef)).toMatchObject([
			{ externalId: "B08G9PRS1K", entitySchemaSlug: "audiobook" },
			{ entitySchemaSlug: "book", identifierValue: "9780441013593" },
		]);
	});

	it("omits owned items without a usable identifier", async () => {
		const items: JsonValue[] = [
			{ id: "a1", media: { ebookFormat: null, metadata: { asin: "B01", title: "Has Asin" } } },
			{ id: "x1", media: { ebookFormat: null, metadata: { title: "No Ids" } } },
		];
		const result = await runAudiobookshelf(
			{ ...itemRoutes(items), "/api/libraries/lib1/items?expanded=1": { results: items } },
			true,
		);
		expect(
			result.entityGroups.filter((group: EntityGroup) => group.ownershipProvider),
		).toHaveLength(1);
	});

	it("skips a library whose item fetch fails and keeps the rest", async () => {
		const item = {
			id: "a1",
			media: { ebookFormat: null, metadata: { asin: "B01", title: "Owned" } },
		};
		const result = await runAudiobookshelf(
			{
				"/api/libraries/lib2/items?expanded=1": failure,
				"/api/libraries/lib1/items?expanded=1": { results: [item] },
				"/api/libraries/lib2/items?expanded=1&filter=progress.ZmluaXNoZWQ=": failure,
				"/api/libraries/lib1/items?expanded=1&filter=progress.ZmluaXNoZWQ=": { results: [item] },
				"/api/libraries": {
					libraries: [
						{ name: "A", id: "lib1", mediaType: "book" },
						{ name: "B", id: "lib2", mediaType: "book" },
					],
				},
			},
			true,
		);
		expect(
			result.entityGroups.filter((group: EntityGroup) => group.ownershipProvider),
		).toHaveLength(1);
		expect(result.failures).toContainEqual(
			expect.objectContaining({ stage: "source_fetch", sourceIdentifier: "lib2" }),
		);
	});

	it("isolates podcast episode request failures and imports later episodes", async () => {
		const result = await runAudiobookshelf({
			"/api/items/pod1?expanded=1&include=progress&episode=bad": failure,
			"/api/libraries": { libraries: [{ id: "podcasts", name: "Podcasts", mediaType: "podcast" }] },
			"/api/items/pod1?expanded=1&include=progress&episode=good": {
				userMediaProgress: { isFinished: true },
			},
			"/api/items/pod1?expanded=1&include=progress": {
				media: {
					episodes: [
						{ id: "bad", episodeNumber: 1 },
						{ id: "good", episodeNumber: 2 },
					],
				},
			},
			"/api/libraries/podcasts/items?expanded=1": {
				results: [
					{
						id: "pod1",
						media: { ebookFormat: null, metadata: { itunesId: "42", title: "Podcast" } },
					},
				],
			},
		});
		expect(result.failures[0]).toMatchObject({
			stage: "source_fetch",
			message: "Failed to fetch Audiobookshelf podcast episode progress",
		});
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "42", providerSlug: "podcast.itunes" },
			events: [{ unresolvedEpisode: { type: "podcast", episodeNumber: 2 } }],
		});
	});
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
				[{ label: "MangaUpdates", url: "https://www.mangaupdates.com/series/abc123/berserk" }],
				"Berserk",
			),
		).toMatchObject({ externalId: "abc123", providerSlug: "manga.manga-updates" });
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

	it("accepts null and unread progress while preserving ownership", async () => {
		const book = {
			id: "book1",
			readProgress: null,
			media: { pagesCount: 100 },
			metadata: {
				title: "Berserk",
				links: [{ label: "AniList", url: "https://anilist.co/manga/30002" }],
			},
		};
		const result = await Effect.runPromise(
			runSandboxTestScript(
				komgaDefinition,
				{},
				defineSandboxTestHost(komgaManifest, {
					getCurrentIntegration: () =>
						hostSuccess(
							integrationRecord({
								provider: "komga",
								syncOwnership: true,
								providerSpecifics: { apiKey: "key", baseUrl: "http://komga.test" },
							}),
						),
					httpCall: httpCall({
						"/api/v1/books?page=0&size=500": { totalPages: 1, content: [book] },
						"/api/v1/books?page=0&size=500&read_status=IN_PROGRESS": {
							totalPages: 1,
							content: [book, { ...book, id: "unread", readProgress: { page: 0 } }],
						},
					}),
				}),
				execution,
			),
		);
		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toEqual([
			expect.objectContaining({ events: [], ownershipProvider: "komga" }),
		]);
	});
});

describe("YouTube Music yank", () => {
	const setup = (songs?: ReadonlyArray<{ title: string; videoId: string }>) => {
		const claims = new Set<string>();
		const host = defineSandboxTestHost(youtubeMusicManifest, {
			httpCall: httpCall({}),
			claimPersistentValue: (key) => {
				if (claims.has(key)) {
					return hostSuccess({ value: true, claimed: false });
				}
				claims.add(key);
				return hostSuccess({ claimed: true });
			},
			getCurrentIntegration: () =>
				hostSuccess(
					integrationRecord({
						lot: "yank",
						provider: "youtube_music",
						providerSpecifics: { timezone: "UTC", authCookie: "cookie" },
					}),
				),
		});
		const run = (startedAt: string) =>
			Effect.runPromise(
				runYoutubeMusicYank({}, host, { ...execution, startedAt }, () =>
					Effect.succeed(historyClient(songs)),
				),
			);
		return { run, claims };
	};

	it("returns a zone-local date and a positive sub-day TTL for a valid timezone", () => {
		const { localDate, ttlSeconds } = dailyProgressWindow(
			"America/New_York",
			"2026-01-01T00:00:00.000Z",
		);
		expect(localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(ttlSeconds).toBeGreaterThan(0);
		expect(ttlSeconds).toBeLessThanOrEqual(86_400);
	});

	it("falls back to a full-day TTL for an unknown timezone", () => {
		const { localDate, ttlSeconds, isFinalWindow } = dailyProgressWindow(
			"Not/AZone",
			"2026-01-01T00:00:00.000Z",
		);
		expect(isFinalWindow).toBe(false);
		expect(localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(ttlSeconds).toBe(86_400);
	});

	it("accounts for a longer local day when daylight saving time ends", () => {
		const { ttlSeconds } = dailyProgressWindow("America/New_York", "2026-11-01T04:00:00.000Z");
		expect(ttlSeconds).toBe(25 * 60 * 60);
	});

	it("starts the final window ten minutes before local midnight", () => {
		expect(dailyProgressWindow("UTC", "2026-01-01T23:49:59.000Z").isFinalWindow).toBe(false);
		expect(dailyProgressWindow("UTC", "2026-01-01T23:50:00.000Z").isFinalWindow).toBe(true);
	});

	it("emits 35 once, emits 100 once, then skips songs already completed that day", async () => {
		const { run } = setup([
			{ videoId: "v1", title: "First" },
			{ videoId: "v2", title: "Second" },
			{ videoId: "v1", title: "First duplicate" },
		]);
		expect(progressValues(await run("2026-01-01T12:00:00.000Z"))).toEqual([35, 35]);
		expect(progressValues(await run("2026-01-01T12:05:00.000Z"))).toEqual([100, 100]);
		expect(progressValues(await run("2026-01-01T12:10:00.000Z"))).toEqual([]);
	});

	it("completes a song directly when first found in the final ten minutes", async () => {
		const { run, claims } = setup();
		expect(progressValues(await run("2026-01-01T23:50:00.000Z"))).toEqual([100]);
		expect(progressValues(await run("2026-01-01T23:55:00.000Z"))).toEqual([]);
		expect([...claims]).toEqual([expect.stringMatching(/:v1:2026-01-01:completed$/)]);
	});
});
