import { DbError } from "@ryot/contract/errors";
import type { EventTriggerMetadata, ListedEvent } from "@ryot/contract/modules/events/schemas";
import type { UserId } from "@ryot/contract/schema/brands";
import { EntityId, EventId, EventSchemaId, SandboxScriptId } from "@ryot/contract/schema/brands";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

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
	sync: () => {
		const listQueryScopesForUser = Effect.fn("EventsRepository.listQueryScopesForUser")(
			function* (input: {
				userId: UserId;
				sessionEntityId: EntityId;
				eventSchemaSlug?: string | undefined;
			}) {
				const db = yield* CurrentDb;
				const conditions = [
					eq(schema.event.userId, input.userId),
					eq(schema.event.sessionEntityId, input.sessionEntityId),
					or(eq(schema.entity.userId, input.userId), isNull(schema.entity.userId)),
					or(eq(schema.eventSchema.userId, input.userId), isNull(schema.eventSchema.userId)),
				];
				if (input.eventSchemaSlug) {
					conditions.push(eq(schema.eventSchema.slug, input.eventSchemaSlug));
				}

				const rows = yield* dbEffect(() =>
					db
						.select({
							eventSchemaSlug: schema.eventSchema.slug,
							entitySchemaSlug: schema.entitySchema.slug,
						})
						.from(schema.event)
						.innerJoin(schema.eventSchema, eq(schema.event.eventSchemaId, schema.eventSchema.id))
						.innerJoin(schema.entity, eq(schema.event.entityId, schema.entity.id))
						.innerJoin(
							schema.entitySchema,
							eq(schema.entity.entitySchemaId, schema.entitySchema.id),
						)
						.where(and(...conditions))
						.orderBy(schema.entitySchema.slug, schema.eventSchema.slug),
				);

				const seen = new Set<string>();
				return rows.filter((row) => {
					const key = `${row.entitySchemaSlug}:${row.eventSchemaSlug}`;
					if (seen.has(key)) {
						return false;
					}
					seen.add(key);
					return true;
				});
			},
		);

		const createEvent = Effect.fn("EventsRepository.createEvent")(function* (input: {
			id?: EventId;
			userId: UserId;
			occurredAt: Date;
			entityId: EntityId;
			eventSchemaName: string;
			eventSchemaSlug: string;
			sessionEntityId?: EntityId | undefined;
			eventSchemaId: EventSchemaId;
			properties: Record<string, unknown>;
		}) {
			const db = yield* CurrentDb;
			const [inserted] = yield* dbEffect(() =>
				db
					.insert(schema.event)
					.values({
						id: input.id,
						userId: input.userId,
						entityId: input.entityId,
						properties: input.properties,
						occurredAt: input.occurredAt,
						eventSchemaId: input.eventSchemaId,
						sessionEntityId: input.sessionEntityId ?? null,
					})
					.onConflictDoNothing()
					.returning(createdEventSelection),
			);
			let row = inserted;
			const eventId = input.id;
			if (!row && eventId) {
				const [existing] = yield* dbEffect(() =>
					db
						.select(createdEventSelection)
						.from(schema.event)
						.where(and(eq(schema.event.id, eventId), eq(schema.event.userId, input.userId)))
						.limit(1),
				);
				row = existing;
			}

			if (!row) {
				return yield* new DbError({ message: "Event insert returned no row" });
			}

			return toListedEvent({
				...row,
				eventSchemaName: input.eventSchemaName,
				eventSchemaSlug: input.eventSchemaSlug,
			});
		});

		const deleteUserEventsForEntity = Effect.fn("EventsRepository.deleteUserEventsForEntity")(
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
		);

		const moveUserEventsBetweenEntities = Effect.fn(
			"EventsRepository.moveUserEventsBetweenEntities",
		)(function* (input: { userId: UserId; mergeFrom: EntityId; mergeInto: EntityId }) {
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
		});

		const getActiveBeforeCreateTriggers = Effect.fn(
			"EventsRepository.getActiveBeforeCreateTriggers",
		)(function* (input: { userId: UserId; eventSchemaIds: EventSchemaId[] }) {
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
					.orderBy(schema.eventSchemaTrigger.position, schema.eventSchemaTrigger.id),
			);
			return rows.map((row) => ({
				id: row.id,
				position: row.position,
				eventSchemaId: EventSchemaId.make(row.eventSchemaId),
				sandboxScriptId: SandboxScriptId.make(row.sandboxScriptId),
			}));
		});

		const getActiveAfterCreateTriggers = Effect.fn("EventsRepository.getActiveAfterCreateTriggers")(
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
		);

		return {
			createEvent,
			listQueryScopesForUser,
			deleteUserEventsForEntity,
			getActiveAfterCreateTriggers,
			moveUserEventsBetweenEntities,
			getActiveBeforeCreateTriggers,
		};
	},
}) {}
