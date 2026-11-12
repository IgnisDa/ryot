import { expect } from "bun:test";

import { configureApprovedDependencyRuntime } from "@ryot-app/plugin-backend-sdk/dependency-runtime";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import type { YoutubeiHost } from "@ryot-app/plugin-backend-sdk/youtubei";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import {
	albumResponse,
	artistDiscographyContinuationResponse,
	artistDiscographyResponse,
	artistInventoryResponse,
	artistResponse,
	artistSinglesResponse,
	artistSongsContinuationResponse,
	artistSongsResponse,
	artistVideosContinuationResponse,
	artistVideosResponse,
	queueResponse,
	searchResponse,
} from "../../../tests/backend/youtube-music-fixtures";
import {
	buildAlbumDetails,
	buildAlbumRelated,
	buildAlbumSearch,
	buildAlbumTranslate,
} from "../../providers/music-group/youtube-music/shared";
import {
	buildTrackDetails,
	buildTrackSearch,
	buildTrackTranslate,
} from "../../providers/music/youtube-music/shared";
import {
	buildArtistDetails,
	buildArtistRelated,
	buildArtistSearch,
	buildArtistTranslate,
} from "../../providers/person/youtube-music/shared";
import { createYoutubeMusicClient } from "./youtube-music";

configureApprovedDependencyRuntime((operation) => operation());

const recordedClient = (path: string, responses: readonly unknown[], language = "en") => {
	const requests: { path: string; body: unknown; method: string }[] = [];
	const host: YoutubeiHost = {
		httpCall: (method, url, options) =>
			Effect.gen(function* () {
				const request = {
					method,
					path: new URL(url).pathname,
					body: yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(
						options?.body ?? "{}",
					).pipe(Effect.orDie),
				};
				const response = responses[requests.length];
				requests.push(request);
				if (request.path !== `/youtubei/v1/${path}` || response === undefined) {
					return yield* Effect.die(`Unexpected YouTube Music request: ${request.path}`);
				}
				if (response instanceof Error) {
					return yield* Effect.fail({ message: response.message });
				}
				return {
					status: 200,
					headers: { "content-type": "application/json" },
					body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(response).pipe(
						Effect.orDie,
					),
				};
			}),
	};
	return createYoutubeMusicClient(host, language).pipe(
		Effect.map((client) => ({ client, requests })),
	);
};

const continuedSearchResponse = (kind: "song" | "album" | "artist") => {
	const response = searchResponse(kind);
	return {
		contents: {
			tabbedSearchResultsRenderer: {
				tabs: response.contents.tabbedSearchResultsRenderer.tabs.map(({ tabRenderer }) => ({
					tabRenderer: {
						...tabRenderer,
						content: {
							sectionListRenderer: {
								contents: tabRenderer.content.sectionListRenderer.contents.map(
									({ musicShelfRenderer }) => ({
										musicShelfRenderer: {
											...musicShelfRenderer,
											continuations: [{ nextContinuationData: { continuation: "search-2" } }],
										},
									}),
								),
							},
						},
					},
				})),
			},
		},
	};
};

const albumWithPlaylist = (endpoint: "url" | "menu", songCount?: string) => {
	const album = albumResponse("Album");
	return {
		...album,
		...(endpoint === "url"
			? {
					microformat: {
						microformatDataRenderer: {
							thumbnail: { thumbnails: [] },
							urlCanonical: "https://music.youtube.com/playlist?list=album-playlist",
						},
					},
				}
			: {}),
		contents: {
			sectionListRenderer: {
				contents: album.contents.sectionListRenderer.contents.map((section) =>
					"musicDetailHeaderRenderer" in section
						? {
								musicDetailHeaderRenderer: {
									...section.musicDetailHeaderRenderer,
									...(songCount ? { secondSubtitle: { runs: [{ text: songCount }] } } : {}),
									...(endpoint === "menu"
										? {
												menu: {
													menuRenderer: {
														topLevelButtons: [
															{
																buttonRenderer: {
																	navigationEndpoint: {
																		watchPlaylistEndpoint: { playlistId: "album-playlist" },
																	},
																},
															},
														],
													},
												},
											}
										: {}),
								},
							}
						: section,
				),
			},
		},
	};
};

