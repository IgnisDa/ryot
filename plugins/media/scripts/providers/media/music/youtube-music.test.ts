import { Effect } from "@ryot/sandbox-sdk/effect";
import { describe, expect, it } from "vitest";

import { buildHistory, buildTrackDetails } from "./youtube-music.sandbox";

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
									album: { id: "album-1", name: "Album", year: "2024" },
									artists: [{ channel_id: "artist-1", name: "Artist" }],
									thumbnail: [{ url: "https://img/1.jpg", width: 100, height: 100 }],
								},
								{ video_id: "track-2", title: "Pick One" },
								{ video_id: "track-2", title: "Pick One" },
								{ video_id: "track-3", title: "Pick Two" },
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
						genres: [],
						duration: 180,
						publishYear: 2024,
						byVariousArtists: false,
						images: [{ type: "remote", url: "https://img/1.jpg" }],
						sourceUrl: "https://music.youtube.com/watch?v=track-1",
					});
					expect(details.relatedEntityGroups).toEqual([
						{
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "person-to-music",
							entities: [
								{
									name: "Artist",
									externalId: "artist-1",
									scriptSlug: "person.youtube-music",
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
									externalId: "album-1",
									scriptSlug: "music-group.youtube-music",
									relationshipProperties: { roles: ["Member"] },
								},
							],
						},
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "media-suggestion",
							entities: [
								{ name: "Pick One", externalId: "track-2", scriptSlug: "music.youtube-music" },
								{ name: "Pick Two", externalId: "track-3", scriptSlug: "music.youtube-music" },
							],
						},
					]);
					return undefined;
				}),
			),
		);
	});
	it("collects only today's videos from watch history", () => {
		const client = {
			getHistory: () =>
				Effect.runPromise(
					Effect.succeed({
						sections: [
							{
								header: { type: "ItemSectionHeader", title: { text: "Today" } },
								contents: [
									{ type: "Video", video_id: "v1", title: { text: "First" } },
									{ type: "Continuation" },
									{ type: "Video", video_id: "v2", title: { text: "Second" } },
								],
							},
							{
								header: { type: "ItemSectionHeader", title: { text: "Yesterday" } },
								contents: [{ type: "Video", video_id: "v3", title: { text: "Third" } }],
							},
						],
					}),
				),
		};
		return Effect.runPromise(
			buildHistory(client, "UTC").pipe(
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
});
