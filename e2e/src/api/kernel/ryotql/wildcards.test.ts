import type { IncludeResult, RowItem } from "@ryot/contract/modules/ryotql/language";
import {
	column,
	document,
	eq,
	field,
	include,
	join,
	literal,
	rows,
	star,
	table,
} from "@ryot/ryotql";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntityFixture,
	createEventFixture,
	createEventSchema,
	createPluginEntitySchema,
	executeRyotQL,
	requireRows,
	requireRyotQLValue,
	waitForEventWithSchema,
	type Client,
} from "~/fixtures/kernel";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const requireInclude = (item: RowItem, key: string): IncludeResult => {
	const value = item[key];
	if (!isIncludeResult(value)) {
		throw new Error(`Expected '${key}' include`);
	}
	return value;
};

const isIncludeResult = (value: unknown): value is IncludeResult => {
	if (
		typeof value !== "object" ||
		value === null ||
		!("items" in value) ||
		!("pageInfo" in value) ||
		!Array.isArray(value.items)
	) {
		return false;
	}
	const pageInfo = value.pageInfo;
	return (
		typeof pageInfo === "object" &&
		pageInfo !== null &&
		"limit" in pageInfo &&
		"hasMore" in pageInfo &&
		typeof pageInfo.limit === "number" &&
		typeof pageInfo.hasMore === "boolean" &&
		value.items.every((item) => typeof item === "object" && item !== null && !Array.isArray(item))
	);
};

const createFixture = (client: Client, name: string) =>
	Effect.gen(function* () {
		const entitySchema = yield* createPluginEntitySchema(client, {
			schemaName: `${name}-${crypto.randomUUID()}`,
		});
		const eventSchema = yield* createEventSchema(client, {
			name: `${name} Event`,
			entitySchemaSlug: entitySchema.schemaId,
			slug: `${name.toLowerCase()}-${crypto.randomUUID()}`,
			propertiesSchema: {
				fields: { rating: { type: "integer", label: "Rating", description: "Rating" } },
			},
		});
		const entity = yield* createEntityFixture(client, {
			name: `${name} Entity`,
			entitySchemaSlug: entitySchema.schemaId,
		});
		yield* createEventFixture(client, {
			entityId: entity.id,
			properties: { rating: 5 },
			eventSchemaSlug: eventSchema.slug,
			occurredAt: "2026-08-01T00:00:00.000Z",
		});
		const event = yield* waitForEventWithSchema(client, entity.id, eventSchema.slug);
		return { entity, event, eventSchemaSlug: eventSchema.slug };
	});

describe("RyotQL wildcard projections", () => {
	it.live("selects only the qualified table fields at a joined root", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fixture = yield* createFixture(client, "RyotQLWildcardRoot");
			const event = table("event", "event");
			const entity = table("entity", "entity");

			const result = yield* executeRyotQL(
				client,
				document({
					events: rows(event, {
						fields: [star(event), field("entityName", column(entity, "name"))],
						where: eq(column(event, "eventSchemaSlug"), literal(fixture.eventSchemaSlug)),
						joins: [join("inner", entity, eq(column(event, "entityId"), column(entity, "id")))],
					}),
				}),
			);

			const events = requireRows(result.data["events"], "events");
			const item = events.items[0];
			assertPresent(item, "Expected wildcard event");
			expect(Object.keys(item).sort()).toEqual(
				[
					"createdAt",
					"entityId",
					"entityName",
					"eventSchemaSlug",
					"id",
					"occurredAt",
					"properties",
					"sessionEntityId",
					"updatedAt",
					"userId",
				].sort(),
			);
			expect(requireRyotQLValue(item, "id")).toBe(fixture.event.id);
			expect(requireRyotQLValue(item, "entityId")).toBe(fixture.entity.id);
			expect(requireRyotQLValue(item, "entityName")).toBe("RyotQLWildcardRoot Entity");
			expect(requireRyotQLValue(item, "properties")).toEqual({ rating: 5 });
			expect(requireRyotQLValue(item, "occurredAt")).toBe("2026-08-01T00:00:00.000Z");
			expect(requireRyotQLValue(item, "sessionEntityId")).toBeNull();
			expect(item["name"]).toBeUndefined();
		}),
	);

	it.live("expands root and nested include wildcards with plain values", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fixture = yield* createFixture(client, "RyotQLWildcardInclude");
			const entity = table("entity", "entity");
			const event = table("event", "event");
			const events = include(event, {
				limit: 10,
				key: "events",
				fields: [star(event)],
				orderBy: [{ direction: "asc", expr: column(event, "occurredAt") }],
				where: eq(column(event, "entityId"), column(entity, "id")),
			});

			const result = yield* executeRyotQL(
				client,
				document({
					entities: rows(entity, {
						include: [events],
						fields: [star(entity)],
						where: eq(column(entity, "id"), literal(fixture.entity.id)),
					}),
				}),
			);

			const entities = requireRows(result.data["entities"], "entities");
			const entityItem = entities.items[0];
			assertPresent(entityItem, "Expected wildcard entity");
			expect(Object.keys(entityItem).sort()).toEqual(
				[
					"createdAt",
					"entitySchemaSlug",
					"events",
					"externalId",
					"id",
					"name",
					"populatedAt",
					"properties",
					"providerId",
					"translationStatus",
					"updatedAt",
					"userId",
				].sort(),
			);
			expect(requireRyotQLValue(entityItem, "name")).toBe("RyotQLWildcardInclude Entity");
			expect(requireRyotQLValue(entityItem, "properties")).toEqual({});

			const includedEvents = requireInclude(entityItem, "events");
			expect(includedEvents.pageInfo).toEqual({ limit: 10, hasMore: false });
			const includedEvent = includedEvents.items[0];
			assertPresent(includedEvent, "Expected wildcard included event");
			expect(Object.keys(includedEvent).sort()).toEqual(
				[
					"createdAt",
					"entityId",
					"eventSchemaSlug",
					"id",
					"occurredAt",
					"properties",
					"sessionEntityId",
					"updatedAt",
					"userId",
				].sort(),
			);
			expect(requireRyotQLValue(includedEvent, "id")).toBe(fixture.event.id);
			expect(requireRyotQLValue(includedEvent, "properties")).toEqual({ rating: 5 });
		}),
	);
});
