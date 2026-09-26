import { expect, it } from "@effect/vitest";
import { configureApprovedDependencyRuntime } from "@ryot-app/sandbox-sdk/dependency-runtime";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import type { YoutubeiHost } from "@ryot-app/sandbox-sdk/youtubei";

import {
	albumResponse,
	artistResponse,
	queueResponse,
	searchResponse,
} from "../../../tests/backend/youtube-music-fixtures";
import {
	buildAlbumDetails,
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
	buildArtistSearch,
	buildArtistTranslate,
} from "../../providers/person/youtube-music/shared";
import { createYoutubeMusicClient } from "./youtube-music";

configureApprovedDependencyRuntime((operation) => operation());

const recordedClient = (path: string, responses: readonly unknown[], language = "en") => {
	const requests: { method: string; path: string; body: unknown }[] = [];
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
);

it.live("maps song, artist, and album search without initialization requests", () =>
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
			details: { nextPage: null, totalItems: 100 },
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
);

it.live.each([false, true])("maps track details through the queue (automix: %s)", (automix) =>
	Effect.gen(function* () {
		const responses = [...(automix ? [queueResponse("Track", true)] : []), queueResponse("Track")];
		const { client, requests } = yield* recordedClient("next", responses);
		expect(yield* buildTrackDetails(client, "track")).toEqual({
			name: "Track",
			properties: {
				genres: [],
				duration: 201,
				publishYear: 2024,
				byVariousArtists: false,
				sourceUrl: "https://music.youtube.com/watch?v=track",
				images: [{ type: "remote", purpose: "cover", url: "https://example.com/cover.jpg" }],
			},
			relatedEntityGroups: [
				{
					direction: "incoming",
					synchronization: "additive",
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
					relationshipSchemaSlug: "media-suggestion",
					entities: [
						{ name: "Neighbor", externalId: "neighbor", providerSlug: "music.youtube-music" },
					],
				},
			],
		});
		expect(requests).toHaveLength(automix ? 2 : 1);
		if (automix) {
			expect(requests[1]).toMatchObject({ body: { videoId: "track", playlistId: "RDfixture" } });
		}
	}),
);

it.live("maps artist details and relationships through browse", () =>
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
					synchronization: "authoritative",
					relationshipSchemaSlug: "person-to-music",
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
					synchronization: "authoritative",
					relationshipSchemaSlug: "person-to-music-group",
					entities: [
						{
							name: "Album",
							externalId: "MPRalbum",
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
);

it.live("maps album details and ordered members through browse", () =>
	Effect.gen(function* () {
		const { client, requests } = yield* recordedClient("browse", [albumResponse("Album")]);
		expect(yield* buildAlbumDetails(client, "MPRalbum")).toEqual({
			name: "Album",
			properties: { parts: 2, images: [], sourceUrl: null, description: "Album description" },
			relatedEntityGroups: [
				{
					direction: "outgoing",
					synchronization: "authoritative",
					relationshipSchemaSlug: "music-group-to-music",
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
);

it.live("preserves the requested language for all three translations", () =>
	Effect.gen(function* () {
		const track = yield* recordedClient(
			"next",
			[queueResponse("Chanson", true), queueResponse("Chanson")],
			"fr",
		);
		expect(yield* buildTrackTranslate(track.client, "track")).toEqual({ name: "Chanson" });
		const artist = yield* recordedClient("browse", [artistResponse("Artiste")], "fr");
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
);
