import { Schema } from "@ryot-app/sandbox-sdk/effect";
import { genericImportChunkSchema } from "@ryot-app/sandbox-sdk/imports";
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

it("keeps source record identities when groups move between write batches", () => {
	const groups = [4, 29].map((itemIndex) => ({
		itemIndex,
		events: [],
		entityRef: showRef,
		collectionMemberships: [],
	}));
	const together = createMediaImportChunk(
		{
			failures: [],
			entityGroups: groups,
			populationResults: groups.map((_, index) => ({
				index,
				entityId: "show-1",
				status: "completed" as const,
			})),
		},
		ownershipSyncedAt,
	);
	const separate = groups.flatMap(
		(group) =>
			createMediaImportChunk(
				{
					failures: [],
					entityGroups: [group],
					populationResults: [{ index: 0, entityId: "show-1", status: "completed" }],
				},
				ownershipSyncedAt,
			).items,
	);

	expect(separate).toEqual(together.items);
	expect(new Set(separate.map(({ recordId }) => recordId)).size).toBe(2);
});

it("writes finalized episode subjects and keeps plugin-private episode data out of the chunk", () => {
	const chunk = createMediaImportChunk(
		{
			populationResults: [{ index: 0, entityId: "show-1", status: "completed" }],
			failures: [
				{
					itemIndex: 0,
					sourceLabel: "Lost",
					sourceIdentifier: "20",
					entitySchemaSlug: "show",
					stage: "provider_resolution",
					operationId: "source-failure",
					message: "Could not resolve show episode S1E99",
				},
			],
			entityGroups: [
				{
					itemIndex: 0,
					entityRef: showRef,
					collectionMemberships: [],
					events: [
						{
							operationId: "event-1",
							eventSchemaSlug: "progress",
							subjectEntityId: "episode-1",
							properties: { progressPercent: 100 },
							occurredAt: "2026-01-01T00:00:00.000Z",
						},
						{
							properties: {},
							operationId: "event-2",
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
			unit: "records",
			recordKind: "media",
			sourceLabel: "Lost",
			sourceIdentifier: "20",
			entitySchemaSlug: "show",
			stage: "provider_resolution",
			operationId: "source-failure",
			message: "Could not resolve show episode S1E99",
		},
	]);
	expect(chunk.items).toMatchObject([
		{
			events: [
				{ entityAlias: "media", eventSchemaSlug: "progress", subjectEntityId: "episode-1" },
				{ entityAlias: "media", eventSchemaSlug: "backlog" },
			],
			entities: [
				{ alias: "media", entityId: "show-1", entitySchemaSlug: "show" },
				{
					scope: "user",
					existingOnly: true,
					alias: "media-library",
					entitySchemaSlug: "media-library",
				},
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
			unit: "records",
			recordKind: "media",
			sourceLabel: "Lost",
			sourceIdentifier: "20",
			entitySchemaSlug: "show",
			stage: "provider_resolution",
			operationId: '["media",0,"entity"]',
			message: "Media entity could not be resolved",
		},
		{
			itemIndex: 1,
			unit: "records",
			recordKind: "media",
			sourceLabel: "Lost",
			sourceIdentifier: "20",
			entitySchemaSlug: "show",
			stage: "provider_details",
			message: "Provider details failed",
			operationId: '["media",1,"entity"]',
		},
	]);
});

it("gives each failed event of an unresolved group its own operation identity", () => {
	const chunk = createMediaImportChunk(
		{
			failures: [],
			populationResults: [],
			entityGroups: [
				{
					itemIndex: 5,
					entityRef: showRef,
					collectionMemberships: [],
					events: ["complete", "review"].map((eventSchemaSlug) => ({
						properties: {},
						eventSchemaSlug,
						occurredAt: "2026-01-01T00:00:00.000Z",
						operationId: `source-${eventSchemaSlug}`,
					})),
				},
			],
		},
		ownershipSyncedAt,
	);

	expect(chunk.failures.map(({ operationId }) => operationId)).toEqual([
		"source-complete",
		"source-review",
	]);
	expect(() => Schema.decodeSync(genericImportChunkSchema)(chunk)).not.toThrow();
});

it("emits library membership and ownership as a generic relationship mutation", () => {
	const chunk = createMediaImportChunk(
		{
			failures: [],
			populationResults: [{ index: 0, entityId: "show-1", status: "completed" }],
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
		collectionMemberships: [
			{
				entityAlias: "media",
				collectionName: "Pinned",
				operationId: '["media",0,"collection","Pinned"]',
			},
		],
		entities: [
			{ alias: "media" },
			{
				scope: "user",
				existingOnly: true,
				alias: "media-library",
				entitySchemaSlug: "media-library",
			},
		],
		relationships: [
			{
				sourceAlias: "media",
				propertiesMode: "merge",
				targetAlias: "media-library",
				relationshipSchemaSlug: "in-media-library",
				properties: { owned: true, ownershipSyncedAt, ownershipSources: ["watcharr"] },
			},
		],
	});
});

it("emits membership without ownership properties for unowned media", () => {
	const chunk = createMediaImportChunk(
		{
			failures: [],
			populationResults: [{ index: 0, entityId: "show-1", status: "completed" }],
			entityGroups: [{ events: [], itemIndex: 0, entityRef: showRef, collectionMemberships: [] }],
		},
		ownershipSyncedAt,
	);

	expect(chunk.items[0]?.relationships).toEqual([
		{
			properties: {},
			sourceAlias: "media",
			propertiesMode: "merge",
			targetAlias: "media-library",
			relationshipSchemaSlug: "in-media-library",
			operationId: '["media",0,"library-membership"]',
		},
	]);
});
