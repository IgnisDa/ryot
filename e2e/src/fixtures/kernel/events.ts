import { EntityId, EventId, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	and,
	column,
	descending,
	document,
	eq,
	field,
	literal,
	rows,
	table,
} from "@ryot-app/ryotql";
import { Effect } from "effect";

import { requireObjectRecord } from "~/support/assertions";

import type { Client } from "./auth";
import { createEntity } from "./entities";
import { createPluginSchema } from "./entity-schemas";
import { createEventSchema } from "./event-schemas";
import { pollUntil } from "./polling";
import {
	executeRyotQL,
	requireRows,
	requireRyotQLDate,
	requireRyotQLText,
	requireRyotQLValue,
} from "./ryotql";

export const waitForEventCount = (client: Client, entityId: string, expectedCount: number) =>
	pollUntil(
		`${expectedCount} events on entity ${entityId}`,
		Effect.gen(function* () {
			const events = yield* listEventsForEntity(client, entityId, undefined, 100);
			return events.length >= expectedCount ? events : null;
		}),
	);

export const createEventTestFixture = (client: Client) =>
	Effect.gen(function* () {
		const { schemaId: entitySchemaSlug } = yield* createPluginSchema(client, {
			name: "Test Item",
			slug: `item-${crypto.randomUUID()}`,
		});
		const eventSchema = yield* createEventSchema(client, {
			entitySchemaSlug,
			name: "Finished",
			slug: `finished-${crypto.randomUUID()}`,
			propertiesSchema: {
				fields: {
					rating: {
						label: "Rating",
						type: "number" as const,
						description: "Rating score",
						validation: { required: true as const },
					},
				},
			},
		});
		const entity = yield* createEntity(client, {
			entitySchemaSlug,
			name: "Test Book",
			properties: { title: "Test" },
		});
		return { entityId: entity.id, entitySchemaSlug, eventSchemaSlug: eventSchema.id };
	});

export const createRuleEventFixture = (client: Client) =>
	Effect.gen(function* () {
		const { schemaId: entitySchemaSlug } = yield* createPluginSchema(client, {
			name: "Rule Test Item",
			slug: `rule-item-${crypto.randomUUID()}`,
		});
		const eventSchema = yield* createEventSchema(client, {
			entitySchemaSlug,
			name: "Progress Log",
			slug: `progress-log-${crypto.randomUUID()}`,
			propertiesSchema: {
				fields: {
					progressPercent: {
						type: "number" as const,
						label: "Progress Percent",
						description: "Progress percentage",
					},
					status: {
						label: "Status",
						type: "string" as const,
						description: "Workflow status",
						validation: { required: true as const },
					},
				},
				rules: [
					{
						path: ["progressPercent"],
						kind: "validation" as const,
						validation: { required: true as const },
						when: { path: ["status"], value: "completed", operator: "eq" as const },
					},
				],
			},
		});
		const entity = yield* createEntity(client, {
			entitySchemaSlug,
			name: "Rule Test Book",
			properties: { title: "Rule Test" },
		});
		return { entityId: entity.id, eventSchemaSlug: eventSchema.id };
	});

export const listEventsForEntity = (
	client: Client,
	entityId: string,
	after: string | undefined,
	limit: number,
	options: { eventSchemaSlug?: string } = {},
) =>
	Effect.gen(function* () {
		const event = table("event", "event");
		const entityPredicate = eq(column(event, "entityId"), literal(entityId));
		const where = options.eventSchemaSlug
			? and(entityPredicate, eq(column(event, "eventSchemaSlug"), literal(options.eventSchemaSlug)))
			: entityPredicate;
		const result = yield* executeRyotQL(
			client,
			document({
				events: rows(event, {
					after,
					limit,
					orderBy: [
						descending(column(event, "occurredAt")),
						descending(column(event, "createdAt")),
						descending(column(event, "id")),
					],
					fields: [
						field("id", column(event, "id")),
						field("occurredAt", column(event, "occurredAt")),
						field("properties", column(event, "properties")),
						field("eventSchemaSlug", column(event, "eventSchemaSlug")),
						field("sessionEntityId", column(event, "sessionEntityId")),
					],
					where,
				}),
			}),
		);
		const events = requireRows(result.data.events, "events");

		return events.items.map((item) => {
			const properties = requireRyotQLValue(item, "properties");
			const sessionEntityId = requireRyotQLValue(item, "sessionEntityId");
			if (sessionEntityId !== null && typeof sessionEntityId !== "string") {
				throw new Error("Expected event sessionEntityId to be text or null");
			}
			return {
				occurredAt: requireRyotQLDate(item, "occurredAt"),
				id: EventId.make(requireRyotQLText(item, "id")),
				properties: requireObjectRecord(properties, "Event properties must be an object"),
				eventSchemaSlug: EventSchemaSlug.make(requireRyotQLText(item, "eventSchemaSlug")),
				sessionEntityId:
					typeof sessionEntityId === "string" ? EntityId.make(sessionEntityId) : undefined,
			};
		});
	});

export const waitForEventWithSchema = (client: Client, entityId: string, eventSchemaSlug: string) =>
	pollUntil(
		`${eventSchemaSlug} event on entity ${entityId}`,
		Effect.gen(function* () {
			const events = yield* listEventsForEntity(client, entityId, undefined, 100);
			return events.find((event) => event.eventSchemaSlug === eventSchemaSlug) ?? null;
		}),
	);

export const listEventSlugs = (client: Client, entityId: string) =>
	Effect.gen(function* () {
		const events = yield* listEventsForEntity(client, entityId, undefined, 100);
		return events.map((event) => event.eventSchemaSlug);
	});

export const waitForEventSlugs = (client: Client, entityId: string, requiredSlug: string) =>
	pollUntil(
		`'${requiredSlug}' event on entity ${entityId}`,
		Effect.gen(function* () {
			const slugs = yield* listEventSlugs(client, entityId);
			return slugs.some((slug) => slug === requiredSlug) ? slugs : null;
		}),
	);
