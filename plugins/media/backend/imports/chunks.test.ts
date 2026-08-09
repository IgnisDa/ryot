import { expect, it } from "vitest";

import { createMediaImportChunk } from "./chunks";

const ownershipSyncedAt = "2026-01-04T00:00:00.000Z";

const showRef = {
	kind: "resolved",
	externalId: "20",
	sourceLabel: "Lost",
	entitySchemaSlug: "show",
	providerSlug: "show.tmdb",
} as const;

it("writes finalized episode subjects and keeps plugin-private episode data out of the chunk", () => {
	const chunk = createMediaImportChunk(
		{
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
							eventSchemaSlug: "progress",
							subjectEntityId: "episode-1",
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
		},
		ownershipSyncedAt,
	);

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
			entities: [
				{ alias: "media", entityId: "show-1", entitySchemaSlug: "show" },
				{ alias: "library", scope: "user", existingOnly: true, entitySchemaSlug: "library" },
			],
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
	const chunk = createMediaImportChunk(
		{
			failures: [],
			populationResults: [
				{ index: 1, status: "failed", stage: "population", message: "Provider details failed" },
			],
			entityGroups: [0, 1].map((itemIndex) => ({
				itemIndex,
				events: [],
				entityRef: showRef,
				collectionMemberships: [],
			})),
		},
		ownershipSyncedAt,
	);

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
			stage: "provider_details",
			message: "Provider details failed",
		},
	]);
});

it("emits library membership and ownership as a generic relationship mutation", () => {
	const chunk = createMediaImportChunk(
		{
			failures: [],
			populationResults: [{ index: 0, status: "completed", entityId: "show-1" }],
			entityGroups: [
				{
					events: [],
					itemIndex: 0,
					entityRef: showRef,
					ownershipProvider: "watcharr",
					collectionMemberships: [{ collectionName: "Pinned" }],
				},
			],
		},
		ownershipSyncedAt,
	);

	expect(chunk.items[0]).toMatchObject({
		collectionMemberships: [{ entityAlias: "media", collectionName: "Pinned" }],
		entities: [
			{ alias: "media" },
			{ alias: "library", scope: "user", existingOnly: true, entitySchemaSlug: "library" },
		],
		relationships: [
			{
				sourceAlias: "media",
				targetAlias: "library",
				propertiesMode: "merge",
				relationshipSchemaSlug: "in-library",
				properties: { owned: true, ownershipSyncedAt, ownershipSources: ["watcharr"] },
			},
		],
	});
});

it("emits membership without ownership properties for unowned media", () => {
	const chunk = createMediaImportChunk(
		{
			failures: [],
			populationResults: [{ index: 0, status: "completed", entityId: "show-1" }],
			entityGroups: [{ itemIndex: 0, events: [], entityRef: showRef, collectionMemberships: [] }],
		},
		ownershipSyncedAt,
	);

	expect(chunk.items[0]?.relationships).toEqual([
		{
			properties: {},
			sourceAlias: "media",
			targetAlias: "library",
			propertiesMode: "merge",
			relationshipSchemaSlug: "in-library",
		},
	]);
});