const albumTrackContinuation = (ids: readonly string[], continuation?: string) => ({
	continuationContents: {
		musicPlaylistShelfContinuation: {
			contents: ids.map((id) => ({
				musicResponsiveListItemRenderer: {
					playlistItemData: { videoId: id },
					flexColumns: [
						{
							musicResponsiveListItemFlexColumnRenderer: {
								text: {
									runs: [
										{
											text: id,
											navigationEndpoint: {
												watchEndpoint: {
													videoId: id,
													watchEndpointMusicSupportedConfigs: {
														watchEndpointMusicConfig: { musicVideoType: "MUSIC_VIDEO_TYPE_ATV" },
													},
												},
											},
										},
									],
								},
							},
						},
						{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "3:21" }] } } },
					],
				},
			})),
			...(continuation ? { continuations: [{ nextContinuationData: { continuation } }] } : {}),
		},
	},
});

it.live.each(["menu", "url"] as const)(
	"enumerates three album playlist pages from the %s endpoint with stable global order",
	(endpoint) =>
		Effect.gen(function* () {
			const expectedTotal = endpoint === "url" ? 4 : null;
			const first = artistSongsResponse("token");
			const second = albumTrackContinuation(["second", "third", "third"], "page-3");
			const third = albumTrackContinuation(["track", "fourth"]);
			const { client, requests } = yield* recordedClient("browse", [
				albumWithPlaylist(endpoint, expectedTotal === null ? undefined : "4 songs"),
				first,
				first,
				second,
				first,
				second,
				third,
			]);
			const details = yield* buildAlbumDetails(client, "MPRalbum");
			expect(details.properties).toEqual({
				parts: expectedTotal,
				description: "Album description",
				sourceUrl: "https://music.youtube.com/playlist?list=album-playlist",
				images: [{ type: "remote", purpose: "cover", url: "https://example.com/cover.jpg" }],
			});
			expect(details.relatedEntityGroups[0]?.coverage).toEqual({
				status: "more",
				continuation: {
					offset: 2,
					expectedTotal,
					token: "page-2",
					previousToken: null,
					playlistId: "album-playlist",
				},
			});
			expect(
				details.relatedEntityGroups[0]?.entities.map(({ externalId, relationshipProperties }) => ({
					externalId,
					relationshipProperties,
				})),
			).toEqual([
				{ externalId: "track", relationshipProperties: { order: 1 } },
				{ externalId: "second", relationshipProperties: { order: 2 } },
			]);
			expect(requests).toHaveLength(2);
			const base = {
				properties: {},
				externalId: "MPRalbum",
				direction: "outgoing" as const,
				entitySchemaSlug: "music-group",
				relationshipSchemaSlug: "music-group-to-music",
			};
			const pageTwo = yield* buildAlbumRelated(client, {
				...base,
				continuation: {
					offset: 2,
					expectedTotal,
					token: "page-2",
					previousToken: null,
					playlistId: "album-playlist",
				},
			});
			expect(pageTwo).toEqual({
				entities: [
					{
						name: "third",
						externalId: "third",
						providerSlug: "music.youtube-music",
						relationshipProperties: { order: 3 },
					},
				],
				coverage: {
					status: "more",
					continuation: {
						offset: 3,
						expectedTotal,
						token: "page-3",
						previousToken: "page-2",
						playlistId: "album-playlist",
					},
				},
			});
			const pageThree = yield* buildAlbumRelated(client, {
				...base,
				continuation: {
					offset: 3,
					expectedTotal,
					token: "page-3",
					previousToken: "page-2",
					playlistId: "album-playlist",
				},
			});
			expect(pageThree).toEqual({
				coverage: { status: "complete" },
				entities: [
					{
						name: "fourth",
						externalId: "fourth",
						providerSlug: "music.youtube-music",
						relationshipProperties: { order: 4 },
					},
				],
			});
			expect(
				new TextEncoder().encode(
					yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(pageTwo.coverage),
				).byteLength,
			).toBeLessThan(4096);
			expect(requests.map(({ body }) => body)).toMatchObject([
				{ browseId: "MPRalbum" },
				{ browseId: "VLalbum-playlist" },
				{ browseId: "VLalbum-playlist" },
				{ continuation: "page-2" },
				{ browseId: "VLalbum-playlist" },
				{ continuation: "page-2" },
				{ continuation: "page-3" },
			]);
		}),
	testTimeout,
);

