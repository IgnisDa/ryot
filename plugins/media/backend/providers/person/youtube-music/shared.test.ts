import { describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

import { buildArtistDetails } from "./shared";

describe("person.youtube-music sandbox script", () => {
	it.live("classifies artist credits by item type rather than section titles", () =>
		Effect.gen(function* () {
			const client = {
				music: {
					getArtist: () =>
						Promise.resolve({
							header: {
								title: { text: "The Artist" },
								description: { text: "Bio." },
								thumbnail: [
									{ width: 60, height: 60, url: "https://img/small.jpg" },
									{ width: 600, height: 600, url: "https://img/big.jpg" },
								],
							},
							sections: [
								{
									title: { text: "Canciones" },
									contents: [{ id: "s1", item_type: "song", title: "Song One" }],
								},
								{
									header: { title: { text: "Álbumes" } },
									contents: [{ id: "al1", item_type: "album", title: { text: "Album One" } }],
								},
								{
									contents: [
										{ id: "v1", item_type: "video", title: { text: "Video One" } },
										{ id: "al1", item_type: "album", title: { text: "Album One" } },
									],
								},
							],
						}),
				},
			};

			const details = yield* buildArtistDetails(client, "artist-1");
			expect(details.name).toBe("The Artist");
			expect(details.properties).toEqual({
				alternateNames: [],
				description: "Bio\\.",
				sourceUrl: "https://music.youtube.com/channel/artist-1",
				images: [
					{ type: "remote", purpose: "profile", url: "https://img/big.jpg" },
					{ type: "remote", purpose: "profile", url: "https://img/small.jpg" },
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
							providerSlug: "music.youtube-music",
							relationshipProperties: { roles: ["Artist"] },
						},
						{
							externalId: "v1",
							name: "Video One",
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
							name: "Album One",
							externalId: "al1",
							providerSlug: "music-group.youtube-music",
							relationshipProperties: { roles: ["Artist"] },
						},
					],
				},
			]);
		}),
	);

	it.live("omits unsupported and incomplete items from authoritative artist credits", () =>
		Effect.gen(function* () {
			const details = yield* buildArtistDetails(
				{
					music: {
						getArtist: () =>
							Promise.resolve({
								header: { title: { text: "The Artist" } },
								sections: [
									{
										title: { text: "Albums" },
										contents: [
											{ id: "other", item_type: "artist", title: { text: "Other Artist" } },
											{ id: "playlist", title: "Playlist", item_type: "playlist" },
											{ id: "endpoint", title: "Shuffle", item_type: "endpoint" },
											{ item_type: "album", title: { text: "No Id" } },
											{ id: "empty", item_type: "album", title: { text: " " } },
											{ id: "missing", item_type: "album" },
											{ id: " ", item_type: "song", title: "Blank Id" },
											{ id: "unknown", title: "Unknown Type" },
										],
									},
								],
							}),
					},
				},
				"artist-1",
			);
			expect(details.relatedEntityGroups).toEqual([
				{
					entities: [],
					direction: "outgoing",
					synchronization: "authoritative",
					relationshipSchemaSlug: "person-to-music",
				},
				{
					entities: [],
					direction: "outgoing",
					synchronization: "authoritative",
					relationshipSchemaSlug: "person-to-music-group",
				},
			]);
		}),
	);
});
