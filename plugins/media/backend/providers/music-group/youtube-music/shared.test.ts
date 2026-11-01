import { configureApprovedDependencyRuntime } from "@ryot-app/plugin-backend-sdk/dependency-runtime";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { describe, expect, it } from "vitest";

import { artistSongsResponse } from "../../../../tests/backend/youtube-music-fixtures";
import { createYoutubeMusicClient } from "../../../lib/vendors/youtube-music";
import { buildAlbumDetails } from "./shared";

configureApprovedDependencyRuntime((operation) => operation());

describe("music-group.youtube-music sandbox script", () => {
	it("keeps album metadata but fetches ordered members from its playlist", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const requests: string[] = [];
				const source = yield* createYoutubeMusicClient({
					httpCall: (_method, _url, options) => {
						requests.push(options?.body ?? "");
						return Effect.succeed({
							status: 200,
							headers: {},
							body: JSON.stringify(artistSongsResponse()),
						});
					},
				});
				const details = yield* buildAlbumDetails(
					{
						actions: source.actions,
						music: {
							getPlaylist: (id) => source.music.getPlaylist(id),
							getAlbum: () =>
								Promise.resolve({
									title: "The Album",
									playlist_id: "PL123",
									description: "Line one<br>Line two",
									contents: [{ id: "preview", title: "Preview only" }],
									thumbnail: [
										{ width: 60, height: 60, url: "https://img/small.jpg" },
										{ width: 600, height: 600, url: "https://img/big.jpg" },
									],
								}),
						},
					},
					"album-1",
				);
				expect(details.name).toBe("The Album");
				expect(details.properties).toEqual({
					parts: null,
					description: "Line one\\\nLine two",
					sourceUrl: "https://music.youtube.com/playlist?list=PL123",
					images: [{ type: "remote", purpose: "cover", url: "https://img/big.jpg" }],
				});
				expect(details.relatedEntityGroups).toEqual([
					{
						direction: "outgoing",
						synchronization: "authoritative",
						coverage: { status: "complete" },
						relationshipSchemaSlug: "music-group-to-music",
						entities: [
							{
								name: "Track",
								externalId: "track",
								providerSlug: "music.youtube-music",
								relationshipProperties: { order: 1 },
							},
							{
								externalId: "second",
								name: "Second Track",
								providerSlug: "music.youtube-music",
								relationshipProperties: { order: 2 },
							},
						],
					},
				]);
				expect(requests).toHaveLength(1);
				expect(requests[0]).toContain('"browseId":"VLPL123"');
			}),
		));

	it.each([
		{ continued: false, songCount: "3 songs" },
		{ continued: true, songCount: "1 song" },
	])(
		"rejects a playlist that contradicts its trusted total: $songCount",
		({ songCount, continued }) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const source = yield* createYoutubeMusicClient({
						httpCall: () =>
							Effect.succeed({
								status: 200,
								headers: {},
								body: JSON.stringify(artistSongsResponse(continued ? "token" : undefined)),
							}),
					});
					const error = yield* Effect.flip(
						buildAlbumDetails(
							{
								actions: source.actions,
								music: {
									getPlaylist: (id) => source.music.getPlaylist(id),
									getAlbum: () =>
										Promise.resolve({
											title: "Album",
											playlist_id: "PL123",
											header: { song_count: songCount },
										}),
								},
							},
							"MPRalbum",
						),
					);
					expect(error.message).toBe(
						"YouTube Music album playlist does not match its expected track total",
					);
				}),
			),
	);

	it.each([
		{ parts: 2, status: "complete", songCount: "2 songs" },
		{ parts: 3, songCount: "3 songs", status: "source-limited" },
		{ parts: null, status: "source-limited", songCount: "About 2 songs" },
		{ parts: null, songCount: "2 canciones", status: "source-limited" },
	])(
		"uses only a matching explicit track total without a playlist: $songCount",
		({ parts, status, songCount }) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const result = yield* buildAlbumDetails(
						{
							actions: {
								execute: (): Promise<never> =>
									Promise.reject(new Error("Unexpected browse request")),
							},
							music: {
								getPlaylist: (): Promise<never> =>
									Promise.reject(new Error("Unexpected playlist request")),
								getAlbum: () =>
									Promise.resolve({
										title: "Album",
										header: { song_count: songCount },
										contents: [
											{ id: "one", title: "One" },
											{ id: "two", title: "Two" },
										],
									}),
							},
						},
						"MPRalbum",
					);
					expect(result.properties.parts).toBe(parts);
					expect(result.relatedEntityGroups[0]?.coverage.status).toBe(status);
				}),
			),
	);
});
