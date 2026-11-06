import { DbError } from "@ryot-app/contract/errors";
import {
	type AutomationEventDraft,
	AutomationEventSnapshot,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type {
	EventWritePrecondition,
	ListedEvent,
} from "@ryot-app/contract/modules/events/schemas";
import {
	EntityId,
	EventId,
	EventSchemaSlug,
	PluginId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, asc, eq, getTableColumns, gt, inArray, or, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { chunksOf } from "effect/Array";

import { FoldMarks, type FoldSource } from "#modules/derived-values/marks";
import { STATEMENT_CHUNK_SIZE } from "#modules/entities/repository";
import { pluginIdWhere } from "#platform/db/definition-owner";
import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

export type EventIdentityInput = {
	readonly userId: UserId;
	readonly eventId: EventId;
	readonly expected?: undefined | EventWritePrecondition;
};

export type UpdateEventEntityReferencesInput = EventIdentityInput & {
	readonly mergeFrom: EntityId;
	readonly mergeInto: EntityId;
	readonly properties?: Readonly<Record<string, unknown>>;
	readonly references?: ReadonlyArray<{ readonly from: EntityId; readonly into: EntityId }>;
};

type EventRow = { readonly eventSchemaName: string } & Pick<
	typeof schema.event.$inferSelect,
	| "id"
	| "entityId"
	| "createdAt"
	| "updatedAt"
	| "occurredAt"
	| "properties"
	| "eventSchemaSlug"
	| "sessionEntityId"
	| "eventSchemaPluginId"
>;

export const BACKUP_EVENT_PAGE_SIZE = 500;

export type BackupExcludedEventSchema = {
	readonly slug: string;
	readonly pluginId: null | string;
	readonly entitySchemaSlug: string;
};
export const RESTORE_EVENT_BATCH_SIZE = 1_000;

const createdEventSelection = {
	id: schema.event.id,
	entityId: schema.event.entityId,
	orderKey: schema.event.orderKey,
	createdAt: schema.event.createdAt,
	updatedAt: schema.event.updatedAt,
	occurredAt: schema.event.occurredAt,
	properties: schema.event.properties,
	orderCreatedAt: schema.event.orderCreatedAt,
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
	eventSchemaPluginId:
		row.eventSchemaPluginId === null ? null : PluginId.make(row.eventSchemaPluginId),
});

const snapshotSelection = {
	...createdEventSelection,
	revision: schema.event.revision,
	entitySchemaSlug: schema.entity.entitySchemaSlug,
	entitySchemaPluginId: schema.entity.entitySchemaPluginId,
};

type EventSource = FoldSource & {
	readonly properties?: undefined | Readonly<Record<string, unknown>>;
};

type CreateEventInput = {
	readonly id: EventId;
	readonly userId: UserId;
	readonly occurredAt: Date;
	readonly entityId: EntityId;
	readonly eventSchemaName: string;
	readonly eventSchemaSlug: EventSchemaSlug;
	readonly eventSchemaPluginId: null | string;
	readonly properties: Record<string, unknown>;
	readonly sessionEntityId?: EntityId | undefined;
	readonly order?: undefined | { readonly key: string; readonly createdAt: string };
};

const eventSourceOf = (row: {
	readonly userId: string;
	readonly entityId: string;
	readonly eventSchemaSlug: string;
	readonly eventSchemaPluginId: null | string;
	readonly sessionEntityId?: null | string | undefined;
}): EventSource => ({
	userId: row.userId,
	entityId: row.entityId,
	eventSchemaSlug: row.eventSchemaSlug,
	sessionEntityId: row.sessionEntityId ?? null,
	eventSchemaPluginId: row.eventSchemaPluginId,
});

/** Locks the entity and session rows of event sources in ID order, before any event row. */
export const lockEventReferences = (
	session: DatabaseSession["Service"],
	sources: ReadonlyArray<EventSource>,
) => {
	const ids = [
		...new Set(
			sources.flatMap((source) =>
				source.sessionEntityId ? [source.entityId, source.sessionEntityId] : [source.entityId],
			),
		),
	];
	return ids.length === 0
		? Effect.void
		: Effect.asVoid(
				session.run((db) =>
					db.execute(sql`select id from entity
						where id in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))
						order by id collate "C" for no key update`),
				),
			);
};

export class EventsRepository extends Context.Service<EventsRepository>()(
	"@ryot-app/kernel-backend/modules/events/repository/EventsRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const requireTransaction = session.requireTransaction.pipe(
				Effect.mapError(
					() => new DbError({ message: "Event writes require an active transaction" }),
				),
			);
			const folds = yield* FoldMarks.make;
			const touchScopes = Effect.fn("EventsRepository.touchScopes")(function* (
				rows: ReadonlyArray<{
					userId: string;
					entityId: string;
					sessionEntityId: null | string;
					eventSchemaPluginId: null | string;
				}>,
			) {
				const scopes = new Map(
					rows.flatMap((row) =>
						[...new Set([row.entityId, row.sessionEntityId].filter((id) => id !== null))].map(
							(entityId) => {
								const id = sha256Hex(
									stableStringify([row.userId, row.eventSchemaPluginId, entityId]),
								);
								return [
									id,
									{
										id,
										entityId,
										userId: row.userId,
										eventSchemaPluginId: row.eventSchemaPluginId,
									},
								] as const;
							},
						),
					),
				);
				for (const [, scope] of [...scopes].sort(([a], [b]) => {
					if (a === b) {
						return 0;
					}
					return a < b ? -1 : 1;
				})) {
					yield* session.run((db) =>
						db
							.insert(schema.eventScope)
							.values({ ...scope, revision: 1 })
							.onConflictDoUpdate({
								target: schema.eventScope.id,
								set: { revision: sql`${schema.eventScope.revision} + 1` },
							}),
					);
				}
			});
			const sourcesForEvents = Effect.fn("EventsRepository.sourcesForEvents")(function* (
				eventIds: ReadonlyArray<EventId>,
				sources: ReadonlyArray<EventSource> = [],
			) {
				const ids = [...new Set(eventIds)].sort();
				if (ids.length === 0) {
					return sources;
				}
				const rows = yield* session.run((db) =>
					db
						.select({
							userId: schema.event.userId,
							entityId: schema.event.entityId,
							sessionEntityId: schema.event.sessionEntityId,
							eventSchemaSlug: schema.event.eventSchemaSlug,
							eventSchemaPluginId: schema.event.eventSchemaPluginId,
						})
						.from(schema.event)
						.where(inArray(schema.event.id, ids)),
				);
				return [...sources, ...rows.map(eventSourceOf)];
			});
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
							properties: schema.event.properties,
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
			const touchEventMutation = (input: { after: EventSource; before: EventSource }) =>
				folds.mark([input.before, input.after]);
			const listUserEventsForBackup = Effect.fn("EventsRepository.listUserEventsForBackup")(
				function* (input: {
					userId: UserId;
					limit?: number;
					afterId?: EventId | undefined;
					excluded: ReadonlyArray<BackupExcludedEventSchema>;
				}) {
					return yield* session.run((db) =>
						db
							.select({
								...getTableColumns(schema.event),
								entitySchemaSlug: schema.entity.entitySchemaSlug,
								entitySchemaPluginId: schema.entity.entitySchemaPluginId,
							})
							.from(schema.event)
							.innerJoin(schema.entity, eq(schema.entity.id, schema.event.entityId))
							.where(
								and(
									eq(schema.event.userId, input.userId),
									input.afterId ? gt(schema.event.id, input.afterId) : undefined,
									...input.excluded.map(
										(excluded) =>
											sql`not coalesce(${and(
												eq(schema.event.eventSchemaSlug, excluded.slug),
												eq(schema.entity.entitySchemaSlug, excluded.entitySchemaSlug),
												pluginIdWhere(schema.event.eventSchemaPluginId, excluded.pluginId),
												pluginIdWhere(schema.entity.entitySchemaPluginId, excluded.pluginId),
											)}, false)`,
									),
								),
							)
							.orderBy(asc(schema.event.id))
							.limit(input.limit ?? BACKUP_EVENT_PAGE_SIZE),
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

			const createEvents = Effect.fn("EventsRepository.createEvents")(function* (
				inputs: ReadonlyArray<CreateEventInput>,
			) {
				yield* requireTransaction;
				if (inputs.length === 0) {
					return [];
				}
				yield* lockEventReferences(session, inputs.map(eventSourceOf));
				const createdAt = yield* DateTime.nowAsDate;
				const inserted = yield* session.run((db) =>
					db
						.insert(schema.event)
						.values(
							inputs.map((input) => ({
								createdAt,
								id: input.id,
								updatedAt: createdAt,
								userId: input.userId,
								entityId: input.entityId,
								properties: input.properties,
								occurredAt: input.occurredAt,
								orderKey: input.order?.key ?? null,
								eventSchemaSlug: input.eventSchemaSlug,
								sessionEntityId: input.sessionEntityId ?? null,
								eventSchemaPluginId: input.eventSchemaPluginId,
								orderCreatedAt: input.order
									? DateTime.toDate(DateTime.makeUnsafe(input.order.createdAt))
									: null,
							})),
						)
						.onConflictDoNothing()
						.returning(createdEventSelection),
				);
				const insertedIds = new Set(inserted.map(({ id }) => id));
				const missing = inputs.filter((input) => !insertedIds.has(input.id));
				const existing =
					missing.length === 0
						? []
						: yield* session.run((db) =>
								db
									.select({ ...createdEventSelection, userId: schema.event.userId })
									.from(schema.event)
									.where(
										inArray(
											schema.event.id,
											missing.map(({ id }) => id),
										),
									),
							);
				const rows = new Map(
					[
						...inserted,
						...existing.filter((row) =>
							missing.some((input) => input.id === row.id && input.userId === row.userId),
						),
					].map((row) => [row.id, row]),
				);
				const created = [];
				for (const input of inputs) {
					const row = rows.get(input.id);
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
					created.push(toListedEvent({ ...row, eventSchemaName: input.eventSchemaName }));
				}
				const fresh = inputs.filter((input) => insertedIds.has(input.id));
				if (fresh.length > 0) {
					yield* touchScopes(
						fresh.map((input) => ({ ...input, sessionEntityId: input.sessionEntityId ?? null })),
					);
					yield* folds.mark(fresh.map(eventSourceOf));
				}
				return created;
			});
			const createEvent = (input: CreateEventInput) =>
				Effect.flatMap(createEvents([input]), ([created]) =>
					created
						? Effect.succeed(created)
						: new DbError({ message: "Event insert returned no row" }),
				);

			const listUserDataEventReferences = Effect.fn("EventsRepository.listUserDataEventReferences")(
				function* (input: { userId: UserId; entityIds: ReadonlyArray<EntityId> }) {
					const rows = (yield* Effect.forEach(
						chunksOf(input.entityIds, STATEMENT_CHUNK_SIZE),
						(ids) =>
							session.run((db) =>
								db
									.select({
										id: schema.event.id,
										entityId: schema.event.entityId,
										sessionEntityId: schema.event.sessionEntityId,
									})
									.from(schema.event)
									.where(
										and(
											eq(schema.event.userId, input.userId),
											or(
												inArray(schema.event.entityId, ids),
												inArray(schema.event.sessionEntityId, ids),
											),
										),
									)
									.orderBy(asc(schema.event.id)),
							),
					)).flat();
					return [
						...new Map(
							rows.map((row) => [
								row.id,
								{
									id: EventId.make(row.id),
									entityId: EntityId.make(row.entityId),
									sessionEntityId:
										row.sessionEntityId === null ? null : EntityId.make(row.sessionEntityId),
								},
							]),
						).values(),
					].sort((left, right) => left.id.localeCompare(right.id));
				},
			);
			const listSessionEventIds = Effect.fn("EventsRepository.listSessionEventIds")(
				function* (input: {
					userId: UserId;
					eventSchemaSlug: string;
					sessionEntityId: EntityId;
					eventSchemaPluginId: string;
				}) {
					return yield* session
						.run((db) =>
							db
								.select({ id: schema.event.id })
								.from(schema.event)
								.where(
									and(
										eq(schema.event.userId, input.userId),
										eq(schema.event.sessionEntityId, input.sessionEntityId),
										eq(schema.event.eventSchemaSlug, input.eventSchemaSlug),
										eq(schema.event.eventSchemaPluginId, input.eventSchemaPluginId),
									),
								)
								.orderBy(schema.event.id),
						)
						.pipe(Effect.map((rows) => rows.map((row) => EventId.make(row.id))));
				},
			);
			const getScopeRevision = Effect.fn("EventsRepository.getScopeRevision")(function* (input: {
				userId: UserId;
				entityId: EntityId;
				eventSchemaPluginId: string;
			}) {
				const [row] = yield* session.run((db) =>
					db
						.select({ revision: schema.eventScope.revision })
						.from(schema.eventScope)
						.where(
							eq(
								schema.eventScope.id,
								sha256Hex(
									stableStringify([input.userId, input.eventSchemaPluginId, input.entityId]),
								),
							),
						),
				);
				return row?.revision ?? 0;
			});
			const getEventOrder = Effect.fn("EventsRepository.getEventOrder")(function* (
				input: EventIdentityInput,
			) {
				const [row] = yield* session.run((db) =>
					db
						.select({
							revision: schema.event.revision,
							entityId: schema.event.entityId,
							sessionEntityId: schema.event.sessionEntityId,
							eventSchemaPluginId: schema.event.eventSchemaPluginId,
							key: sql<string>`coalesce(${schema.event.orderKey}, ${schema.event.id})`,
							createdAt: sql<string>`coalesce(${schema.event.orderCreatedAt}, ${schema.event.createdAt})::text`,
						})
						.from(schema.event)
						.where(and(eq(schema.event.id, input.eventId), eq(schema.event.userId, input.userId))),
				);
				return row
					? { ...row, createdAt: DateTime.formatIso(DateTime.makeUnsafe(row.createdAt)) }
					: null;
			});
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
				const streamKey = eventSourceOf(current);
				yield* lockEventReferences(session, [streamKey]);
				const [row] = yield* session.run((db) =>
					db
						.delete(schema.event)
						.where(
							and(
								eq(schema.event.id, input.eventId),
								eq(schema.event.userId, input.userId),
								eq(schema.event.revision, current.revision),
							),
						)
						.returning({ id: schema.event.id }),
				);
				if (row) {
					yield* touchScopes([current]);
					yield* touchEventMutation({ after: streamKey, before: streamKey });
				}

				return row ? EventId.make(row.id) : null;
			});

			const deletePreparedEvent = Effect.fn("EventsRepository.deletePreparedEvent")(function* (
				input: EventIdentityInput & { expectedRevision: number },
			) {
				yield* requireTransaction;
				const current = yield* getEventForMutation(input);
				if (!current) {
					return null;
				}
				const streamKey = eventSourceOf(current);
				yield* lockEventReferences(session, [streamKey]);
				const [row] = yield* session.run((db) =>
					db
						.delete(schema.event)
						.where(
							and(
								eq(schema.event.id, input.eventId),
								eq(schema.event.userId, input.userId),
								eq(schema.event.revision, input.expectedRevision),
							),
						)
						.returning({ id: schema.event.id }),
				);
				if (row) {
					yield* touchScopes([current]);
					yield* touchEventMutation({ after: streamKey, before: streamKey });
				}

				return row ? EventId.make(row.id) : null;
			});

			const updateEventEntityReferences = Effect.fn("EventsRepository.updateEventEntityReferences")(
				function* (input: { updatedAt: Date } & UpdateEventEntityReferencesInput) {
					yield* requireTransaction;
					const current = yield* getEventForMutation(input);
					if (
						!current ||
						(current.entityId !== input.mergeFrom && current.sessionEntityId !== input.mergeFrom)
					) {
						return null;
					}
					const beforeKey = eventSourceOf(current);
					const afterKey = eventSourceOf({
						...current,
						entityId: current.entityId === input.mergeFrom ? input.mergeInto : current.entityId,
						sessionEntityId:
							current.sessionEntityId === input.mergeFrom
								? input.mergeInto
								: current.sessionEntityId,
					});
					yield* lockEventReferences(session, [beforeKey, afterKey]);
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
						and ("entity_id" = ${input.mergeFrom} or "session_entity_id" = ${input.mergeFrom})
					returning "id"
				`,
							"objects",
						),
					);
					if (row) {
						yield* touchScopes([
							current,
							{
								...current,
								entityId: current.entityId === input.mergeFrom ? input.mergeInto : current.entityId,
								sessionEntityId:
									current.sessionEntityId === input.mergeFrom
										? input.mergeInto
										: current.sessionEntityId,
							},
						]);
						yield* touchEventMutation({ after: afterKey, before: beforeKey });
					}

					return row ? EventId.make(row.id) : null;
				},
			);

			const updatePreparedEvent = Effect.fn("EventsRepository.updatePreparedEvent")(function* (
				input: EventIdentityInput & {
					updatedAt: Date;
					expectedRevision: number;
					draft: AutomationEventDraft;
					order?: null | undefined | { key: string; createdAt: string };
				},
			) {
				yield* requireTransaction;
				const current = yield* getEventForMutation(input);
				if (!current) {
					return null;
				}
				const beforeKey = eventSourceOf(current);
				const afterKey = eventSourceOf({
					...current,
					entityId: input.draft.entityId,
					sessionEntityId: input.draft.sessionEntityId,
				});
				yield* lockEventReferences(session, [beforeKey, afterKey]);
				const [row] = yield* session.run((db) =>
					db.execute<{ id: string }>(
						sql`
						update "event"
						set
							"updated_at" = ${input.updatedAt},
							"revision" = "revision" + 1,
							"order_key" = case when ${input.order !== undefined} then ${input.order?.key ?? null} else "order_key" end,
							"order_created_at" = case when ${input.order !== undefined} then ${input.order?.createdAt ?? null}::timestamptz else "order_created_at" end,
							"entity_id" = ${input.draft.entityId},
							"session_entity_id" = ${input.draft.sessionEntityId},
							"occurred_at" = ${DateTime.toDate(DateTime.makeUnsafe(input.draft.occurredAt))},
							"properties" = ${JSON.stringify(input.draft.properties)}::jsonb
						where "id" = ${input.eventId}
							and "user_id" = ${input.userId}
							and "revision" = ${input.expectedRevision}
						returning "id"
					`,
						"objects",
					),
				);
				if (row) {
					yield* touchScopes([
						current,
						{
							...current,
							entityId: input.draft.entityId,
							sessionEntityId: input.draft.sessionEntityId,
						},
					]);
					yield* touchEventMutation({ after: afterKey, before: beforeKey });
				}

				return row ? EventId.make(row.id) : null;
			});

			const lockEventRows = Effect.fn("EventsRepository.lockEventRows")(function* (input: {
				userId: UserId;
				eventIds: ReadonlyArray<EventId>;
				sources?: ReadonlyArray<EventSource>;
			}) {
				const eventIds = [...new Set(input.eventIds)].sort();
				yield* lockEventReferences(session, yield* sourcesForEvents(eventIds, input.sources));
				if (eventIds.length === 0) {
					return [];
				}
				return yield* session.run((db) =>
					db
						.select({ id: schema.event.id })
						.from(schema.event)
						.where(and(eq(schema.event.userId, input.userId), inArray(schema.event.id, eventIds)))
						.orderBy(asc(schema.event.id))
						.for("update"),
				);
			});

			const lockMutationReferences = Effect.fn("EventsRepository.lockMutationReferences")(
				function* (input: {
					eventIds: ReadonlyArray<EventId>;
					sources?: ReadonlyArray<EventSource>;
				}) {
					yield* lockEventReferences(
						session,
						yield* sourcesForEvents(input.eventIds, input.sources),
					);
				},
			);

			const snapshotRows = (userId: UserId, eventIds: ReadonlyArray<EventId>) =>
				session.run((db) =>
					db
						.select(snapshotSelection)
						.from(schema.event)
						.innerJoin(schema.entity, eq(schema.entity.id, schema.event.entityId))
						.where(and(inArray(schema.event.id, [...eventIds]), eq(schema.event.userId, userId))),
				);
			const snapshotOf = Effect.fnUntraced(function* (
				row: Effect.Success<ReturnType<typeof snapshotRows>>[number],
			) {
				if (row.eventSchemaPluginId !== row.entitySchemaPluginId) {
					return yield* new DbError({
						message: "Persisted event owner does not match its containing entity",
					});
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
					eventSchemaPluginId: row.eventSchemaPluginId,
					entitySchemaPluginId: row.entitySchemaPluginId,
				}).pipe(
					Effect.mapError(() => new DbError({ message: "Invalid persisted event snapshot" })),
				);
				return { snapshot: event, revision: row.revision };
			});
			const getEventSnapshot = Effect.fn("EventsRepository.getEventSnapshot")(function* (
				input: EventIdentityInput,
			) {
				const [row] = yield* snapshotRows(input.userId, [input.eventId]);
				return row ? yield* snapshotOf(row) : null;
			});
			const getEventSnapshots = Effect.fn("EventsRepository.getEventSnapshots")(function* (
				userId: UserId,
				eventIds: ReadonlyArray<EventId>,
			) {
				const rows = eventIds.length === 0 ? [] : yield* snapshotRows(userId, eventIds);
				const snapshots = new Map<string, Effect.Success<ReturnType<typeof snapshotOf>>>();
				for (const row of rows) {
					snapshots.set(row.id, yield* snapshotOf(row));
				}
				return snapshots;
			});
			return {
				deleteEvent,
				createEvent,
				createEvents,
				hasUserEvents,
				lockEventRows,
				getEventOrder,
				getEventSnapshot,
				getScopeRevision,
				getEventSnapshots,
				deletePreparedEvent,
				updatePreparedEvent,
				listSessionEventIds,
				lockMutationReferences,
				listUserEventsForBackup,
				listUserDataEventReferences,
				updateEventEntityReferences,
				listEventIdentitiesForEntities,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
