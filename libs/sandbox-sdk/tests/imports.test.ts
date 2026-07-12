import { Schema } from "@ryot/sandbox-sdk/effect";
import { genericImportChunkSchema } from "@ryot/sandbox-sdk/imports";
import { expect, it } from "vitest";

it("decodes generic media write intents without admitting plugin-private locators", () => {
	const chunk = {
		failures: [
			{
				itemIndex: 0,
				sourceLabel: "Lost",
				sourceIdentifier: "20",
				entitySchemaSlug: "show",
				stage: "provider_resolution",
				message: "Could not resolve S1E99",
			},
		],
		items: [
			{
				itemIndex: 1,
				relationships: [],
				sourceLabel: "Arrival",
				sourceIdentifier: "10",
				ownerships: [{ entityAlias: "media", provider: "watcharr" }],
				collectionMemberships: [{ entityAlias: "media", collectionName: "Pinned" }],
				entities: [
					{
						alias: "media",
						properties: {},
						name: "Arrival",
						entityId: "movie-1",
						entitySchemaSlug: "movie",
					},
				],
				events: [
					{
						properties: {},
						entityAlias: "media",
						eventSchemaSlug: "complete",
						subjectEntityId: "movie-1",
						occurredAt: "2026-01-01T00:00:00.000Z",
					},
				],
			},
		],
	};

	expect(Schema.decodeUnknownSync(genericImportChunkSchema)(chunk)).toEqual(chunk);
	expect(() =>
		Schema.decodeUnknownSync(genericImportChunkSchema)({
			...chunk,
			items: [
				{
					...chunk.items[0],
					events: [
						{
							...chunk.items[0]?.events[0],
							episodeLocator: { type: "show", seasonNumber: 1, episodeNumber: 99 },
						},
					],
				},
			],
		}),
	).toThrow();
	expect(() =>
		Schema.decodeUnknownSync(genericImportChunkSchema)({
			...chunk,
			items: [
				{ ...chunk.items[0], events: [{ ...chunk.items[0]?.events[0], subjectEntityId: "" }] },
			],
		}),
	).toThrow();
});
