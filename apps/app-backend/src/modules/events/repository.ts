import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect, schema } from "../../lib/db";
import { DbError } from "../../lib/errors";
import type { ListedEvent } from "./schemas";

type EventRow = {
	readonly id: string;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly occurredAt: Date;
	readonly entityId: string;
	readonly eventSchemaId: string;
	readonly eventSchemaName: string;
	readonly eventSchemaSlug: string;
	readonly sessionEntityId: string | null;
	readonly properties: Record<string, unknown>;
};

type EventsRepositoryShape = {
	readonly listForUser: (input: {
		userId: string;
		entityId?: string;
		sessionEntityId?: string;
		eventSchemaSlug?: string;
	}) => Effect.Effect<ListedEvent[], DbError, CurrentDb>;
	readonly createEvent: (input: {
		userId: string;
		entityId: string;
		occurredAt: Date;
		eventSchemaId: string;
		eventSchemaName: string;
		eventSchemaSlug: string;
		sessionEntityId?: string;
		properties: Record<string, unknown>;
	}) => Effect.Effect<ListedEvent, DbError, CurrentDb>;
};

const listedEventSelection = {
	id: schema.event.id,
	entityId: schema.event.entityId,
	createdAt: schema.event.createdAt,
	updatedAt: schema.event.updatedAt,
	occurredAt: schema.event.occurredAt,
	properties: schema.event.properties,
	eventSchemaName: schema.eventSchema.name,
	eventSchemaSlug: schema.eventSchema.slug,
	eventSchemaId: schema.event.eventSchemaId,
	sessionEntityId: schema.event.sessionEntityId,
};

const createdEventSelection = {
	id: schema.event.id,
	entityId: schema.event.entityId,
	createdAt: schema.event.createdAt,
	updatedAt: schema.event.updatedAt,
	occurredAt: schema.event.occurredAt,
	properties: schema.event.properties,
	eventSchemaId: schema.event.eventSchemaId,
	sessionEntityId: schema.event.sessionEntityId,
};

const toListedEvent = (row: EventRow): ListedEvent => ({
	id: row.id,
	entityId: row.entityId,
	properties: row.properties,
	eventSchemaId: row.eventSchemaId,
	eventSchemaName: row.eventSchemaName,
	eventSchemaSlug: row.eventSchemaSlug,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	occurredAt: row.occurredAt.toISOString(),
	sessionEntityId: row.sessionEntityId ?? undefined,
});

export class EventsRepository extends Effect.Service<EventsRepository>()("EventsRepository", {
	sync: (): EventsRepositoryShape => ({
		listForUser: (input) =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				const conditions = [eq(schema.event.userId, input.userId)];
				if (input.entityId) {
					conditions.push(eq(schema.event.entityId, input.entityId));
				}
				if (input.sessionEntityId) {
					conditions.push(eq(schema.event.sessionEntityId, input.sessionEntityId));
				}
				if (input.eventSchemaSlug) {
					conditions.push(eq(schema.eventSchema.slug, input.eventSchemaSlug));
				}

				const rows = yield* dbEffect(() =>
					db
						.select(listedEventSelection)
						.from(schema.event)
						.innerJoin(schema.eventSchema, eq(schema.event.eventSchemaId, schema.eventSchema.id))
						.where(and(...conditions))
						.orderBy(
							desc(schema.event.occurredAt),
							desc(schema.event.createdAt),
							desc(schema.event.id),
						),
				);

				return rows.map(toListedEvent);
			}),
		createEvent: (input) =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.insert(schema.event)
						.values({
							userId: input.userId,
							entityId: input.entityId,
							properties: input.properties,
							occurredAt: input.occurredAt,
							eventSchemaId: input.eventSchemaId,
							sessionEntityId: input.sessionEntityId ?? null,
						})
						.returning(createdEventSelection),
				);

				if (!row) {
					return yield* new DbError({ message: "Event insert returned no row" });
				}

				return toListedEvent({
					...row,
					eventSchemaName: input.eventSchemaName,
					eventSchemaSlug: input.eventSchemaSlug,
				});
			}),
	}),
}) {}