it.live(
	"keeps a trusted album track total while fetching its complete playlist",
	() =>
		Effect.gen(function* () {
			const { client } = yield* recordedClient("browse", [
				albumWithPlaylist("menu", "2 songs"),
				artistSongsResponse(),
			]);
			const details = yield* buildAlbumDetails(client, "MPRalbum");
			expect(details.properties.parts).toBe(2);
			expect(details.relatedEntityGroups[0]?.coverage).toEqual({ status: "complete" });
		}),
	testTimeout,
);

it.live.each([{}, new Error("Album continuation unavailable")])(
	"fails a malformed or failed album continuation without publishing a partial page",
	(response) =>
		Effect.gen(function* () {
			const first = artistSongsResponse("token");
			const { client, requests } = yield* recordedClient("browse", [
				albumWithPlaylist("menu"),
				first,
				first,
				response,
			]);
			const details = yield* buildAlbumDetails(client, "MPRalbum");
			expect(details.relatedEntityGroups[0]?.coverage.status).toBe("more");
			const error = yield* Effect.flip(
				buildAlbumRelated(client, {
					properties: {},
					direction: "outgoing",
					externalId: "MPRalbum",
					entitySchemaSlug: "music-group",
					relationshipSchemaSlug: "music-group-to-music",
					continuation: {
						offset: 2,
						token: "page-2",
						expectedTotal: null,
						previousToken: null,
						playlistId: "album-playlist",
					},
				}),
			);
			expect(error.message).toContain(response instanceof Error ? "500" : "missing its tracks");
			expect(requests).toHaveLength(4);
		}),
	testTimeout,
);

it.live.each([
	{ ids: [], continuation: undefined },
	{ continuation: "page-3", ids: ["third", "fourth"] },
])(
	"rejects an album track total mismatch: %s",
	({ ids, continuation }) =>
		Effect.gen(function* () {
			const first = artistSongsResponse("token");
			const { client } = yield* recordedClient("browse", [
				albumWithPlaylist("menu", "3 songs"),
				first,
				first,
				albumTrackContinuation(ids, continuation),
			]);
			const details = yield* buildAlbumDetails(client, "MPRalbum");
			expect(details.properties.parts).toBe(3);
			expect(details.relatedEntityGroups[0]?.coverage).toEqual({
				status: "more",
				continuation: {
					offset: 2,
					token: "page-2",
					expectedTotal: 3,
					previousToken: null,
					playlistId: "album-playlist",
				},
			});
			const error = yield* Effect.flip(
				buildAlbumRelated(client, {
					properties: {},
					direction: "outgoing",
					externalId: "MPRalbum",
					entitySchemaSlug: "music-group",
					relationshipSchemaSlug: "music-group-to-music",
					continuation: {
						offset: 2,
						token: "page-2",
						expectedTotal: 3,
						previousToken: null,
						playlistId: "album-playlist",
					},
				}),
			);
			expect(error.message).toBe(
				"YouTube Music album playlist does not match its expected track total",
			);
		}),
	testTimeout,
);

it.live(
	"fails when album replay exhausts its forty-source-page budget",
	() =>
		Effect.gen(function* () {
			const { client, requests } = yield* recordedClient("browse", [
				artistSongsResponse("token"),
				...Array.from({ length: 39 }, (_, index) =>
					albumTrackContinuation([], `page-${index + 3}`),
				),
			]);
			const error = yield* Effect.flip(
				buildAlbumRelated(client, {
					properties: {},
					direction: "outgoing",
					externalId: "MPRalbum",
					entitySchemaSlug: "music-group",
					relationshipSchemaSlug: "music-group-to-music",
					continuation: {
						offset: 2,
						token: "page-41",
						expectedTotal: null,
						previousToken: "page-40",
						playlistId: "album-playlist",
					},
				}),
			);
			expect(error.message).toBe("YouTube Music album source exceeds the 40-page replay budget");
			expect(requests).toHaveLength(40);
		}),
	testTimeout,
);

it.live.each([
	{ offset: 3, continuation: undefined },
	{ offset: 2, continuation: "page-2" },
])(
	"rejects inconsistent album replay or a repeated token: %s",
	({ offset, continuation }) =>
		Effect.gen(function* () {
			const { client } = yield* recordedClient("browse", [
				artistSongsResponse("token"),
				albumTrackContinuation(["third"], continuation),
			]);
			const error = yield* Effect.flip(
				buildAlbumRelated(client, {
					properties: {},
					direction: "outgoing",
					externalId: "MPRalbum",
					entitySchemaSlug: "music-group",
					relationshipSchemaSlug: "music-group-to-music",
					continuation: {
						offset,
						token: "page-2",
						expectedTotal: null,
						previousToken: null,
						playlistId: "album-playlist",
					},
				}),
			);
			expect(error.message).toBe("YouTube Music album continuation did not advance consistently");
		}),
	testTimeout,
);

