import { DbError } from "@ryot-app/contract/errors";
import {
	type AutomationEventDraft,
	AutomationEventSnapshot,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { ListedEvent } from "@ryot-app/contract/modules/events/schemas";
import {
	EntityId,
	EventId,
	EventSchemaSlug,
	PluginId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { MutationReceipts } from "#modules/mutations/receipts";

import { EventStreamRepository, type StreamKey } from "./stream-repository";

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

const eventStreamKey = (row: {
	readonly userId: string;
	readonly entityId: string;
	readonly eventSchemaSlug: string;
	readonly eventSchemaPluginId: string | null;
}): StreamKey => ({
	userId: UserId.make(row.userId),
	entityId: EntityId.make(row.entityId),
	eventSchemaSlug: EventSchemaSlug.make(row.eventSchemaSlug),
	eventSchemaPluginId:
		row.eventSchemaPluginId === null ? null : PluginId.make(row.eventSchemaPluginId),
});

const minimumOccurredAt = (before: Date, after: Date) =>
	new Date(Math.min(before.getTime(), after.getTime()));

export class EventsRepository extends Context.Service<EventsRepository>()("EventsRepository", {
	make: Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const requireTransaction = session.requireTransaction.pipe(
			Effect.mapError(() => new DbError({ message: "Event writes require an active transaction" })),
		);
		const receipts = yield* MutationReceipts.make;
		const eventStreams = yield* EventStreamRepository.make;
		const getEventForMutation = Effect.fn("EventsRepository.getEventForMutation")(function* (
			input: EventIdentityInput,
		) {
			const [row] = yield* session.run((db) =>
				db
					.select({
						id: schema.event.id,
						userId: schema.event.userId,
						revision: schema.event.revision,
						entityId: schema.event.entityId,
						occurredAt: schema.event.occurredAt,
						eventSchemaSlug: schema.event.eventSchemaSlug,
						sessionEntityId: schema.event.sessionEntityId,
						eventSchemaPluginId: schema.event.eventSchemaPluginId,
					})
					.from(schema.event)
					.where(and(eq(schema.event.id, input.eventId), eq(schema.event.userId, input.userId)))
					.limit(1),
			);
			return row ?? null;
		});
		const touchEventMutation = Effect.fn("EventsRepository.touchEventMutation")(function* (input: {
			before: StreamKey;
			after: StreamKey;
			beforeOccurredAt: Date;
			afterOccurredAt: Date;
			ownerWorkId?: string;
		}) {
			const occurredAt = minimumOccurredAt(input.beforeOccurredAt, input.afterOccurredAt);
			yield* eventStreams.touch(
				[
					{ ...input.before, occurredAt },
					{ ...input.after, occurredAt },
				],
				input.ownerWorkId,
			);
		});
		const listUserEventsForBackup = Effect.fn("EventsRepository.listUserEventsForBackup")(
			function* (input: { userId: UserId; afterId?: EventId | undefined }) {
				return yield* session.run((db) =>
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
			const [row] = yield* session.run((db) =>
				db
					.select({ id: schema.event.id })
					.from(schema.event)
					.where(eq(schema.event.userId, userId))
					.limit(1),
			);
			return row !== undefined;
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
			yield* requireTransaction;
			const streamKey = eventStreamKey({
				userId: input.userId,
				entityId: input.entityId,
				eventSchemaSlug: input.eventSchemaSlug,
				eventSchemaPluginId: input.eventSchemaPluginId,
			});
			yield* eventStreams.lock([streamKey]);
			const createdAt = yield* DateTime.nowAsDate;
			const [inserted] = yield* session.run((db) =>
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
				const [existing] = yield* session.run((db) =>
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
			if (inserted) {
				yield* eventStreams.touch([{ ...streamKey, occurredAt: inserted.occurredAt }]);
			}

			return toListedEvent({ ...row, eventSchemaName: input.eventSchemaName });
		});

		const listUserEventIdsForEntity = Effect.fn("EventsRepository.listUserEventIdsForEntity")(
			function* (input: { userId: UserId; entityId: EntityId }) {
				const rows = yield* session.run((db) =>
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
		const listEventIdentitiesForEntities = Effect.fn(
			"EventsRepository.listEventIdentitiesForEntities",
		)(function* (entityIds: ReadonlyArray<EntityId>) {
			const ids = [...new Set(entityIds)].sort();
			if (ids.length === 0) {
				return [];
			}
			const rows = yield* session.run((db) =>
				db
					.select({ eventId: schema.event.id, userId: schema.event.userId })
					.from(schema.event)
					.where(
						or(inArray(schema.event.entityId, ids), inArray(schema.event.sessionEntityId, ids)),
					)
					.orderBy(asc(schema.event.userId), asc(schema.event.id)),
			);
			return [
				...new Map(rows.map((row) => [stableStringify([row.userId, row.eventId]), row])).values(),
			].map((row) => ({ userId: UserId.make(row.userId), eventId: EventId.make(row.eventId) }));
		});

		const deleteEvent = Effect.fn("EventsRepository.deleteEvent")(function* (
			input: EventIdentityInput,
		) {
			yield* requireTransaction;
			const current = yield* getEventForMutation(input);
			if (!current) {
				return null;
			}
			const streamKey = eventStreamKey(current);
			yield* eventStreams.lock([streamKey]);
			const [row] = yield* session.run((db) =>
				db
					.delete(schema.event)
					.where(
						and(
							eq(schema.event.id, input.eventId),
							eq(schema.event.userId, input.userId),
							eq(schema.event.revision, current.revision),
							eq(schema.event.entityId, current.entityId),
							eq(schema.event.eventSchemaSlug, current.eventSchemaSlug),
							eq(schema.event.occurredAt, current.occurredAt),
							current.sessionEntityId === null
								? isNull(schema.event.sessionEntityId)
								: eq(schema.event.sessionEntityId, current.sessionEntityId),
							current.eventSchemaPluginId === null
								? isNull(schema.event.eventSchemaPluginId)
								: eq(schema.event.eventSchemaPluginId, current.eventSchemaPluginId),
						),
					)
					.returning({ id: schema.event.id }),
			);
			if (row) {
				yield* touchEventMutation({
					after: streamKey,
					before: streamKey,
					afterOccurredAt: current.occurredAt,
					beforeOccurredAt: current.occurredAt,
				});
			}

			return row ? EventId.make(row.id) : null;
		});

		const deletePreparedEvent = Effect.fn("EventsRepository.deletePreparedEvent")(function* (
			input: EventIdentityInput & {
				before: AutomationEventSnapshot;
				expectedRevision: number;
				ownerWorkId?: string;
			},
		) {
			yield* requireTransaction;
			const current = yield* getEventForMutation(input);
			if (!current) {
				return null;
			}
			const streamKey = eventStreamKey(current);
			yield* eventStreams.lock([streamKey]);
			const [row] = yield* session.run((db) =>
				db
					.delete(schema.event)
					.where(
						and(
							eq(schema.event.id, input.eventId),
							eq(schema.event.userId, input.userId),
							eq(schema.event.revision, input.expectedRevision),
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
			if (row) {
				yield* touchEventMutation({
					after: streamKey,
					before: streamKey,
					beforeOccurredAt: current.occurredAt,
					afterOccurredAt: DateTime.toDate(DateTime.makeUnsafe(input.before.occurredAt)),
					...(input.ownerWorkId === undefined ? {} : { ownerWorkId: input.ownerWorkId }),
				});
			}

			return row ? EventId.make(row.id) : null;
		});

		const updateEventEntityReferences = Effect.fn("EventsRepository.updateEventEntityReferences")(
			function* (input: UpdateEventEntityReferencesInput & { updatedAt: Date }) {
				yield* requireTransaction;
				const current = yield* getEventForMutation(input);
				if (
					!current ||
					(current.entityId !== input.mergeFrom && current.sessionEntityId !== input.mergeFrom)
				) {
					return null;
				}
				const beforeKey = eventStreamKey(current);
				const afterKey = eventStreamKey({
					...current,
					entityId: current.entityId === input.mergeFrom ? input.mergeInto : current.entityId,
				});
				yield* eventStreams.lock([beforeKey, afterKey]);
				const [row] = yield* session.run((db) =>
					db.execute<{ id: string }>(
						sql`
					update "event"
					set
						"updated_at" = ${input.updatedAt},
						"revision" = "revision" + 1,
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
						and "revision" = ${current.revision}
						and "entity_id" = ${current.entityId}
						and "session_entity_id" is not distinct from ${current.sessionEntityId}
						and ("entity_id" = ${input.mergeFrom} or "session_entity_id" = ${input.mergeFrom})
					returning "id"
				`,
						"objects",
					),
				);
				if (row) {
					yield* touchEventMutation({
						after: afterKey,
						before: beforeKey,
						afterOccurredAt: current.occurredAt,
						beforeOccurredAt: current.occurredAt,
					});
				}

				return row ? EventId.make(row.id) : null;
			},
		);

		const updatePreparedEvent = Effect.fn("EventsRepository.updatePreparedEvent")(function* (
			input: EventIdentityInput & {
				before: AutomationEventSnapshot;
				draft: AutomationEventDraft;
				expectedRevision: number;
				updatedAt: Date;
				ownerWorkId?: string;
			},
		) {
			yield* requireTransaction;
			const current = yield* getEventForMutation(input);
			if (!current) {
				return null;
			}
			const beforeKey = eventStreamKey(current);
			const afterKey = eventStreamKey({ ...current, entityId: input.draft.entityId });
			const afterOccurredAt = DateTime.toDate(DateTime.makeUnsafe(input.draft.occurredAt));
			yield* eventStreams.lock([beforeKey, afterKey]);
			const [row] = yield* session.run((db) =>
				db.execute<{ id: string }>(
					sql`
						update "event"
						set
							"updated_at" = ${input.updatedAt},
							"revision" = "revision" + 1,
							"entity_id" = ${input.draft.entityId},
							"session_entity_id" = ${input.draft.sessionEntityId},
							"occurred_at" = ${DateTime.toDate(DateTime.makeUnsafe(input.draft.occurredAt))},
							"properties" = ${JSON.stringify(input.draft.properties)}::jsonb
						where "id" = ${input.eventId}
							and "user_id" = ${input.userId}
							and "revision" = ${input.expectedRevision}
							and "event_schema_slug" = ${input.before.eventSchemaSlug}
							and "entity_id" = ${input.before.entityId}
							and "session_entity_id" is not distinct from ${input.before.sessionEntityId}
						returning "id"
					`,
					"objects",
				),
			);
			if (row) {
				yield* touchEventMutation({
					after: afterKey,
					afterOccurredAt,
					before: beforeKey,
					beforeOccurredAt: current.occurredAt,
					...(input.ownerWorkId === undefined ? {} : { ownerWorkId: input.ownerWorkId }),
				});
			}

			return row ? EventId.make(row.id) : null;
		});

		const lockEventRows = Effect.fn("EventsRepository.lockEventRows")(function* (input: {
			userId: UserId;
			eventIds: ReadonlyArray<EventId>;
		}) {
			const eventIds = [...new Set(input.eventIds)].sort();
			if (eventIds.length === 0) {
				return [];
			}
			yield* eventStreams.lockForEvents(eventIds);
			return yield* session.run((db) =>
				db
					.select({ id: schema.event.id })
					.from(schema.event)
					.where(and(eq(schema.event.userId, input.userId), inArray(schema.event.id, eventIds)))
					.orderBy(asc(schema.event.id))
					.for("update"),
			);
		});

		const getEventRevision = Effect.fn("EventsRepository.getEventRevision")(function* (
			input: EventIdentityInput,
		) {
			const [row] = yield* session.run((db) =>
				db
					.select({ revision: schema.event.revision })
					.from(schema.event)
					.where(and(eq(schema.event.id, input.eventId), eq(schema.event.userId, input.userId)))
					.limit(1),
			);
			return row?.revision ?? null;
		});

		const getEventSnapshot = Effect.fn("EventsRepository.getEventSnapshot")(function* (
			input: EventIdentityInput,
		) {
			const [row] = yield* session.run((db) =>
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
			return event;
		});
		const getCreateProgress = Effect.fn("EventsRepository.getCreateProgress")(function* (
			userId: UserId,
			executionId: string,
		) {
			const progress = yield* receipts.countWrittenEvents(userId, executionId);
			const requiredIds = progress.dispatch.flatMap(({ runs }) =>
				runs.flatMap((run) => (run.delivery === "required" ? [run.id] : [])),
			);
			const rows = requiredIds.length
				? yield* session.run((db) =>
						db
							.select({ status: schema.automationRun.status })
							.from(schema.automationRun)
							.where(inArray(schema.automationRun.id, requiredIds)),
					)
				: [];
			return {
				writtenCount: progress.writtenCount,
				requiredPending: rows.some((row) => row.status === "queued" || row.status === "running"),
			};
		});

		return {
			deleteEvent,
			createEvent,
			hasUserEvents,
			lockEventRows,
			getEventRevision,
			getEventSnapshot,
			getCreateProgress,
			deletePreparedEvent,
			updatePreparedEvent,
			listUserEventsForBackup,
			listUserEventIdsForEntity,
			updateEventEntityReferences,
			listEventIdentitiesForEntities,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
