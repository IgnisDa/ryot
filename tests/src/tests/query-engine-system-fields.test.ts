import { describe, expect, it } from "bun:test";

import {
	buildEntityRowsQueryDocument,
	buildEventRowsDoc,
	createAuthenticatedClient,
	createEventSchema,
	createQueryEngineEntity,
	createQueryEngineEvent,
	createQueryEngineTrackerAndSchema,
	executeQueryEngine,
	requireQueryEngineFieldValue,
	systemRef,
} from "../fixtures";
import { getPgClient } from "../setup";
import { assertPresent } from "../test-support/assertions";

const setEntityPopulatedAt = async (entityId: string, isoDate: string) => {
	await getPgClient().query(`update entity set populated_at = $1 where id = $2`, [
		isoDate,
		entityId,
	]);
};

describe("entity system fields covering all entity table columns", () => {
	it("selects, filters, and orders by entitySchemaId, userId, populatedAt, and properties", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "SystemFieldEntity",
			propertiesSchema: {
				fields: { genre: { type: "string", label: "Genre", description: "Genre" } },
			},
		});

		const first = await createQueryEngineEntity(client, {
			name: "Populated First",
			entitySchemaId: schemaId,
			properties: { genre: "scifi" },
		});
		const second = await createQueryEngineEntity(client, {
			name: "Unpopulated Second",
			entitySchemaId: schemaId,
			properties: { genre: "fantasy" },
		});

		await setEntityPopulatedAt(first.id, "2026-01-01T00:00:00.000Z");
		await setEntityPopulatedAt(second.id, "2026-03-01T00:00:00.000Z");

		const result = await executeQueryEngine(
			client,
			buildEntityRowsQueryDocument({
				alias: "item",
				schemas: [slug],
				orderBy: [{ order: "asc", expr: systemRef("item", "populatedAt") }],
				fields: [
					{ key: "name", expr: systemRef("item", "name") },
					{ key: "entitySchemaId", expr: systemRef("item", "entitySchemaId") },
					{ key: "userId", expr: systemRef("item", "userId") },
					{ key: "populatedAt", expr: systemRef("item", "populatedAt") },
					{ key: "properties", expr: systemRef("item", "properties") },
				],
			}),
		);

		expect(result.data.items).toHaveLength(2);

		const populatedFirst = result.data.items[0];
		assertPresent(populatedFirst, "Expected first row");
		expect(requireQueryEngineFieldValue(populatedFirst, "entitySchemaId").value).toBe(schemaId);
		expect(requireQueryEngineFieldValue(populatedFirst, "userId").value).toBe(userId);
		expect(requireQueryEngineFieldValue(populatedFirst, "populatedAt").kind).toBe("date");
		expect(requireQueryEngineFieldValue(populatedFirst, "properties")).toEqual({
			kind: "json",
			value: { genre: "scifi" },
		});

		const unpopulatedSecond = result.data.items[1];
		assertPresent(unpopulatedSecond, "Expected second row");
		expect(requireQueryEngineFieldValue(unpopulatedSecond, "populatedAt").kind).toBe("date");
	});

	it("filters entities by a null populatedAt using isNull", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "PopulatedAtFilterEntity",
		});

		const populated = await createQueryEngineEntity(client, {
			name: "Populated Filter",
			entitySchemaId: schemaId,
		});
		await createQueryEngineEntity(client, {
			name: "Unpopulated Filter",
			entitySchemaId: schemaId,
		});
		await setEntityPopulatedAt(populated.id, "2026-02-01T00:00:00.000Z");

		const result = await executeQueryEngine(
			client,
			buildEntityRowsQueryDocument({
				alias: "item",
				schemas: [slug],
				fields: [{ key: "name", expr: systemRef("item", "name") }],
				where: { type: "isNull", expr: systemRef("item", "populatedAt") },
			}),
		);

		expect(result.data.items).toHaveLength(1);
		const onlyMatch = result.data.items[0];
		assertPresent(onlyMatch, "Expected unpopulated entity row");
		expect(requireQueryEngineFieldValue(onlyMatch, "name").value).toBe("Unpopulated Filter");
	});
});