it.live(
	"retries an album continuation with the same offset after a failed request",
	() =>
		Effect.gen(function* () {
			const first = artistSongsResponse("token");
			const { client } = yield* recordedClient("browse", [
				albumWithPlaylist("menu"),
				first,
				first,
				new Error("Unavailable"),
				first,
				albumTrackContinuation(["second", "third"]),
			]);
			yield* buildAlbumDetails(client, "MPRalbum");
			const input = {
				properties: {},
				externalId: "MPRalbum",
				direction: "outgoing" as const,
				entitySchemaSlug: "music-group",
				relationshipSchemaSlug: "music-group-to-music",
				continuation: {
					offset: 2,
					token: "page-2",
					expectedTotal: null,
					previousToken: null,
					playlistId: "album-playlist",
				},
			};
			expect((yield* Effect.flip(buildAlbumRelated(client, input))).message).toContain("500");
			expect(input.continuation).toEqual({
				offset: 2,
				token: "page-2",
				expectedTotal: null,
				previousToken: null,
				playlistId: "album-playlist",
			});
			expect(yield* buildAlbumRelated(client, input)).toEqual({
				coverage: { status: "complete" },
				entities: [
					{
						name: "third",
						externalId: "third",
						providerSlug: "music.youtube-music",
						relationshipProperties: { order: 3 },
					},
				],
			});
		}),
	testTimeout,
);

it.live.each(["song", "album", "artist"] as const)(
	"replays three %s search pages and reports only known totals",
	(kind) =>
		Effect.gen(function* () {
			const repeated =
				searchResponse(kind).contents.tabbedSearchResultsRenderer.tabs[0]?.tabRenderer.content
					.sectionListRenderer.contents[0]?.musicShelfRenderer.contents ?? [];
			const { client, requests } = yield* recordedClient("search", [
				continuedSearchResponse(kind),
				{
					continuationContents: {
						musicShelfContinuation: {
							contents: repeated,
							continuations: [{ nextContinuationData: { continuation: "search-3" } }],
						},
					},
				},
				{ continuationContents: { musicShelfContinuation: { contents: [] } } },
			]);
			const search = { song: buildTrackSearch, album: buildAlbumSearch, artist: buildArtistSearch };
			const result = yield* search[kind](client, "query", 1, 2);
			expect(result).toEqual({ items: [], details: { totalItems: 1, nextPage: null } });
			expect(requests.map(({ body }) => body)).toMatchObject([
				{ query: "query" },
				{ continuation: "search-2" },
				{ continuation: "search-3" },
			]);
		}),
	testTimeout,
);

it.live(
	"does not invent a search total when more results exist",
	() =>
		Effect.gen(function* () {
			const { client, requests } = yield* recordedClient("search", [
				continuedSearchResponse("album"),
			]);
			expect(yield* buildAlbumSearch(client, "query", 1)).toEqual({
				details: { nextPage: 2 },
				items: [
					{ title: "Album", externalId: "MPRalbum", imageUrl: "https://example.com/cover.jpg" },
				],
			});
			expect(requests).toHaveLength(1);
		}),
	testTimeout,
);

it.live.each([{}, new Error("Search unavailable")])(
	"fails a malformed or failed mid-search page",
	(response) =>
		Effect.gen(function* () {
			const { client } = yield* recordedClient("search", [
				continuedSearchResponse("song"),
				response,
			]);
			const error = yield* Effect.flip(buildTrackSearch(client, "query", 2));
			expect(error.message).toContain(response instanceof Error ? "500" : "missing contents");
		}),
	testTimeout,
);

it.live.each([undefined, "en", "fr"] as const)(
	"creates a client without HTTP calls for %s language",
	(language) =>
		Effect.gen(function* () {
			const attemptedUrls: string[] = [];
			const host: YoutubeiHost = {
				httpCall: (_method, url) => {
					attemptedUrls.push(url);
					return Effect.fail({ message: "Unexpected YouTube Music host call" });
				},
			};

			const client = yield* createYoutubeMusicClient(host, language);

			expect(attemptedUrls).toEqual([]);
			expect(client.session.player).toBeUndefined();
			expect(client.session.context.client.hl).toBe(language ?? "en");
		}),
	testTimeout,
);

