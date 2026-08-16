import { DbError } from "@ryot-app/contract/errors";
import { AutomationEventSnapshot } from "@ryot-app/contract/modules/automations/lifecycle";
import type { ListedEvent } from "@ryot-app/contract/modules/events/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { EntityId, EventId, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

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
	id: EventId.make(row.id),
	properties: row.properties,
	eventSchemaName: row.eventSchemaName,
	entityId: EntityId.make(row.entityId),
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	occurredAt: row.occurredAt.toISOString(),
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
			id: EventId;
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
			const createdAt = yield* DateTime.nowAsDate;
			const [inserted] = yield* mapDatabaseErrors(
				db
					.insert(schema.event)
					.values({
						createdAt,
						id: input.id,
						updatedAt: createdAt,
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
			if (!row) {
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
			if (
				row.entityId !== input.entityId ||
				row.eventSchemaSlug !== input.eventSchemaSlug ||
				row.eventSchemaPluginId !== input.eventSchemaPluginId ||
				row.sessionEntityId !== (input.sessionEntityId ?? null) ||
				row.occurredAt.toISOString() !== input.occurredAt.toISOString() ||
				stableStringify(row.properties) !== stableStringify(input.properties)
			) {
				return yield* new DbError({ message: "Conflicting event command identity" });
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

		const deletePreparedEvent = Effect.fn("EventsRepository.deletePreparedEvent")(function* (
			input: EventIdentityInput & { before: AutomationEventSnapshot },
		) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.delete(schema.event)
					.where(
						and(
							eq(schema.event.id, input.eventId),
							eq(schema.event.userId, input.userId),
							eq(
								schema.event.updatedAt,
								DateTime.toDateUtc(DateTime.makeUnsafe(input.before.updatedAt)),
							),
							eq(schema.event.entityId, input.before.entityId),
							input.before.sessionEntityId === null
								? isNull(schema.event.sessionEntityId)
								: eq(schema.event.sessionEntityId, input.before.sessionEntityId),
						),
					)
					.returning({ id: schema.event.id }),
			);

			return row ? EventId.make(row.id) : null;
		});

		const updateEventEntityReferences = Effect.fn("EventsRepository.updateEventEntityReferences")(
			function* (input: UpdateEventEntityReferencesInput & { updatedAt: Date }) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db.execute<{ id: string }>(
						sql`
					update "event"
					set
						"updated_at" = ${input.updatedAt},
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

		const updatePreparedEventEntityReferences = Effect.fn(
			"EventsRepository.updatePreparedEventEntityReferences",
		)(function* (
			input: UpdateEventEntityReferencesInput & {
				before: AutomationEventSnapshot;
				updatedAt: Date;
			},
		) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db.execute<{ id: string }>(
					sql`
						update "event"
						set
							"updated_at" = ${input.updatedAt},
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
							and "updated_at" = ${DateTime.toDateUtc(DateTime.makeUnsafe(input.before.updatedAt))}
							and "entity_id" = ${input.before.entityId}
							and "session_entity_id" is not distinct from ${input.before.sessionEntityId}
							and ("entity_id" = ${input.mergeFrom} or "session_entity_id" = ${input.mergeFrom})
						returning "id"
					`,
					"objects",
				),
			);

			return row ? EventId.make(row.id) : null;
		});

		const getEventSnapshot = Effect.fn("EventsRepository.getEventSnapshot")(function* (
			input: EventIdentityInput,
		) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.select({ ...createdEventSelection, entitySchemaSlug: schema.entity.entitySchemaSlug })
					.from(schema.event)
					.innerJoin(schema.entity, eq(schema.entity.id, schema.event.entityId))
					.where(and(eq(schema.event.id, input.eventId), eq(schema.event.userId, input.userId)))
					.for("update", { of: schema.event }),
			);
			if (!row) {
				return null;
			}
			return yield* Schema.decodeUnknownEffect(AutomationEventSnapshot)({
				id: row.id,
				entityId: row.entityId,
				properties: row.properties,
				eventSchemaSlug: row.eventSchemaSlug,
				sessionEntityId: row.sessionEntityId,
				entitySchemaSlug: row.entitySchemaSlug,
				createdAt: row.createdAt.toISOString(),
				updatedAt: row.updatedAt.toISOString(),
				occurredAt: row.occurredAt.toISOString(),
			}).pipe(Effect.mapError(() => new DbError({ message: "Invalid persisted event snapshot" })));
		});
		const getEventCreateReplay = Effect.fn("EventsRepository.getEventCreateReplay")(function* (
			input: EventIdentityInput,
		) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.select({ ...createdEventSelection, entitySchemaSlug: schema.entity.entitySchemaSlug })
					.from(schema.event)
					.innerJoin(schema.entity, eq(schema.entity.id, schema.event.entityId))
					.where(and(eq(schema.event.id, input.eventId), eq(schema.event.userId, input.userId)))
					.for("update", { of: schema.event }),
			);
			if (!row) {
				return null;
			}
			const event = yield* Schema.decodeUnknownEffect(AutomationEventSnapshot)({
				id: row.id,
				entityId: row.entityId,
				properties: row.properties,
				eventSchemaSlug: row.eventSchemaSlug,
				sessionEntityId: row.sessionEntityId,
				entitySchemaSlug: row.entitySchemaSlug,
				createdAt: row.createdAt.toISOString(),
				updatedAt: row.updatedAt.toISOString(),
				occurredAt: row.occurredAt.toISOString(),
			}).pipe(Effect.mapError(() => new DbError({ message: "Invalid persisted event snapshot" })));
			return { event, eventSchemaPluginId: row.eventSchemaPluginId };
		});

		return {
			deleteEvent,
			createEvent,
			restoreEvents,
			hasUserEvents,
			getEventSnapshot,
			deletePreparedEvent,
			getEventCreateReplay,
			listUserEventsForBackup,
			listUserEventIdsForEntity,
			updateEventEntityReferences,
			updatePreparedEventEntityReferences,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
