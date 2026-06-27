import { Effect } from "@ryot/sandbox-sdk/effect";
import { describe, expect, it } from "vitest";

import { adaptAudiobookshelfData } from "./audiobookshelf";
import { adaptJellyfinData } from "./jellyfin";
import { adaptMediaTrackerData } from "./media-tracker";
import { adaptPlexData } from "./plex";
import { stubHttpHost, type StubResponse } from "./source-test-utils";
import { adaptTraktData } from "./trakt";

const run = Effect.runPromise;
const metadata = (Metadata: unknown[]) => ({ MediaContainer: { Metadata } });

describe("credentialed media import adapters", () => {
	it("maps watched Trakt movies and episodes from paged history", async () => {
		const host = stubHttpHost(({ method, path }) =>
			method === "HEAD"
				? { headers: { "x-pagination-page-count": "1" } }
				: {
						body:
							path === "/users/alice/history"
								? [
										{
											id: 1,
											type: "movie",
											watched_at: "2026-01-01T00:00:00.000Z",
											movie: { ids: { tmdb: 603 }, title: "The Matrix" },
										},
										{
											id: 2,
											type: "episode",
											watched_at: "2026-01-02T00:00:00.000Z",
											episode: { ids: {}, season: 1, number: 2 },
											show: { ids: { tmdb: 1399 }, title: "Game of Thrones" },
										},
									]
								: [],
					},
		);
		const result = await run(adaptTraktData("alice", "client-id", host));
		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toHaveLength(2);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { kind: "resolved", externalId: "603", providerSlug: "movie.tmdb" },
			events: [{ eventSchemaSlug: "complete" }],
		});
		expect(result.entityGroups[1]).toMatchObject({
			entityRef: { kind: "resolved", externalId: "1399", providerSlug: "show.tmdb" },
			events: [
				{
					eventSchemaSlug: "progress",
					episodeLocator: { type: "show", seasonNumber: 1, episodeNumber: 2 },
				},
			],
		});
	});

	it("records the native Trakt missing-id failure", async () => {
		const host = stubHttpHost(({ method, path }) =>
			method === "HEAD"
				? { headers: { "x-pagination-page-count": "1" } }
				: {
						body:
							path === "/users/alice/history"
								? [
										{
											id: 1,
											type: "movie",
											watched_at: "2026-01-01T00:00:00.000Z",
											movie: { ids: { trakt: 77 }, title: "Mystery" },
										},
									]
								: [],
					},
		);
		const result = await run(adaptTraktData("alice", "client-id", host));
		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toMatchObject({
			sourceLabel: "Mystery",
			sourceIdentifier: "77",
			message: "Movie does not have a TMDB or IMDb id",
		});
	});

	it("maps Jellyfin played movies and episodes via series details", async () => {
		const routes: Record<string, StubResponse> = {
			"/Users/AuthenticateByName": { body: { AccessToken: "tok", User: { Id: "u1" } } },
			"/Users/u1/Items": {
				body: {
					Items: [
						{
							Id: "m1",
							Type: "Movie",
							Name: "Dune",
							ProviderIds: { Tmdb: "693134" },
							UserData: { IsFavorite: true, LastPlayedDate: "2026-01-02T10:00:00.000Z" },
						},
						{
							Id: "e1",
							SeriesId: "s1",
							IndexNumber: 4,
							Type: "Episode",
							Name: "Episode",
							ParentIndexNumber: 2,
							SeriesName: "Severance",
							UserData: { LastPlayedDate: "2026-01-03T10:00:00.000Z" },
						},
					],
				},
			},
			"/Items/s1": { body: { Id: "s1", Name: "Severance", ProviderIds: { Tmdb: "95396" } } },
		};
		const result = await run(
			adaptJellyfinData(
				{ apiUrl: "http://jellyfin.test", username: "alice", password: "secret" },
				stubHttpHost(({ path }) => routes[path] ?? {}),
			),
		);
		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toHaveLength(2);
		expect(result.entityGroups[0]).toMatchObject({
			events: [{ eventSchemaSlug: "complete" }],
			collectionMemberships: [{ collectionName: "Favorites" }],
			entityRef: { externalId: "693134", entitySchemaSlug: "movie" },
		});
		expect(result.entityGroups[1]).toMatchObject({
			entityRef: { externalId: "95396", entitySchemaSlug: "show" },
			events: [
				{
					eventSchemaSlug: "progress",
					episodeLocator: { type: "show", seasonNumber: 2, episodeNumber: 4 },
				},
			],
		});
	});

	it("records a Jellyfin failure for an item without a played timestamp", async () => {
		const routes: Record<string, StubResponse> = {
			"/Users/AuthenticateByName": { body: { AccessToken: "tok", User: { Id: "u1" } } },
			"/Users/u1/Items": {
				body: {
					Items: [{ Id: "m9", Type: "Movie", Name: "Unwatched", ProviderIds: { Tmdb: "1" } }],
				},
			},
		};
		const result = await run(
			adaptJellyfinData(
				{ apiUrl: "http://jellyfin.test", username: "alice" },
				stubHttpHost(({ path }) => routes[path] ?? {}),
			),
		);
		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toMatchObject({
			itemIndex: 0,
			sourceIdentifier: "m9",
			sourceLabel: "Unwatched",
			stage: "input_transformation",
			message: "Jellyfin item has no played timestamp",
		});
	});

	it("maps Plex watched movies and per-episode show coverage by guid", async () => {
		const routes: Record<string, StubResponse> = {
			"/library/sections": {
				body: {
					MediaContainer: {
						Directory: [
							{ key: "1", type: "movie", title: "Movies" },
							{ key: "2", type: "show", title: "Shows" },
						],
					},
				},
			},
			"/library/sections/1/all": {
				body: metadata([
					{
						key: "/m/1",
						type: "movie",
						title: "Arrival",
						lastViewedAt: 1700000000,
						Guid: [{ id: "tmdb://329865" }],
					},
				]),
			},
			"/library/sections/2/all": {
				body: metadata([
					{
						type: "show",
						key: "/s/1",
						ratingKey: "555",
						title: "Severance",
						lastViewedAt: 1700000000,
						Guid: [{ id: "tmdb://95396" }],
					},
				]),
			},
			"/library/metadata/555/allLeaves": {
				body: metadata([
					{
						index: 3,
						key: "/e/1",
						title: "Ep1",
						parentIndex: 1,
						type: "episode",
						lastViewedAt: 1700000100,
					},
				]),
			},
		};
		const result = await run(
			adaptPlexData(
				{ apiKey: "token", apiUrl: "http://plex.test:32400" },
				stubHttpHost(({ path }) => routes[path] ?? {}),
			),
		);
		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toHaveLength(2);
		expect(result.entityGroups[0]).toMatchObject({
			events: [{ eventSchemaSlug: "complete" }],
			entityRef: { externalId: "329865", providerSlug: "movie.tmdb" },
		});
		expect(result.entityGroups[1]).toMatchObject({
			events: [
				{
					eventSchemaSlug: "progress",
					episodeLocator: { type: "show", seasonNumber: 1, episodeNumber: 3 },
				},
			],
			entityRef: { externalId: "95396", providerSlug: "show.tmdb" },
		});
	});

	it("records a Plex failure for a watched item without a provider id", async () => {
		const routes: Record<string, StubResponse> = {
			"/library/sections": {
				body: { MediaContainer: { Directory: [{ key: "1", type: "movie", title: "Movies" }] } },
			},
			"/library/sections/1/all": {
				body: {
					MediaContainer: {
						Metadata: [{ type: "movie", key: "/m/9", title: "No Ids", lastViewedAt: 1700000000 }],
					},
				},
			},
		};
		const result = await run(
			adaptPlexData(
				{ apiKey: "token", apiUrl: "http://plex.test:32400" },
				stubHttpHost(({ path }) => routes[path] ?? {}),
			),
		);
		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toMatchObject({
			itemIndex: 0,
			sourceLabel: "No Ids",
			stage: "input_transformation",
			message: "Plex item has no TMDB, TVDB, or IMDb identifier",
		});
	});

	it("maps Audiobookshelf Audible and ISBN items into library collections", async () => {
		const routes: Record<string, StubResponse> = {
			"/api/libraries": {
				body: { libraries: [{ id: "lib1", name: "Audiobooks", mediaType: "book" }] },
			},
			"/api/libraries/lib1/items": {
				body: {
					results: [
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
					],
				},
			},
		};
		const result = await run(
			adaptAudiobookshelfData(
				{ apiKey: "key", apiUrl: "http://abs.test" },
				stubHttpHost(({ path }) => routes[path] ?? {}),
			),
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

	it("records an Audiobookshelf failure for missing media metadata", async () => {
		const routes: Record<string, StubResponse> = {
			"/api/libraries": { body: { libraries: [{ id: "lib1", name: "Books", mediaType: "book" }] } },
			"/api/libraries/lib1/items": { body: { results: [{ id: "x1", name: "Broken" }] } },
		};
		const result = await run(
			adaptAudiobookshelfData(
				{ apiKey: "key", apiUrl: "http://abs.test" },
				stubHttpHost(({ path }) => routes[path] ?? {}),
			),
		);
		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toMatchObject({
			itemIndex: 0,
			sourceIdentifier: "x1",
			stage: "input_transformation",
			message: "Audiobookshelf item is missing media metadata",
		});
	});

	it("maps MediaTracker seen movies and games to resolved provider refs", async () => {
		const routes: Record<string, StubResponse> = {
			"/api/user": { body: { id: 1 } },
			"/api/lists": { body: [] },
			"/api/items": {
				body: [
					{ id: 10, mediaType: "movie" },
					{ id: 11, mediaType: "video_game" },
				],
			},
			"/api/details/10": {
				body: {
					id: 10,
					tmdbId: 27205,
					title: "Inception",
					seenHistory: [{ id: 1, date: "2026-01-05T00:00:00.000Z" }],
				},
			},
			"/api/details/11": {
				body: {
					id: 11,
					igdbId: 7346,
					title: "Hades",
					seenHistory: [{ id: 2, date: "2026-02-01T00:00:00.000Z" }],
				},
			},
		};
		const result = await run(
			adaptMediaTrackerData(
				{ apiKey: "key", apiUrl: "http://mt.test" },
				stubHttpHost(({ path }) => routes[path] ?? { body: [] }),
			),
		);
		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toHaveLength(2);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "27205", providerSlug: "movie.tmdb" },
			events: [{ eventSchemaSlug: "complete" }],
		});
		expect(result.entityGroups[1]).toMatchObject({
			entityRef: { externalId: "7346", providerSlug: "video-game.igdb" },
			events: [{ eventSchemaSlug: "complete" }],
		});
	});

	it("records a MediaTracker failure for a missing supported provider id", async () => {
		const routes: Record<string, StubResponse> = {
			"/api/user": { body: { id: 1 } },
			"/api/lists": { body: [] },
			"/api/items": { body: [{ id: 20, mediaType: "movie" }] },
			"/api/details/20": { body: { id: 20, title: "No Tmdb" } },
		};
		const result = await run(
			adaptMediaTrackerData(
				{ apiKey: "key", apiUrl: "http://mt.test" },
				stubHttpHost(({ path }) => routes[path] ?? { body: [] }),
			),
		);
		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toMatchObject({
			itemIndex: 0,
			sourceLabel: "No Tmdb",
			sourceIdentifier: "20",
			stage: "input_transformation",
			message: "MediaTracker movie item is missing a supported provider identifier",
		});
	});
});
