import { describe, expect, it } from "vitest";

import { buildArtistDetails } from "./youtube-music.sandbox";

describe("person.youtube-music sandbox script", () => {
	it("splits artist sections into track and group related entities", () => {
		const client = {
			music: {
				getArtist: () =>
					Promise.resolve({
						header: {
							title: { text: "The Artist" },
							description: { text: "Bio." },
							thumbnail: [
								{ url: "https://img/small.jpg", width: 60, height: 60 },
								{ url: "https://img/big.jpg", width: 600, height: 600 },
							],
						},
						sections: [
							{
								title: { text: "Songs" },
								contents: [{ video_id: "s1", title: "Song One" }, { title: "No Id" }],
							},
							{ title: { text: "Albums" }, contents: [{ id: "al1", title: "Album One" }] },
						],
					}),
			},
		};

		return buildArtistDetails(client, "artist-1").then((details) => {
			expect(details.name).toBe("The Artist");
			expect(details.properties).toEqual({
				description: "Bio.",
				alternateNames: [],
				sourceUrl: "https://music.youtube.com/channel/artist-1",
				images: [
					{ type: "remote", url: "https://img/big.jpg" },
					{ type: "remote", url: "https://img/small.jpg" },
				],
			});
			expect(details.relatedEntityGroups).toEqual([
				{
					direction: "outgoing",
					synchronization: "authoritative",
					relationshipSchemaSlug: "person-to-music",
					entities: [
						{
							name: "Song One",
							externalId: "s1",
							scriptSlug: "music.youtube-music",
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
							name: "Album One",
							externalId: "al1",
							scriptSlug: "music-group.youtube-music",
							relationshipProperties: { roles: ["Artist"] },
						},
					],
				},
			]);
			return undefined;
		});
	});
});