it.live(
	"maps song, artist, and album search without initialization requests",
	() =>
		Effect.gen(function* () {
			const tracks = yield* recordedClient("search", [searchResponse("song")]);
			expect(yield* buildTrackSearch(tracks.client, "query", 20)).toEqual({
				details: { totalItems: 1, nextPage: null },
				items: [{ title: "Track", externalId: "track", imageUrl: "https://example.com/cover.jpg" }],
			});
			const artists = yield* recordedClient("search", [searchResponse("artist")]);
			expect(yield* buildArtistSearch(artists.client, "query")).toEqual({
				details: { totalItems: 1, nextPage: null },
				items: [
					{ title: "Artist", externalId: "UCartist", imageUrl: "https://example.com/cover.jpg" },
				],
			});
			const albums = yield* recordedClient("search", [searchResponse("album")]);
			expect(yield* buildAlbumSearch(albums.client, "query", 20)).toEqual({
				details: { totalItems: 1, nextPage: null },
				items: [
					{ title: "Album", externalId: "MPRalbum", imageUrl: "https://example.com/cover.jpg" },
				],
			});
			for (const { requests } of [tracks, artists, albums]) {
				expect(requests).toHaveLength(1);
				expect(requests[0]).toMatchObject({
					method: "POST",
					path: "/youtubei/v1/search",
					body: { query: "query", context: { client: { hl: "en", clientName: "WEB_REMIX" } } },
				});
			}
		}),
	testTimeout,
);

it.live.each([false, true])(
	"maps track details through the queue (automix: %s)",
	(automix) =>
		Effect.gen(function* () {
			const responses = [
				...(automix ? [queueResponse("Track", true)] : []),
				queueResponse("Track"),
			];
			const { client, requests } = yield* recordedClient("next", responses);
			expect(yield* buildTrackDetails(client, "track")).toEqual({
				name: "Track",
				properties: {
					duration: 201,
					publishYear: 2024,
					byVariousArtists: false,
					sourceUrl: "https://music.youtube.com/watch?v=track",
					images: [{ type: "remote", purpose: "cover", url: "https://example.com/cover.jpg" }],
				},
				relatedEntityGroups: [
					{
						direction: "incoming",
						synchronization: "authoritative",
						coverage: { status: "complete" },
						relationshipSchemaSlug: "person-to-music",
						entities: [
							{
								name: "Artist",
								externalId: "UCartist",
								providerSlug: "person.youtube-music",
								relationshipProperties: { roles: ["Artist"] },
							},
						],
					},
					{
						direction: "incoming",
						synchronization: "additive",
						coverage: { status: "complete" },
						relationshipSchemaSlug: "music-group-to-music",
						entities: [
							{
								name: "Album",
								externalId: "MPRalbum",
								providerSlug: "music-group.youtube-music",
								relationshipProperties: { roles: ["Member"] },
							},
						],
					},
					{
						direction: "outgoing",
						synchronization: "authoritative",
						coverage: { status: "complete" },
						relationshipSchemaSlug: "media-suggestion",
						entities: [
							{ name: "Neighbor", externalId: "neighbor", providerSlug: "music.youtube-music" },
						],
					},
					{
						entities: [],
						direction: "outgoing",
						synchronization: "authoritative",
						coverage: { status: "complete" },
						relationshipSchemaSlug: "music-to-genre",
					},
				],
			});
			expect(requests).toHaveLength(automix ? 2 : 1);
			if (automix) {
				expect(requests[1]).toMatchObject({ body: { videoId: "track", playlistId: "RDfixture" } });
			}
		}),
	testTimeout,
);

