import { expect, it } from "vitest";

import { createMediaImportChunk } from "./chunks";

const showRef = {
	externalId: "20",
	sourceLabel: "Lost",
	kind: "resolved",
	providerSlug: "show.tmdb",
	entitySchemaSlug: "show",
} as const;

it("writes finalized episode subjects and keeps plugin-private episode data out of the chunk", () => {
	const chunk = createMediaImportChunk({
		failures: [
			{
				itemIndex: 0,
				sourceLabel: "Lost",
				sourceIdentifier: "20",
				entitySchemaSlug: "show",
				stage: "provider_resolution",
				message: "Could not resolve show episode S1E99",
			},
		],
		populationResults: [{ index: 0, status: "completed", entityId: "show-1" }],
		entityGroups: [
			{
				itemIndex: 0,
				entityRef: showRef,
				collectionMemberships: [],
				events: [
					{
						subjectEntityId: "episode-1",
						eventSchemaSlug: "progress",
						properties: { progressPercent: 100 },
						occurredAt: "2026-01-01T00:00:00.000Z",
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
		{
			itemIndex: 0,
			sourceLabel: "Lost",
			sourceIdentifier: "20",
			entitySchemaSlug: "show",
			stage: "provider_resolution",
			message: "Could not resolve show episode S1E99",
		},
	]);
	expect(chunk.items).toMatchObject([
		{
			entities: [{ alias: "media", entityId: "show-1", entitySchemaSlug: "show" }],
			events: [
				{ entityAlias: "media", eventSchemaSlug: "progress", subjectEntityId: "episode-1" },
				{ entityAlias: "media", eventSchemaSlug: "backlog" },
			],
		},
	]);
	expect(chunk.items[0]?.events[1]).not.toHaveProperty("subjectEntityId");
	expect(JSON.stringify(chunk)).not.toContain("unresolvedEpisode");
});

it("turns missing and failed population results into staged failures without writing the item", () => {
	const chunk = createMediaImportChunk({
		failures: [],
		populationResults: [
			{ index: 1, status: "failed", stage: "membership", message: "Collection write failed" },
			{ index: 2, status: "failed", stage: "population", message: "Provider details failed" },
		],
		entityGroups: [0, 1, 2].map((itemIndex) => ({
			itemIndex,
			entityRef: showRef,
			collectionMemberships: [],
			events: [],
		})),
	});

	expect(chunk.items).toEqual([]);
	expect(chunk.failures).toEqual([
		{
			itemIndex: 0,
			sourceLabel: "Lost",
			sourceIdentifier: "20",
			entitySchemaSlug: "show",
			stage: "provider_resolution",
			message: "Media entity could not be resolved",
		},
		{
			itemIndex: 1,
			sourceLabel: "Lost",
			sourceIdentifier: "20",
			entitySchemaSlug: "show",
			stage: "database_commit",
			message: "Collection write failed",
		},
		{
			itemIndex: 2,
			sourceLabel: "Lost",
			sourceIdentifier: "20",
			entitySchemaSlug: "show",
			stage: "provider_details",
			message: "Provider details failed",
		},
	]);
});

it("emits ownership and collection memberships as generic intents", () => {
	const chunk = createMediaImportChunk({
		failures: [],
		populationResults: [{ index: 0, status: "completed", entityId: "show-1" }],
		entityGroups: [
			{
				itemIndex: 0,
				events: [],
				entityRef: showRef,
				ownershipProvider: "watcharr",
				collectionMemberships: [{ collectionName: "Pinned" }],
			},
		],
	});

	expect(chunk.items[0]).toMatchObject({
		ownerships: [{ entityAlias: "media", provider: "watcharr" }],
		collectionMemberships: [{ entityAlias: "media", collectionName: "Pinned" }],
	});
});
