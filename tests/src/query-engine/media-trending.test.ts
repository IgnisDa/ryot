import { describe, expect, it } from "bun:test";

import { buildTrendingMediaQueryDocument } from "@ryot/query-engine";

import {
	createAuthenticatedClient,
	createGlobalBookEntityFixture,
	executeQueryEngine,
	findBuiltinSchemaBySlug,
	insertGlobalRelationship,
	listRelationshipSchemas,
	requireQueryEngineFieldValue,
	requireRelationshipSchemaBySlug,
} from "../fixtures";
import { assertPresent } from "../test-support/assertions";

describe("Query engine media trending", () => {
	it("reads trending media from persisted media-trending self edges", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(client, "book");
		const [top, second, notTrending] = await Promise.all([
			createGlobalBookEntityFixture(client, {
				name: `Trending Top ${crypto.randomUUID()}`,
				externalId: `trending-top-${crypto.randomUUID()}`,
			}),
			createGlobalBookEntityFixture(client, {
				name: `Trending Second ${crypto.randomUUID()}`,
				externalId: `trending-second-${crypto.randomUUID()}`,
			}),
			createGlobalBookEntityFixture(client, {
				name: `Trending Excluded ${crypto.randomUUID()}`,
				externalId: `trending-excluded-${crypto.randomUUID()}`,
			}),
		]);
		const fetchedAt = new Date(
			Date.UTC(2026, 6, 1) + Math.floor(Math.random() * 1000000),
		).toISOString();
		const relationshipSchemas = await listRelationshipSchemas(client, {
			slugs: ["media-trending"],
		});
		const mediaTrending = requireRelationshipSchemaBySlug(relationshipSchemas, "media-trending");

		await Promise.all([
			insertGlobalRelationship({
				sourceEntityId: second.entity.id,
				targetEntityId: second.entity.id,
				properties: { rank: 2, fetchedAt },
				relationshipSchemaId: mediaTrending.id,
			}),
			insertGlobalRelationship({
				sourceEntityId: top.entity.id,
				targetEntityId: top.entity.id,
				properties: { rank: 1, fetchedAt },
				relationshipSchemaId: mediaTrending.id,
			}),
		]);

		const doc = buildTrendingMediaQueryDocument({
			fetchedAt,
			entitySchemaSlug: schema.slug,
			limit: 10,
		});

		const result = await executeQueryEngine(client, doc);

		expect(result.data.items).toHaveLength(2);
		const [first, secondRow] = result.data.items;
		assertPresent(first, "Expected first trending row");
		assertPresent(secondRow, "Expected second trending row");
		expect(requireQueryEngineFieldValue(first, "id").value).toBe(top.entity.id);
		expect(requireQueryEngineFieldValue(first, "name").value).toBe(top.entity.name);
		expect(requireQueryEngineFieldValue(first, "schemaSlug").value).toBe(schema.slug);
		expect(requireQueryEngineFieldValue(first, "rank").value).toBe(1);
		expect(requireQueryEngineFieldValue(first, "fetchedAt").value).toBe(fetchedAt);
		expect(requireQueryEngineFieldValue(secondRow, "id").value).toBe(second.entity.id);
		expect(requireQueryEngineFieldValue(secondRow, "rank").value).toBe(2);
		expect(
			result.data.items.map((item) => requireQueryEngineFieldValue(item, "id").value),
		).not.toContain(notTrending.entity.id);
	});
});
