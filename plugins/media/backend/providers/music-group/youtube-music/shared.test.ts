import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { describe, expect, it } from "vitest";

import { buildAlbumDetails } from "./shared";

describe("music-group.youtube-music sandbox script", () => {
	it("cleans the html description and maps ordered track members", () => {
		const client = {
			music: {
				getAlbum: () =>
					Promise.resolve({
						title: "The Album",
						playlist_id: "PL123",
						description: "Line one<br>Line two",
						contents: [{ id: "t1", title: "First Track" }, { id: "t2" }, { title: "No Id" }],
						thumbnail: [
							{ width: 60, height: 60, url: "https://img/small.jpg" },
							{ width: 600, height: 600, url: "https://img/big.jpg" },
						],
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
						images: [{ type: "remote", purpose: "cover", url: "https://img/big.jpg" }],
					});
					expect(details.relatedEntityGroups).toEqual([
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "music-group-to-music",
							entities: [
								{
									externalId: "t1",
									name: "First Track",
									providerSlug: "music.youtube-music",
									relationshipProperties: { order: 1 },
								},
								{
									externalId: "t2",
									name: "Loading...",
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
