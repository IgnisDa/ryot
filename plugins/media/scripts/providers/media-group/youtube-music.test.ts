import { Effect } from "@ryot/sandbox-sdk/effect";
import { describe, expect, it } from "vitest";

import { buildAlbumDetails } from "./youtube-music";

describe("music-group.youtube-music sandbox script", () => {
	it("cleans the html description and maps ordered track members", () => {
		const client = {
			music: {
				getAlbum: () =>
					Promise.resolve({
						title: "The Album",
						playlist_id: "PL123",
						description: "Line one<br>Line two",
						thumbnail: [
							{ url: "https://img/small.jpg", width: 60, height: 60 },
							{ url: "https://img/big.jpg", width: 600, height: 600 },
						],
						contents: [{ id: "t1", title: "First Track" }, { id: "t2" }, { title: "No Id" }],
					}),
			},
		};

		return Effect.runPromise(
			buildAlbumDetails(client, "album-1").pipe(
				Effect.map((details) => {
					expect(details.name).toBe("The Album");
					expect(details.properties).toEqual({
						parts: 3,
						description: "Line one\nLine two",
						sourceUrl: "https://music.youtube.com/playlist?list=PL123",
						images: [{ type: "remote", url: "https://img/big.jpg" }],
					});
					expect(details.relatedEntityGroups).toEqual([
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "music-group-to-music",
							entities: [
								{
									name: "First Track",
									externalId: "t1",
									providerSlug: "music.youtube-music",
									relationshipProperties: { order: 1 },
								},
								{
									name: "Loading...",
									externalId: "t2",
									providerSlug: "music.youtube-music",
									relationshipProperties: { order: 2 },
								},
							],
						},
					]);
				}),
			),
		);
	});
});
