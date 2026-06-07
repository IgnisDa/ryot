import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect, schema } from "#lib/db";
import { DbError } from "#lib/errors";

import type { EventTriggerMetadata, ListedEvent } from "./schemas";

type EventRow = Pick<
	typeof schema.event.$inferSelect,
	| "id"
	| "entityId"
	| "createdAt"
	| "updatedAt"
	| "occurredAt"
	| "properties"
	| "eventSchemaId"
	| "sessionEntityId"
> & {
	readonly eventSchemaName: (typeof schema.eventSchema.$inferSelect)["name"];
	readonly eventSchemaSlug: (typeof schema.eventSchema.$inferSelect)["slug"];
};

export type BeforeCreateTriggerRow = {
	readonly id: string;
	readonly position: number;
	readonly eventSchemaId: string;
	readonly sandboxScriptId: string;
};

export type AfterCreateTriggerRow = {
	readonly id: string;
	readonly eventSchemaId: string;
	readonly sandboxScriptId: string;
	readonly metadata: EventTriggerMetadata;
};

type EventsDbEffect<A> = Effect.Effect<A, DbError, CurrentDb>;

type EventsRepositoryShape = {
	readonly deleteUserEventsForEntity: (input: {
		userId: string;
		entityId: string;
	}) => EventsDbEffect<number>;
	readonly moveUserEventsBetweenEntities: (input: {
		userId: string;
		mergeFrom: string;
		mergeInto: string;
	}) => EventsDbEffect<number>;
	readonly getActiveBeforeCreateTriggers: (input: {
		userId: string;
		eventSchemaIds: string[];
	}) => EventsDbEffect<BeforeCreateTriggerRow[]>;
	readonly getActiveAfterCreateTriggers: (input: {
		userId: string;
		eventSchemaIds: string[];
	}) => EventsDbEffect<AfterCreateTriggerRow[]>;
	readonly listForUser: (input: {
		userId: string;
		entityId?: string;
		sessionEntityId?: string;
		eventSchemaSlug?: string;
	}) => EventsDbEffect<ListedEvent[]>;
	readonly createEvent: (input: {
		userId: string;
		entityId: string;
		occurredAt: Date;
		eventSchemaId: string;
		eventSchemaName: string;
		eventSchemaSlug: string;
		sessionEntityId?: string;
		properties: Record<string, unknown>;
	}) => EventsDbEffect<ListedEvent>;
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

const toListedEvent = (row: EventRow) => ({
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
		deleteUserEventsForEntity: (input) =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.delete(schema.event)
						.where(
							and(
								eq(schema.event.userId, input.userId),
								or(
									eq(schema.event.entityId, input.entityId),
									eq(schema.event.sessionEntityId, input.entityId),
								),
							),
						)
						.returning({ id: schema.event.id }),
				);

				return rows.length;
			}),
		moveUserEventsBetweenEntities: (input) =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				const result = yield* dbEffect(() =>
					db.execute<{ count: string }>(sql`
						with moved as (
							update "event"
							set
								"entity_id" = case
									when "entity_id" = ${input.mergeFrom} then ${input.mergeInto}
									else "entity_id"
								end,
								"session_entity_id" = case
									when "session_entity_id" = ${input.mergeFrom} then ${input.mergeInto}
									else "session_entity_id"
								end
							where "user_id" = ${input.userId}
								and ("entity_id" = ${input.mergeFrom} or "session_entity_id" = ${input.mergeFrom})
							returning "id"
						)
						select count(*)::text as "count" from moved
					`),
				);

				return Number(result.rows[0]?.count ?? 0);
			}),
		getActiveBeforeCreateTriggers: (input) =>
			Effect.gen(function* () {
				if (input.eventSchemaIds.length === 0) {
					return [];
				}

				const db = yield* CurrentDb;
				return yield* dbEffect(() =>
					db
						.select({
							id: schema.eventSchemaTrigger.id,
							position: schema.eventSchemaTrigger.position,
							eventSchemaId: schema.eventSchemaTrigger.eventSchemaId,
							sandboxScriptId: schema.eventSchemaTrigger.sandboxScriptId,
						})
						.from(schema.eventSchemaTrigger)
						.where(
							and(
								inArray(schema.eventSchemaTrigger.eventSchemaId, input.eventSchemaIds),
								eq(schema.eventSchemaTrigger.isActive, true),
								eq(schema.eventSchemaTrigger.phase, "before_create"),
								or(
									isNull(schema.eventSchemaTrigger.userId),
									eq(schema.eventSchemaTrigger.userId, input.userId),
								),
							),
						)
						.orderBy(schema.eventSchemaTrigger.position),
				);
			}),
		getActiveAfterCreateTriggers: (input) =>
			Effect.gen(function* () {
				if (input.eventSchemaIds.length === 0) {
					return [];
				}

				const db = yield* CurrentDb;
				return yield* dbEffect(() =>
					db
						.select({
							id: schema.eventSchemaTrigger.id,
							metadata: schema.eventSchemaTrigger.metadata,
							eventSchemaId: schema.eventSchemaTrigger.eventSchemaId,
							sandboxScriptId: schema.eventSchemaTrigger.sandboxScriptId,
						})
						.from(schema.eventSchemaTrigger)
						.where(
							and(
								inArray(schema.eventSchemaTrigger.eventSchemaId, input.eventSchemaIds),
								eq(schema.eventSchemaTrigger.isActive, true),
								eq(schema.eventSchemaTrigger.phase, "after_create"),
								or(
									isNull(schema.eventSchemaTrigger.userId),
									eq(schema.eventSchemaTrigger.userId, input.userId),
								),
							),
						),
				);
			}),
	}),
}) {}