it.live(
	"maps artist album and single carousels without duplicate or unrelated credits",
	() =>
		Effect.gen(function* () {
			const { client, requests } = yield* recordedClient("browse", [artistResponse("Artist")]);
			expect(yield* buildArtistDetails(client, "UCartist")).toEqual({
				name: "Artist",
				properties: {
					alternateNames: [],
					description: "Artist biography",
					sourceUrl: "https://music.youtube.com/channel/UCartist",
					images: [{ type: "remote", purpose: "profile", url: "https://example.com/cover.jpg" }],
				},
				relatedEntityGroups: [
					{
						direction: "outgoing",
						synchronization: "additive",
						relationshipSchemaSlug: "person-to-music",
						coverage: {
							status: "source-limited",
							reason: "Artist page exposes no complete inventory endpoint",
						},
						entities: [
							{
								name: "Track",
								externalId: "track",
								providerSlug: "music.youtube-music",
								relationshipProperties: { roles: ["Artist"] },
							},
						],
					},
					{
						direction: "outgoing",
						synchronization: "additive",
						relationshipSchemaSlug: "person-to-music-group",
						coverage: {
							status: "source-limited",
							reason: "Artist page exposes no complete inventory endpoint",
						},
						entities: [
							{
								name: "Album",
								externalId: "MPRalbum",
								providerSlug: "music-group.youtube-music",
								relationshipProperties: { roles: ["Artist"] },
							},
							{
								name: "Single",
								externalId: "MPRsingle",
								providerSlug: "music-group.youtube-music",
								relationshipProperties: { roles: ["Artist"] },
							},
						],
					},
				],
			});
			expect(requests).toHaveLength(1);
			expect(requests[0]).toMatchObject({ body: { browseId: "UCartist" } });
		}),
	testTimeout,
);

it.live(
	"maps album details and ordered members through browse",
	() =>
		Effect.gen(function* () {
			const { client, requests } = yield* recordedClient("browse", [albumResponse("Album")]);
			expect(yield* buildAlbumDetails(client, "MPRalbum")).toEqual({
				name: "Album",
				properties: {
					parts: null,
					sourceUrl: null,
					description: "Album description",
					images: [{ type: "remote", purpose: "cover", url: "https://example.com/cover.jpg" }],
				},
				relatedEntityGroups: [
					{
						direction: "outgoing",
						synchronization: "authoritative",
						relationshipSchemaSlug: "music-group-to-music",
						coverage: {
							status: "source-limited",
							reason:
								"Album source exposes no track playlist endpoint or matching explicit track total",
						},
						entities: [
							{
								name: "Track",
								externalId: "track",
								providerSlug: "music.youtube-music",
								relationshipProperties: { order: 1 },
							},
							{
								name: "Neighbor",
								externalId: "neighbor",
								providerSlug: "music.youtube-music",
								relationshipProperties: { order: 2 },
							},
						],
					},
				],
			});
			expect(requests).toHaveLength(1);
			expect(requests[0]).toMatchObject({ body: { browseId: "MPRalbum" } });
		}),
	testTimeout,
);

it.live.each(["Top songs", "Canciones principales"])(
	"defers the artist song playlist behind %s to related work",
	(title) =>
		Effect.gen(function* () {
			const { client, requests } = yield* recordedClient("browse", [
				artistResponse("Artist", title),
			]);
			const details = yield* buildArtistDetails(client, "UCartist");
			expect(details.relatedEntityGroups[0]?.entities).toEqual([
				{
					name: "Track",
					externalId: "track",
					providerSlug: "music.youtube-music",
					relationshipProperties: { roles: ["Artist"] },
				},
			]);
			expect(requests.map(({ body }) => body)).toMatchObject([{ browseId: "UCartist" }]);
			expect(details.relatedEntityGroups[0]?.coverage).toEqual({
				status: "more",
				continuation: { source: 0 },
			});
		}),
	testTimeout,
);

