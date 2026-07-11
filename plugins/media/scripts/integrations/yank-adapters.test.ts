import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";
import { describe, expect, it } from "vitest";

import type { MediaIntegrationAdapterResult } from "../../imports/schemas";
import {
	execution,
	hostFailure,
	hostSuccess,
	httpSuccess,
	integrationRecord,
} from "../automations/automation-test-utils";
import audiobookshelfDefinition, {
	manifest as audiobookshelfManifest,
} from "./yanks/audiobookshelf.sandbox";
import komgaDefinition, { extractMangaRef, manifest as komgaManifest } from "./yanks/komga.sandbox";
import plexDefinition, { manifest as plexManifest } from "./yanks/plex.sandbox";
import { deduplicateWindow } from "./yanks/youtube-music.sandbox";

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

const runPlex = (routes: Record<string, Route>, syncOwnership = false) =>
	Effect.runPromise(
		runSandboxTestScript(
			plexDefinition,
			{},
			defineSandboxTestHost(plexManifest, {
				httpCall: httpCall(routes),
				getIntegration: () =>
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
				getIntegration: () =>
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
					title: "Severance",
					ratingKey: "555",
					lastViewedAt: 1_700_000_000,
					Guid: [{ id: "tmdb://95396" }],
				},
			]),
			"/library/metadata/555/allLeaves": metadata([
				{
					index: 3,
					key: "/e/1",
					title: "Ep1",
					parentIndex: 1,
					lastViewedAt: 1_700_000_100,
				},
			]),
		});
		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toHaveLength(2);
		expect(result.entityGroups[0]).toMatchObject({
			events: [{ eventSchemaSlug: "complete" }],
			entityRef: { externalId: "329865", providerSlug: "movie.tmdb", entitySchemaSlug: "movie" },
		});
		expect(result.entityGroups[1]).toMatchObject({
			entityRef: { externalId: "95396", providerSlug: "show.tmdb", entitySchemaSlug: "show" },
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
				"/library/sections": libraries([
					{ key: "1", type: "movie", title: "Movies" },
					{ key: "2", type: "show", title: "Shows" },
				]),
				"/library/sections/1/all?includeGuids=1": metadata([
					{ key: "/m/1", type: "movie", title: "Arrival", Guid: [{ id: "tmdb://329865" }] },
				]),
				"/library/sections/2/all?includeGuids=1": failure,
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
			identifierValue: "tt0390384",
			entitySchemaSlug: "movie",
		});
	});

	it("isolates a show episode request failure and continues later rows", async () => {
		const result = await runPlex({
			"/library/sections": libraries([{ key: "1", type: "show", title: "Shows" }]),
			"/library/sections/1/all?includeGuids=1": metadata([
				{
					key: "/s/1",
					type: "show",
					title: "Broken",
					ratingKey: "1",
					lastViewedAt: 1_700_000_000,
					Guid: [{ id: "tmdb://1" }],
				},
				{
					key: "/s/2",
					type: "show",
					title: "Working",
					ratingKey: "2",
					lastViewedAt: 1_700_000_000,
					Guid: [{ id: "tmdb://2" }],
				},
			]),
			"/library/metadata/1/allLeaves": failure,
			"/library/metadata/2/allLeaves": metadata([
				{ key: "/e/2", title: "Episode", index: 1, parentIndex: 1, lastViewedAt: 1_700_000_100 },
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
	const libraryResponse = {
		libraries: [{ id: "lib1", name: "Audiobooks", mediaType: "book" }],
	};
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
						metadata: { title: "Project Hail Mary", asin: "B08G9PRS1K" },
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
				media: { ebookFormat: null, metadata: { title: "Project Hail Mary", asin: "B08G9PRS1K" } },
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
			{ identifierValue: "9780441013593", entitySchemaSlug: "book" },
		]);
	});

	it("omits owned items without a usable identifier", async () => {
		const items: JsonValue[] = [
			{ id: "a1", media: { ebookFormat: null, metadata: { title: "Has Asin", asin: "B01" } } },
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
			media: { ebookFormat: null, metadata: { title: "Owned", asin: "B01" } },
		};
		const result = await runAudiobookshelf(
			{
				"/api/libraries": {
					libraries: [
						{ id: "lib1", name: "A", mediaType: "book" },
						{ id: "lib2", name: "B", mediaType: "book" },
					],
				},
				"/api/libraries/lib1/items?expanded=1&filter=progress.ZmluaXNoZWQ=": { results: [item] },
				"/api/libraries/lib1/items?expanded=1": { results: [item] },
				"/api/libraries/lib2/items?expanded=1&filter=progress.ZmluaXNoZWQ=": failure,
				"/api/libraries/lib2/items?expanded=1": failure,
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
			"/api/libraries": { libraries: [{ id: "podcasts", name: "Podcasts", mediaType: "podcast" }] },
			"/api/libraries/podcasts/items?expanded=1": {
				results: [
					{
						id: "pod1",
						media: { ebookFormat: null, metadata: { title: "Podcast", itunesId: "42" } },
					},
				],
			},
			"/api/items/pod1?expanded=1&include=progress": {
				media: {
					episodes: [
						{ id: "bad", episodeNumber: 1 },
						{ id: "good", episodeNumber: 2 },
					],
				},
			},
			"/api/items/pod1?expanded=1&include=progress&episode=bad": failure,
			"/api/items/pod1?expanded=1&include=progress&episode=good": {
				userMediaProgress: { isFinished: true },
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
		).toMatchObject({ providerSlug: "manga.myanimelist", externalId: "2" });
	});

	it("maps a MangaUpdates link to manga.manga-updates", () => {
		expect(
			extractMangaRef(
				[{ label: "MangaUpdates", url: "https://www.mangaupdates.com/series/abc123/berserk" }],
				"Berserk",
			),
		).toMatchObject({ providerSlug: "manga.manga-updates", externalId: "abc123" });
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
					httpCall: httpCall({
						"/api/v1/books?page=0&size=500&read_status=IN_PROGRESS": {
							totalPages: 1,
							content: [book, { ...book, id: "unread", readProgress: { page: 0 } }],
						},
						"/api/v1/books?page=0&size=500": { totalPages: 1, content: [book] },
					}),
					getIntegration: () =>
						hostSuccess(
							integrationRecord({
								syncOwnership: true,
								provider: "komga",
								providerSpecifics: { apiKey: "key", baseUrl: "http://komga.test" },
							}),
						),
				}),
				execution,
			),
		);
		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toEqual([
			expect.objectContaining({ ownershipProvider: "komga", events: [] }),
		]);
	});
});

describe("YouTube Music yank", () => {
	it("returns a zone-local date and a positive sub-day TTL for a valid timezone", () => {
		const { localDate, ttlSeconds } = deduplicateWindow("America/New_York");
		expect(localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(ttlSeconds).toBeGreaterThan(0);
		expect(ttlSeconds).toBeLessThanOrEqual(86_400);
	});

	it("falls back to a full-day TTL for an unknown timezone", () => {
		const { localDate, ttlSeconds } = deduplicateWindow("Not/AZone");
		expect(localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(ttlSeconds).toBe(86_400);
	});
});
