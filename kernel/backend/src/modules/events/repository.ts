import { DbError } from "@ryot-app/contract/errors";
import type { ListedEvent } from "@ryot-app/contract/modules/events/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { EntityId, EventId, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, gt, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

type EventRow = Pick<
	typeof schema.event.$inferSelect,
	| "id"
	| "entityId"
	| "createdAt"
	| "updatedAt"
	| "occurredAt"
	| "properties"
	| "eventSchemaPluginId"
	| "eventSchemaSlug"
	| "sessionEntityId"
> & { readonly eventSchemaName: string };

export type EventIdentityInput = { readonly eventId: EventId; readonly userId: UserId };

export type UpdateEventEntityReferencesInput = EventIdentityInput & {
	readonly mergeFrom: EntityId;
	readonly mergeInto: EntityId;
};

type RestoreEventInput = Pick<
	typeof schema.event.$inferInsert,
	| "id"
	| "userId"
	| "entityId"
	| "createdAt"
	| "updatedAt"
	| "occurredAt"
	| "properties"
	| "eventSchemaPluginId"
	| "eventSchemaSlug"
	| "sessionEntityId"
>;

export const BACKUP_EVENT_PAGE_SIZE = 500;
export const RESTORE_EVENT_BATCH_SIZE = 1_000;

const createdEventSelection = {
	id: schema.event.id,
	entityId: schema.event.entityId,
	createdAt: schema.event.createdAt,
	updatedAt: schema.event.updatedAt,
	occurredAt: schema.event.occurredAt,
	properties: schema.event.properties,
	eventSchemaSlug: schema.event.eventSchemaSlug,
	sessionEntityId: schema.event.sessionEntityId,
	eventSchemaPluginId: schema.event.eventSchemaPluginId,
};

const toListedEvent = (row: EventRow): ListedEvent => ({
	properties: row.properties,
	id: EventId.make(row.id),
	eventSchemaName: row.eventSchemaName,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	occurredAt: row.occurredAt.toISOString(),
	entityId: EntityId.make(row.entityId),
	eventSchemaSlug: EventSchemaSlug.make(row.eventSchemaSlug),
	sessionEntityId: row.sessionEntityId ? EntityId.make(row.sessionEntityId) : undefined,
});

export class EventsRepository extends Context.Service<EventsRepository>()("EventsRepository", {
	make: Effect.sync(() => {
		const listUserEventsForBackup = Effect.fn("EventsRepository.listUserEventsForBackup")(
			function* (input: { userId: UserId; afterId?: EventId | undefined }) {
				const db = yield* Database;
				return yield* mapDatabaseErrors(
					db
						.select(createdEventSelection)
						.from(schema.event)
						.where(
							and(
								eq(schema.event.userId, input.userId),
								input.afterId ? gt(schema.event.id, input.afterId) : undefined,
							),
						)
						.orderBy(asc(schema.event.id))
						.limit(BACKUP_EVENT_PAGE_SIZE),
				);
			},
		);

		const hasUserEvents = Effect.fn("EventsRepository.hasUserEvents")(function* (userId: UserId) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.select({ id: schema.event.id })
					.from(schema.event)
					.where(eq(schema.event.userId, userId))
					.limit(1),
			);
			return row !== undefined;
		});

		const restoreEvents = Effect.fn("EventsRepository.restoreEvents")(function* (
			inputs: ReadonlyArray<RestoreEventInput>,
		) {
			if (inputs.length === 0) {
				return;
			}
			const db = yield* Database;
			yield* mapDatabaseErrors(db.insert(schema.event).values([...inputs]));
		});

		const createEvent = Effect.fn("EventsRepository.createEvent")(function* (input: {
			id?: EventId;
			userId: UserId;
			occurredAt: Date;
			entityId: EntityId;
			eventSchemaName: string;
			eventSchemaSlug: EventSchemaSlug;
			eventSchemaPluginId: string | null;
			properties: Record<string, unknown>;
			sessionEntityId?: EntityId | undefined;
		}) {
			const db = yield* Database;
			const [inserted] = yield* mapDatabaseErrors(
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
						eventSchemaPluginId: input.eventSchemaPluginId,
					})
					.onConflictDoNothing()
					.returning(createdEventSelection),
			);
			let row = inserted;
			const eventId = input.id;
			if (!row && eventId) {
				const [existing] = yield* mapDatabaseErrors(
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

			return toListedEvent({ ...row, eventSchemaName: input.eventSchemaName });
		});

		const listUserEventIdsForEntity = Effect.fn("EventsRepository.listUserEventIdsForEntity")(
			function* (input: { userId: UserId; entityId: EntityId }) {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
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
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.delete(schema.event)
					.where(and(eq(schema.event.id, input.eventId), eq(schema.event.userId, input.userId)))
					.returning({ id: schema.event.id }),
			);

			return row ? EventId.make(row.id) : null;
		});

		const updateEventEntityReferences = Effect.fn("EventsRepository.updateEventEntityReferences")(
			function* (input: UpdateEventEntityReferencesInput) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db.execute<{ id: string }>(
						sql`
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
				`,
						"objects",
					),
				);

				return row ? EventId.make(row.id) : null;
			},
		);

		return {
			deleteEvent,
			createEvent,
			restoreEvents,
			hasUserEvents,
			listUserEventsForBackup,
			listUserEventIdsForEntity,
			updateEventEntityReferences,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
