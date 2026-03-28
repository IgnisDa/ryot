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
	requireRyotQLFieldValue,
	waitForEventWithSchema,
	type Client,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const requireInclude = (item: RowItem, key: string): IncludeResult => {
	const value = item[key];
	if (!value || !("items" in value)) {
		throw new Error(`Expected '${key}' include`);
	}
	return value;
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
			expect(requireRyotQLFieldValue(item, "id")).toMatchObject({
				kind: "text",
				value: fixture.event.id,
			});
			expect(requireRyotQLFieldValue(item, "entityId")).toMatchObject({
				kind: "text",
				value: fixture.entity.id,
			});
			expect(requireRyotQLFieldValue(item, "entityName")).toEqual({
				kind: "text",
				value: "RyotQLWildcardRoot Entity",
			});
			expect(requireRyotQLFieldValue(item, "properties")).toEqual({
				kind: "json",
				value: { rating: 5 },
			});
			expect(requireRyotQLFieldValue(item, "occurredAt")).toEqual({
				kind: "date",
				value: "2026-08-01T00:00:00.000Z",
			});
			expect(requireRyotQLFieldValue(item, "sessionEntityId")).toEqual({
				value: null,
				kind: "null",
			});
			expect(item["name"]).toBeUndefined();
		}),
	);

	it.live("expands root and nested include wildcards with runtime kinds", () =>
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
			expect(requireRyotQLFieldValue(entityItem, "name")).toEqual({
				kind: "text",
				value: "RyotQLWildcardInclude Entity",
			});
			expect(requireRyotQLFieldValue(entityItem, "properties")).toEqual({
				value: {},
				kind: "json",
			});

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
			expect(requireRyotQLFieldValue(includedEvent, "id")).toMatchObject({
				kind: "text",
				value: fixture.event.id,
			});
			expect(requireRyotQLFieldValue(includedEvent, "properties")).toEqual({
				kind: "json",
				value: { rating: 5 },
			});
		}),
	);
});
