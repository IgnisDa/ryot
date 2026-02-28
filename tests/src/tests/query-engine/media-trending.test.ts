import { buildTrendingMediaQueryDocument } from "@ryot/plugin-media/query-recipes";
import { DateTime, Effect } from "effect";

import {
	createAuthenticatedClient,
	createGlobalBookEntityFixture,
	executeQueryEngine,
	findBuiltinSchemaBySlug,
	insertGlobalRelationship,
	listRelationshipSchemas,
	requireQueryEngineFieldValue,
	requireRelationshipSchemaBySlug,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("Query engine media trending", () => {
	it.live("reads trending media from persisted media-trending self edges", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(client, "book");
			const [top, second, notTrending] = yield* Effect.all([
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
			const fetchedAt = DateTime.formatIso(
				DateTime.unsafeMake(Date.UTC(2026, 6, 1) + Math.floor(Math.random() * 1000000)),
			);
			const relationshipSchemas = yield* listRelationshipSchemas(client, {
				slugs: ["media-trending"],
			});
			const mediaTrending = requireRelationshipSchemaBySlug(relationshipSchemas, "media-trending");

			yield* Effect.all([
				insertGlobalRelationship({
					sourceEntityId: second.entity.id,
					targetEntityId: second.entity.id,
					properties: { rank: 2, fetchedAt },
					relationshipSchemaSlug: mediaTrending.id,
				}),
				insertGlobalRelationship({
					sourceEntityId: top.entity.id,
					targetEntityId: top.entity.id,
					properties: { rank: 1, fetchedAt },
					relationshipSchemaSlug: mediaTrending.id,
				}),
			]);

			const doc = buildTrendingMediaQueryDocument({
				fetchedAt,
				entitySchemaSlug: schema.slug,
				limit: 10,
			});

			const result = yield* executeQueryEngine(client, doc);

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
		}),
	);
});