it.live.each(["token", "endpoint"] as const)(
	"resumes three artist song %s pages with overlapping songs",
	(continuation) =>
		Effect.gen(function* () {
			const { client, requests } = yield* recordedClient("browse", [
				artistResponse("Artist", "Top songs"),
				artistResponse("Artist", "Top songs"),
				artistSongsResponse(continuation),
				artistResponse("Artist", "Top songs"),
				{
					continuationContents: {
						musicPlaylistShelfContinuation: {
							...artistSongsContinuationResponse.continuationContents
								.musicPlaylistShelfContinuation,
							continuations: [{ nextContinuationData: { continuation: "page-3" } }],
						},
					},
				},
				artistResponse("Artist", "Top songs"),
				artistSongsContinuationResponse,
			]);
			const details = yield* buildArtistDetails(client, "UCartist");
			expect(requests).toHaveLength(1);
			const base = {
				properties: {},
				externalId: "UCartist",
				entitySchemaSlug: "person",
				direction: "outgoing" as const,
				relationshipSchemaSlug: "person-to-music",
			};
			const first = yield* buildArtistRelated(client, { ...base, continuation: { source: 0 } });
			expect(first.coverage).toEqual({
				status: "more",
				continuation: { source: 0, token: "page-2" },
			});
			expect(
				new TextEncoder().encode(
					yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(first.coverage),
				).byteLength,
			).toBeLessThan(4096);
			const second = yield* buildArtistRelated(client, {
				...base,
				continuation: { source: 0, token: "page-2" },
			});
			expect(second.coverage).toEqual({
				status: "more",
				continuation: { source: 0, token: "page-3" },
			});
			const third = yield* buildArtistRelated(client, {
				...base,
				continuation: { source: 0, token: "page-3" },
			});
			expect(third.coverage).toEqual({ status: "complete" });
			expect([
				...new Set(
					[
						...(details.relatedEntityGroups[0]?.entities ?? []),
						...first.entities,
						...second.entities,
						...third.entities,
					].map(({ externalId }) => externalId),
				),
			]).toEqual(["track", "second", "third"]);
			expect(requests).toHaveLength(7);
			expect(requests[2]).toMatchObject({ body: { browseId: "VLartist-songs" } });
			expect(requests[4]).toMatchObject({ body: { continuation: "page-2" } });
			expect(requests[6]).toMatchObject({ body: { continuation: "page-3" } });
		}),
	testTimeout,
);

it.live.each([
	{ format: "grid", continuation: "token" },
	{ format: "action", continuation: "endpoint" },
] as const)(
	"fetches full artist albums, singles and videos with $continuation/$format pagination",
	({ format, continuation }) =>
		Effect.gen(function* () {
			const { client, requests } = yield* recordedClient("browse", [
				artistInventoryResponse(),
				artistInventoryResponse(),
				artistDiscographyResponse(continuation),
				artistInventoryResponse(),
				artistDiscographyContinuationResponse(format),
				artistInventoryResponse(),
				artistSinglesResponse,
				artistInventoryResponse(),
				artistVideosResponse,
				artistInventoryResponse(),
				artistVideosContinuationResponse,
			]);
			const details = yield* buildArtistDetails(client, "UCartist");
			expect(requests).toHaveLength(1);
			const base = {
				properties: {},
				externalId: "UCartist",
				entitySchemaSlug: "person",
				direction: "outgoing" as const,
				relationshipSchemaSlug: "person-to-music-group",
			};
			const albums = yield* buildArtistRelated(client, { ...base, continuation: { source: 0 } });
			const moreAlbums = yield* buildArtistRelated(client, {
				...base,
				continuation: { source: 0, token: "albums-page-2" },
			});
			expect(moreAlbums.coverage).toEqual({ status: "more", continuation: { source: 1 } });
			const singles = yield* buildArtistRelated(client, { ...base, continuation: { source: 1 } });
			expect(singles.coverage).toEqual({ status: "complete" });
			const videos = yield* buildArtistRelated(client, {
				...base,
				continuation: { source: 0 },
				relationshipSchemaSlug: "person-to-music",
			});
			const moreVideos = yield* buildArtistRelated(client, {
				...base,
				relationshipSchemaSlug: "person-to-music",
				continuation: { source: 0, token: "videos-page-2" },
			});
			expect(moreVideos.coverage).toEqual({ status: "complete" });
			expect([
				...new Set(
					[
						...(details.relatedEntityGroups[1]?.entities ?? []),
						...albums.entities,
						...moreAlbums.entities,
						...singles.entities,
					].map(({ externalId }) => externalId),
				),
			]).toEqual(["MPRalbum", "MPRsingle", "MPRsecond", "MPRthird", "MPRep"]);
			expect([
				...new Set(
					[...videos.entities, ...moreVideos.entities].map(({ externalId }) => externalId),
				),
			]).toEqual(["video", "video-2", "video-3"]);
			expect(requests.map(({ body }) => body)).toMatchObject([
				{ browseId: "UCartist" },
				{ browseId: "UCartist" },
				{ params: "albums", browseId: "MPADartist" },
				{ browseId: "UCartist" },
				{ continuation: "albums-page-2" },
				{ browseId: "UCartist" },
				{ params: "singles", browseId: "MPADartist" },
				{ browseId: "UCartist" },
				{ browseId: "VLartist-videos" },
				{ browseId: "UCartist" },
				{ continuation: "videos-page-2" },
			]);
		}),
	testTimeout,
);