describe("event system fields covering all event table columns", () => {
	it("selects entityId, eventSchemaId, userId, sessionEntityId, and properties", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "SystemFieldEventEntity",
		});
		const completeSlug = `system-field-complete-${crypto.randomUUID()}`;
		const completeSchema = await createEventSchema(client, {
			slug: completeSlug,
			name: "System Field Complete",
			entitySchemaId: schemaId,
			propertiesSchema: {
				fields: { score: { type: "integer", label: "Score", description: "Score" } },
			},
		});
		const entity = await createQueryEngineEntity(client, {
			entitySchemaId: schemaId,
			name: "System Field Event Entity",
		});
		const sessionEntity = await createQueryEngineEntity(client, {
			name: "Session Entity",
			entitySchemaId: schemaId,
		});

		await createQueryEngineEvent(client, {
			entityId: entity.id,
			properties: { score: 9 },
			eventSchemaId: completeSchema.id,
			sessionEntityId: sessionEntity.id,
			occurredAt: "2026-01-01T00:00:00.000Z",
		});

		const result = await executeQueryEngine(
			client,
			buildEventRowsDoc({
				entityAlias: "item",
				entitySchemas: [slug],
				eventAlias: "completion",
				eventSchemas: [completeSlug],
				orderBy: [{ order: "asc", expr: systemRef("completion", "occurredAt") }],
				fields: [
					{ key: "entityId", expr: systemRef("completion", "entityId") },
					{ key: "eventSchemaId", expr: systemRef("completion", "eventSchemaId") },
					{ key: "userId", expr: systemRef("completion", "userId") },
					{ key: "sessionEntityId", expr: systemRef("completion", "sessionEntityId") },
					{ key: "properties", expr: systemRef("completion", "properties") },
				],
			}),
		);

		expect(result.data.items).toHaveLength(1);
		const item = result.data.items[0];
		assertPresent(item, "Expected event row");
		expect(requireQueryEngineFieldValue(item, "entityId").value).toBe(entity.id);
		expect(requireQueryEngineFieldValue(item, "eventSchemaId").value).toBe(completeSchema.id);
		expect(requireQueryEngineFieldValue(item, "userId").value).toBe(userId);
		expect(requireQueryEngineFieldValue(item, "sessionEntityId").value).toBe(sessionEntity.id);
		expect(requireQueryEngineFieldValue(item, "properties")).toEqual({
			kind: "json",
			value: { score: 9 },
		});
	});

	it("resolves sessionEntityId to null when not set", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "NullSessionEntity",
		});
		const watchSlug = `null-session-watch-${crypto.randomUUID()}`;
		const watchSchema = await createEventSchema(client, {
			slug: watchSlug,
			name: "Null Session Watch",
			entitySchemaId: schemaId,
		});
		const entity = await createQueryEngineEntity(client, {
			entitySchemaId: schemaId,
			name: "Null Session Entity",
		});

		await createQueryEngineEvent(client, {
			entityId: entity.id,
			eventSchemaId: watchSchema.id,
			occurredAt: "2026-01-01T00:00:00.000Z",
		});

		const result = await executeQueryEngine(
			client,
			buildEventRowsDoc({
				eventAlias: "watch",
				entityAlias: "item",
				entitySchemas: [slug],
				eventSchemas: [watchSlug],
				orderBy: [{ order: "asc", expr: systemRef("watch", "occurredAt") }],
				fields: [{ key: "sessionEntityId", expr: systemRef("watch", "sessionEntityId") }],
			}),
		);

		expect(result.data.items).toHaveLength(1);
		const onlyRow = result.data.items[0];
		assertPresent(onlyRow, "Expected event row");
		expect(requireQueryEngineFieldValue(onlyRow, "sessionEntityId")).toEqual({
			kind: "null",
			value: null,
		});
	});

	it("filters events by isNotNull on sessionEntityId", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "SessionFilterEntity",
		});
		const watchSlug = `session-filter-watch-${crypto.randomUUID()}`;
		const watchSchema = await createEventSchema(client, {
			slug: watchSlug,
			entitySchemaId: schemaId,
			name: "Session Filter Watch",
		});
		const entity = await createQueryEngineEntity(client, {
			entitySchemaId: schemaId,
			name: "Session Filter Entity",
		});
		const sessionEntity = await createQueryEngineEntity(client, {
			name: "Session Anchor",
			entitySchemaId: schemaId,
		});

		await createQueryEngineEvent(client, {
			entityId: entity.id,
			eventSchemaId: watchSchema.id,
			occurredAt: "2026-01-01T00:00:00.000Z",
		});
		await createQueryEngineEvent(client, {
			entityId: entity.id,
			eventSchemaId: watchSchema.id,
			sessionEntityId: sessionEntity.id,
			occurredAt: "2026-01-02T00:00:00.000Z",
		});

		const result = await executeQueryEngine(
			client,
			buildEventRowsDoc({
				eventAlias: "watch",
				entityAlias: "item",
				entitySchemas: [slug],
				eventSchemas: [watchSlug],
				orderBy: [{ order: "asc", expr: systemRef("watch", "occurredAt") }],
				where: { type: "isNotNull", expr: systemRef("watch", "sessionEntityId") },
				fields: [
					{ key: "sessionEntityId", expr: systemRef("watch", "sessionEntityId") },
					{ key: "occurredAt", expr: systemRef("watch", "occurredAt") },
				],
			}),
		);

		expect(result.data.items).toHaveLength(1);
		const onlyMatch = result.data.items[0];
		assertPresent(onlyMatch, "Expected session-anchored event row");
		expect(requireQueryEngineFieldValue(onlyMatch, "sessionEntityId").value).toBe(sessionEntity.id);
	});

	it("orders events by entityId descending", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "EntityIdOrderEntity",
		});
		const watchSlug = `entity-id-order-watch-${crypto.randomUUID()}`;
		const watchSchema = await createEventSchema(client, {
			slug: watchSlug,
			entitySchemaId: schemaId,
			name: "Entity Id Order Watch",
		});
		const entityA = await createQueryEngineEntity(client, {
			name: "Entity A",
			entitySchemaId: schemaId,
		});
		const entityB = await createQueryEngineEntity(client, {
			name: "Entity B",
			entitySchemaId: schemaId,
		});

		await createQueryEngineEvent(client, {
			entityId: entityA.id,
			eventSchemaId: watchSchema.id,
			occurredAt: "2026-01-01T00:00:00.000Z",
		});
		await createQueryEngineEvent(client, {
			entityId: entityB.id,
			eventSchemaId: watchSchema.id,
			occurredAt: "2026-01-01T00:00:00.000Z",
		});

		const result = await executeQueryEngine(
			client,
			buildEventRowsDoc({
				eventAlias: "watch",
				entityAlias: "item",
				entitySchemas: [slug],
				eventSchemas: [watchSlug],
				fields: [{ key: "entityId", expr: systemRef("watch", "entityId") }],
				orderBy: [{ order: "desc", expr: systemRef("watch", "entityId") }],
			}),
		);

		expect(result.data.items).toHaveLength(2);
		const ids = result.data.items.map((row) =>
			String(requireQueryEngineFieldValue(row, "entityId").value),
		);
		const expectedDescending = [entityA.id, entityB.id].sort((a, b) => b.localeCompare(a));
		expect(ids).toEqual(expectedDescending);
	});
});
