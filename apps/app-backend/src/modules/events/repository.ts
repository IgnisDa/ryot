import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";
import * as schema from "#lib/db/schema/tables";
import { DbError } from "#lib/errors";
import type { UserId } from "#lib/schema/brands";
import { EntityId, EventId, EventSchemaId, SandboxScriptId } from "#lib/schema/brands";

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
	readonly eventSchemaId: EventSchemaId;
	readonly sandboxScriptId: SandboxScriptId;
};

export type AfterCreateTriggerRow = {
	readonly id: string;
	readonly eventSchemaId: EventSchemaId;
	readonly metadata: EventTriggerMetadata;
	readonly sandboxScriptId: SandboxScriptId;
};

type EventsDbEffect<A> = Effect.Effect<A, DbError, CurrentDb>;

type EventsRepositoryShape = {
	readonly deleteUserEventsForEntity: (input: {
		userId: UserId;
		entityId: EntityId;
	}) => EventsDbEffect<number>;
	readonly moveUserEventsBetweenEntities: (input: {
		userId: UserId;
		mergeFrom: EntityId;
		mergeInto: EntityId;
	}) => EventsDbEffect<number>;
	readonly getActiveBeforeCreateTriggers: (input: {
		userId: UserId;
		eventSchemaIds: EventSchemaId[];
	}) => EventsDbEffect<BeforeCreateTriggerRow[]>;
	readonly getActiveAfterCreateTriggers: (input: {
		userId: UserId;
		eventSchemaIds: EventSchemaId[];
	}) => EventsDbEffect<AfterCreateTriggerRow[]>;
	readonly listForUser: (input: {
		userId: UserId;
		entityId?: EntityId;
		sessionEntityId?: EntityId;
		eventSchemaSlug?: string;
	}) => EventsDbEffect<ListedEvent[]>;
	readonly createEvent: (input: {
		userId: UserId;
		entityId: EntityId;
		occurredAt: Date;
		eventSchemaId: EventSchemaId;
		eventSchemaName: string;
		eventSchemaSlug: string;
		sessionEntityId?: EntityId;
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
	id: EventId.make(row.id),
	entityId: EntityId.make(row.entityId),
	properties: row.properties,
	eventSchemaId: EventSchemaId.make(row.eventSchemaId),
	eventSchemaName: row.eventSchemaName,
	eventSchemaSlug: row.eventSchemaSlug,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	occurredAt: row.occurredAt.toISOString(),
	sessionEntityId: row.sessionEntityId ? EntityId.make(row.sessionEntityId) : undefined,
});

export class EventsRepository extends Effect.Service<EventsRepository>()("EventsRepository", {
	sync: (): EventsRepositoryShape => ({
		listForUser: Effect.fn("EventsRepository.listForUser")(function* (input: {
			userId: UserId;
			entityId?: EntityId;
			sessionEntityId?: EntityId;
			eventSchemaSlug?: string;
		}) {
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
		createEvent: Effect.fn("EventsRepository.createEvent")(function* (input: {
			userId: UserId;
			entityId: EntityId;
			occurredAt: Date;
			eventSchemaId: EventSchemaId;
			eventSchemaName: string;
			eventSchemaSlug: string;
			sessionEntityId?: EntityId;
			properties: Record<string, unknown>;
		}) {
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
		deleteUserEventsForEntity: Effect.fn("EventsRepository.deleteUserEventsForEntity")(
			function* (input: { userId: UserId; entityId: EntityId }) {
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
			},
		),
		moveUserEventsBetweenEntities: Effect.fn("EventsRepository.moveUserEventsBetweenEntities")(
			function* (input: { userId: UserId; mergeFrom: EntityId; mergeInto: EntityId }) {
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
			},
		),
		getActiveBeforeCreateTriggers: Effect.fn("EventsRepository.getActiveBeforeCreateTriggers")(
			function* (input: { userId: UserId; eventSchemaIds: EventSchemaId[] }) {
				if (input.eventSchemaIds.length === 0) {
					return [];
				}

				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
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
				return rows.map((row) => ({
					id: row.id,
					position: row.position,
					eventSchemaId: EventSchemaId.make(row.eventSchemaId),
					sandboxScriptId: SandboxScriptId.make(row.sandboxScriptId),
				}));
			},
		),
		getActiveAfterCreateTriggers: Effect.fn("EventsRepository.getActiveAfterCreateTriggers")(
			function* (input: { userId: UserId; eventSchemaIds: EventSchemaId[] }) {
				if (input.eventSchemaIds.length === 0) {
					return [];
				}

				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
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
				return rows.map((row) => ({
					id: row.id,
					metadata: row.metadata,
					eventSchemaId: EventSchemaId.make(row.eventSchemaId),
					sandboxScriptId: SandboxScriptId.make(row.sandboxScriptId),
				}));
			},
		),
	}),
}) {}
