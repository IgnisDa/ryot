import { expect, it } from "vitest";

import { createMediaImportChunk } from "./chunks";

it("keeps episode locators private and never falls unresolved episodes back to the parent", () => {
	const chunk = createMediaImportChunk({
		failures: [],
		populationResults: [{ index: 0, status: "completed", entityId: "show-1" }],
		episodeResolutions: [
			{ groupIndex: 0, eventIndex: 0, entityId: "episode-1" },
			{ groupIndex: 0, eventIndex: 1, entityId: null },
		],
		entityGroups: [
			{
				itemIndex: 0,
				collectionMemberships: [],
				entityRef: {
					kind: "resolved",
					externalId: "20",
					sourceLabel: "Lost",
					providerSlug: "show.tmdb",
					entitySchemaSlug: "show",
				},
				events: [
					{
						occurredAt: "2026-01-01T00:00:00.000Z",
						eventSchemaSlug: "progress",
						properties: { progressPercent: 100 },
						episodeLocator: { type: "show", seasonNumber: 1, episodeNumber: 1 },
					},
					{
						occurredAt: "2026-01-02T00:00:00.000Z",
						eventSchemaSlug: "progress",
						properties: { progressPercent: 100 },
						episodeLocator: { type: "show", seasonNumber: 1, episodeNumber: 99 },
					},
					{
						properties: {},
						eventSchemaSlug: "backlog",
						occurredAt: "2026-01-03T00:00:00.000Z",
					},
				],
			},
		],
	});

	expect(chunk.failures).toEqual([
		expect.objectContaining({
			stage: "provider_resolution",
			message: "Could not resolve show episode S1E99",
		}),
	]);
	expect(chunk.items).toMatchObject([
		{
			events: [
				{ subjectEntityId: "episode-1", eventSchemaSlug: "progress" },
				{ entityAlias: "media", eventSchemaSlug: "backlog" },
			],
		},
	]);
	expect(JSON.stringify(chunk)).not.toContain("episodeLocator");
});

it("emits resolved episode subjects, collections, and ownership as generic intents", () => {
	const chunk = createMediaImportChunk({
		failures: [],
		populationResults: [{ index: 0, status: "completed", entityId: "show-1" }],
		episodeResolutions: [{ groupIndex: 0, eventIndex: 0, entityId: "episode-1" }],
		entityGroups: [
			{
				itemIndex: 0,
				ownershipProvider: "watcharr",
				collectionMemberships: [{ collectionName: "Pinned" }],
				entityRef: {
					kind: "resolved",
					externalId: "20",
					sourceLabel: "Lost",
					providerSlug: "show.tmdb",
					entitySchemaSlug: "show",
				},
				events: [
					{
						occurredAt: "2026-01-01T00:00:00.000Z",
						eventSchemaSlug: "progress",
						properties: { progressPercent: 100 },
						episodeLocator: { type: "show", seasonNumber: 1, episodeNumber: 1 },
					},
					{
						properties: {},
						eventSchemaSlug: "backlog",
						occurredAt: "2026-01-03T00:00:00.000Z",
					},
				],
			},
		],
	});

	expect(chunk.failures).toEqual([]);
	expect(chunk.items[0]).toMatchObject({
		ownerships: [{ entityAlias: "media", provider: "watcharr" }],
		collectionMemberships: [{ entityAlias: "media", collectionName: "Pinned" }],
		entities: [{ alias: "media", entityId: "show-1", entitySchemaSlug: "show" }],
		events: [
			{
				entityAlias: "media",
				subjectEntityId: "episode-1",
				eventSchemaSlug: "progress",
			},
			{
				entityAlias: "media",
				eventSchemaSlug: "backlog",
			},
		],
	});
	expect(JSON.stringify(chunk)).not.toContain("episodeLocator");
});
