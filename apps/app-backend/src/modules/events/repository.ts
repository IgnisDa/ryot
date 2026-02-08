import { DbError } from "@ryot/contract/errors";
import type { ListedEvent } from "@ryot/contract/modules/events/schemas";
import type { UserId } from "@ryot/contract/schema/brands";
import { EntityId, EventId, EventSchemaSlug } from "@ryot/contract/schema/brands";
import { and, eq, isNull, or, sql } from "drizzle-orm";
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
	| "eventSchemaSlug"
	| "sessionEntityId"
> & {
	readonly eventSchemaName: string;
};

export type EventIdentityInput = {
	readonly eventId: EventId;
	readonly userId: UserId;
};

export type UpdateEventEntityReferencesInput = EventIdentityInput & {
	readonly mergeFrom: EntityId;
	readonly mergeInto: EntityId;
};

const createdEventSelection = {
	id: schema.event.id,
	entityId: schema.event.entityId,
	createdAt: schema.event.createdAt,
	updatedAt: schema.event.updatedAt,
	occurredAt: schema.event.occurredAt,
	properties: schema.event.properties,
	eventSchemaSlug: schema.event.eventSchemaSlug,
	sessionEntityId: schema.event.sessionEntityId,
};

const toListedEvent = (row: EventRow): ListedEvent => ({
	id: EventId.make(row.id),
	entityId: EntityId.make(row.entityId),
	properties: row.properties,
	eventSchemaSlug: EventSchemaSlug.make(row.eventSchemaSlug),
	eventSchemaName: row.eventSchemaName,
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
				];
				if (input.eventSchemaSlug) {
					conditions.push(eq(schema.event.eventSchemaSlug, input.eventSchemaSlug));
				}

				const rows = yield* dbEffect(() =>
					db
						.select({
							eventSchemaSlug: schema.event.eventSchemaSlug,
							entitySchemaSlug: schema.entity.entitySchemaSlug,
						})
						.from(schema.event)
						.innerJoin(schema.entity, eq(schema.event.entityId, schema.entity.id))
						.where(and(...conditions))
						.orderBy(schema.entity.entitySchemaSlug, schema.event.eventSchemaSlug),
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
			sessionEntityId?: EntityId | undefined;
			eventSchemaSlug: EventSchemaSlug;
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
						eventSchemaSlug: input.eventSchemaSlug,
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
			});
		});

		const listUserEventIdsForEntity = Effect.fn("EventsRepository.listUserEventIdsForEntity")(
			function* (input: { userId: UserId; entityId: EntityId }) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select({ id: schema.event.id })
						.from(schema.event)
						.where(
							and(
								eq(schema.event.userId, input.userId),
								or(
									eq(schema.event.entityId, input.entityId),
									eq(schema.event.sessionEntityId, input.entityId),
								),
							),
						)
						.for("update"),
				);

				return rows.map((row) => EventId.make(row.id));
			},
		);

		const deleteEvent = Effect.fn("EventsRepository.deleteEvent")(function* (
			input: EventIdentityInput,
		) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.delete(schema.event)
					.where(and(eq(schema.event.id, input.eventId), eq(schema.event.userId, input.userId)))
					.returning({ id: schema.event.id }),
			);

			return row ? EventId.make(row.id) : null;
		});

		const updateEventEntityReferences = Effect.fn("EventsRepository.updateEventEntityReferences")(
			function* (input: UpdateEventEntityReferencesInput) {
				const db = yield* CurrentDb;
				const result = yield* dbEffect(() =>
					db.execute<{ id: string }>(sql`
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
					where "id" = ${input.eventId}
						and "user_id" = ${input.userId}
						and ("entity_id" = ${input.mergeFrom} or "session_entity_id" = ${input.mergeFrom})
					returning "id"
				`),
				);

				const [row] = result.rows;
				return row ? EventId.make(row.id) : null;
			},
		);

		return {
			deleteEvent,
			createEvent,
			listQueryScopesForUser,
			listUserEventIdsForEntity,
			updateEventEntityReferences,
		};
	},
}) {}
