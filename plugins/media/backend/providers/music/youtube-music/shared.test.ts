import { configureApprovedDependencyRuntime } from "@ryot-app/plugin-backend-sdk/dependency-runtime";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { describe, expect, it } from "vitest";

import type { YoutubeMusicHost } from "../../../lib/vendors/youtube-music";
import { runHistory } from "./history.sandbox";
import { buildHistory, buildTrackDetails } from "./shared";

configureApprovedDependencyRuntime((operation) => operation());

const historyItem = (videoId: string, title: string) => ({
	musicResponsiveListItemRenderer: {
		playlistItemData: { videoId },
		flexColumns: [
			{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
		],
	},
});

const historyResponse = (contents: readonly unknown[]) => ({
	contents: {
		singleColumnBrowseResultsRenderer: {
			tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents } } } }],
		},
	},
});

const historyShelf = (title: string, contents: readonly unknown[]) => ({
	musicShelfRenderer: { contents, title: { runs: [{ text: title }] } },
});

const trackDetailsClient = (track: Record<string, unknown>) => ({
	music: {
		getUpNext: () =>
			Effect.runPromise(
				Effect.succeed({ contents: [{ title: "Source", video_id: "track-1", ...track }] }),
			),
	},
});

describe("music.youtube-music sandbox script", () => {
	it("keeps queue neighbors as related entities", () => {
		const client = {
			music: {
				getUpNext: () =>
					Effect.runPromise(
						Effect.succeed({
							contents: [
								{
									title: "Source",
									video_id: "track-1",
									duration: { seconds: 180 },
									album: { year: "2024", id: "album-1", name: "Album" },
									artists: [{ name: "Artist", channel_id: "artist-1" }],
									thumbnail: [{ width: 100, height: 100, url: "https://img/1.jpg" }],
								},
								{ title: "Pick One", video_id: "track-2" },
								{ title: "Pick One", video_id: "track-2" },
								{ title: "Pick Two", video_id: "track-3" },
							],
						}),
					),
			},
		};
		return Effect.runPromise(
			buildTrackDetails(client, "track-1").pipe(
				Effect.map((details) => {
					expect(details.name).toBe("Source");
					expect(details.properties).toEqual({
						duration: 180,
						publishYear: 2024,
						byVariousArtists: false,
						sourceUrl: "https://music.youtube.com/watch?v=track-1",
						images: [{ type: "remote", purpose: "cover", url: "https://img/1.jpg" }],
					});
					expect(details.relatedEntityGroups).toEqual([
						{
							direction: "incoming",
							synchronization: "authoritative",
							coverage: { status: "complete" },
							relationshipSchemaSlug: "person-to-music",
							entities: [
								{
									name: "Artist",
									externalId: "artist-1",
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
									externalId: "album-1",
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
								{ name: "Pick One", externalId: "track-2", providerSlug: "music.youtube-music" },
								{ name: "Pick Two", externalId: "track-3", providerSlug: "music.youtube-music" },
							],
						},
						{
							entities: [],
							direction: "outgoing",
							synchronization: "authoritative",
							coverage: { status: "complete" },
							relationshipSchemaSlug: "music-to-genre",
						},
					]);
					return undefined;
				}),
			),
		);
	});
	it.each([
		{},
		{ artists: null },
		{ artists: [null] },
		{ artists: [{ name: "Artist" }] },
		{ artists: [{ name: "Artist", channel_id: "  " }] },
		{ artists: [{ name: "Artist", channel_id: "artist-1" }, {}] },
	])("rejects malformed YouTube Music artist inventory %#", (track) =>
		expect(
			Effect.runPromise(buildTrackDetails(trackDetailsClient(track), "track-1")),
		).rejects.toThrow("YouTube Music track artist"),
	);
	it("keeps artist name fallback and merges duplicate artists", () => {
		const client = trackDetailsClient({
			artists: [
				{ channel_id: "artist-1" },
				{ name: "Artist", channel_id: "artist-1" },
				{ channel_id: "artist-2" },
			],
		});
		return Effect.runPromise(
			buildTrackDetails(client, "track-1").pipe(
				Effect.map((details) => {
					expect(details.relatedEntityGroups[0]).toEqual({
						direction: "incoming",
						coverage: { status: "complete" },
						synchronization: "authoritative",
						relationshipSchemaSlug: "person-to-music",
						entities: [
							{
								name: "Artist",
								externalId: "artist-1",
								providerSlug: "person.youtube-music",
								relationshipProperties: { roles: ["Artist"] },
							},
							{
								name: "Loading...",
								externalId: "artist-2",
								providerSlug: "person.youtube-music",
								relationshipProperties: { roles: ["Artist"] },
							},
						],
					});
					return undefined;
				}),
			),
		);
	});
	it("accepts an explicit empty artist inventory as complete", () => {
		const client = trackDetailsClient({ artists: [] });
		return Effect.runPromise(
			buildTrackDetails(client, "track-1").pipe(
				Effect.map((details) => {
					expect(details.properties.byVariousArtists).toBeNull();
					expect(details.relatedEntityGroups[0]).toEqual({
						entities: [],
						direction: "incoming",
						coverage: { status: "complete" },
						synchronization: "authoritative",
						relationshipSchemaSlug: "person-to-music",
					});
					return undefined;
				}),
			),
		);
	});
	it("collects only today's tracks from YouTube Music history", () => {
		const client = {
			getHistory: () =>
				Effect.succeed(
					historyResponse([
						historyShelf("August 5, 2026", [
							historyItem("v1", "First"),
							{},
							historyItem("v2", "Second"),
						]),
						historyShelf("Yesterday", []),
					]),
				),
		};
		return Effect.runPromise(
			buildHistory(client, "UTC", "2026-08-05T12:00:00.000Z").pipe(
				Effect.map((result) => {
					expect(result).toEqual({
						songs: [
							{ videoId: "v1", title: "First" },
							{ videoId: "v2", title: "Second" },
						],
					});
					return undefined;
				}),
			),
		);
	});

	it("rejects YouTube Music history when sign-in is required", () => {
		const client = {
			getHistory: () =>
				Effect.succeed(
					historyResponse([
						{
							itemSectionRenderer: {
								contents: [
									{
										messageRenderer: {
											button: {
												buttonRenderer: { navigationEndpoint: { signInEndpoint: { hack: true } } },
											},
										},
									},
								],
							},
						},
					]),
				),
		};
		return Effect.runPromise(
			Effect.flip(buildHistory(client, "UTC", "2026-08-05T12:00:00.000Z")).pipe(
				Effect.map((error) => {
					expect(error.message).toBe(
						"YouTube Music history requires sign-in; authentication was not accepted",
					);
					return undefined;
				}),
			),
		);
	});
	it.each([
		{},
		{ contents: { twoColumnBrowseResultsRenderer: {} } },
		historyResponse([{ unknownRenderer: {} }]),
	])("rejects malformed YouTube Music history response %#", (response) => {
		const client = { getHistory: () => Effect.succeed(response) };
		return Effect.runPromise(
			Effect.flip(buildHistory(client, "UTC", "2026-08-05T12:00:00.000Z")).pipe(
				Effect.map((error) => {
					expect(error.message).toContain("Unrecognized YouTube Music history");
					return undefined;
				}),
			),
		);
	});
	it("returns no songs when today's history shelf is absent", () => {
		const client = {
			getHistory: () =>
				Effect.succeed(historyResponse([historyShelf("Yesterday", [historyItem("old", "Old")])])),
		};
		return Effect.runPromise(
			buildHistory(client, "UTC", "2026-08-05T12:00:00.000Z").pipe(
				Effect.map((result) => {
					expect(result).toEqual({ songs: [] });
					return undefined;
				}),
			),
		);
	});
	it("returns no songs for empty YouTube Music history", () => {
		const client = { getHistory: () => Effect.succeed(historyResponse([])) };
		return Effect.runPromise(
			buildHistory(client, "UTC", "2026-08-05T12:00:00.000Z").pipe(
				Effect.map((result) => {
					expect(result).toEqual({ songs: [] });
					return undefined;
				}),
			),
		);
	});

	it("passes workflow startedAt to the history entrypoint", () => {
		const client = {
			getHistory: () =>
				Effect.succeed(
					historyResponse([historyShelf("August 5, 2026", [historyItem("v1", "First")])]),
				),
		};
		const host: YoutubeMusicHost = {
			httpCall: () => Effect.die("Unexpected YouTube Music host call"),
		};
		return Effect.runPromise(
			runHistory(
				{ timezone: "UTC", authCookie: "cookie" },
				host,
				{ metadata: {}, sandboxScriptId: "script_test", startedAt: "2026-08-05T12:00:00.000Z" },
				() => Effect.succeed(client),
			).pipe(
				Effect.map((result) => {
					expect(result).toEqual({ songs: [{ videoId: "v1", title: "First" }] });
					return undefined;
				}),
			),
		);
	});
});