it.live.each([
	{ source: 0, token: undefined, relationshipSchemaSlug: "person-to-music-group" },
	{ source: 0, token: "albums-page-2", relationshipSchemaSlug: "person-to-music-group" },
	{ source: 1, token: undefined, relationshipSchemaSlug: "person-to-music-group" },
	{ source: 0, token: undefined, relationshipSchemaSlug: "person-to-music" },
	{ source: 0, token: "videos-page-2", relationshipSchemaSlug: "person-to-music" },
])(
	"fails related work instead of publishing a partial successful page: %s",
	({ token, source, relationshipSchemaSlug }) =>
		Effect.gen(function* () {
			const responses: unknown[] = [artistInventoryResponse(), new Error("Inventory unavailable")];
			const { client, requests } = yield* recordedClient("browse", responses);
			const error = yield* Effect.flip(
				buildArtistRelated(client, {
					properties: {},
					direction: "outgoing",
					externalId: "UCartist",
					relationshipSchemaSlug,
					entitySchemaSlug: "person",
					continuation: { source, ...(token ? { token } : {}) },
				}),
			);
			expect(error.message).toContain("500");
			expect(requests).toHaveLength(2);
		}),
	testTimeout,
);

it.live(
	"fails artist refresh when the discography response has no inventory",
	() =>
		Effect.gen(function* () {
			const { client } = yield* recordedClient("browse", [artistInventoryResponse(), {}]);
			const error = yield* Effect.flip(
				buildArtistRelated(client, {
					properties: {},
					direction: "outgoing",
					externalId: "UCartist",
					entitySchemaSlug: "person",
					continuation: { source: 0 },
					relationshipSchemaSlug: "person-to-music-group",
				}),
			);
			expect(error.message).toBe("YouTube Music artist inventory is missing items");
		}),
	testTimeout,
);

it.live(
	"rejects malformed artist cursors before requesting an inventory",
	() =>
		Effect.gen(function* () {
			const { client, requests } = yield* recordedClient("browse", []);
			const error = yield* Effect.flip(
				buildArtistRelated(client, {
					properties: {},
					direction: "outgoing",
					externalId: "UCartist",
					entitySchemaSlug: "person",
					continuation: { source: -1 },
					relationshipSchemaSlug: "person-to-music",
				}),
			);
			expect(error.message).toBe("Invalid YouTube Music artist continuation");
			expect(requests).toHaveLength(0);
		}),
	testTimeout,
);

it.live(
	"rejects a repeated artist continuation instead of completing a partial inventory",
	() =>
		Effect.gen(function* () {
			const { client } = yield* recordedClient("browse", [
				artistResponse("Artist", "Top songs"),
				artistSongsResponse("token"),
			]);
			const error = yield* Effect.flip(
				buildArtistRelated(client, {
					properties: {},
					direction: "outgoing",
					externalId: "UCartist",
					entitySchemaSlug: "person",
					relationshipSchemaSlug: "person-to-music",
					continuation: { source: 0, token: "page-2" },
				}),
			);
			expect(error.message).toBe("YouTube Music artist continuation did not advance");
		}),
	testTimeout,
);

it.live(
	"preserves the requested language for all three translations",
	() =>
		Effect.gen(function* () {
			const track = yield* recordedClient(
				"next",
				[queueResponse("Chanson", true), queueResponse("Chanson")],
				"fr",
			);
			expect(yield* buildTrackTranslate(track.client, "track")).toEqual({ name: "Chanson" });
			const artist = yield* recordedClient(
				"browse",
				[artistResponse("Artiste", "Titres populaires")],
				"fr",
			);
			expect(yield* buildArtistTranslate(artist.client, "UCartist")).toEqual({ name: "Artiste" });
			const album = yield* recordedClient("browse", [albumResponse("Disque")], "fr");
			expect(yield* buildAlbumTranslate(album.client, "MPRalbum")).toEqual({ name: "Disque" });
			expect(track.requests).toHaveLength(2);
			expect(artist.requests).toHaveLength(1);
			expect(album.requests).toHaveLength(1);
			for (const request of [...track.requests, ...artist.requests, ...album.requests]) {
				expect(request).toMatchObject({
					method: "POST",
					body: { context: { client: { hl: "fr", clientName: "WEB_REMIX" } } },
				});
			}
		}),
	testTimeout,
);
