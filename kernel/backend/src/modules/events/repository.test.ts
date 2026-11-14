import { expect } from "bun:test";

import { DbError } from "@ryot-app/contract/errors";
import { EntityId, EventId, EventSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, DateTime, Effect, Layer, Ref } from "effect";

import { BackupRestorePersistence } from "#modules/backups/restore/persistence";
import { PluginConfigEncryptionKey } from "#modules/plugins/configuration/encryption-key";
import { PluginConfigRevisions } from "#modules/plugins/configuration/revisions";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { fakeDatabaseSession } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { BACKUP_EVENT_PAGE_SIZE, EventsRepository } from "./repository";

const restoreEventInput = (id: string) => ({
	references: [],
	id: EventId.make(id),
	sessionEntityId: null,
	properties: { rating: 80 },
	userId: UserId.make("user-id"),
	entityId: EntityId.make("entity-id"),
	eventSchemaSlug: EventSchemaSlug.make("review"),
	createdAt: new Date("2024-01-01T00:00:00.000Z"),
	updatedAt: new Date("2024-02-01T00:00:00.000Z"),
	occurredAt: new Date("2023-12-01T00:00:00.000Z"),
});

class RecordedDatabaseCalls extends Context.Service<
	RecordedDatabaseCalls,
	{
		readonly limits: Effect.Effect<ReadonlyArray<number>>;
		readonly inserts: Effect.Effect<ReadonlyArray<ReadonlyArray<Record<string, unknown>>>>;
	}
>()("@ryot-app/kernel-backend/modules/events/repository.test/RecordedDatabaseCalls") {}

const recordingDatabaseLayer = <A, E, R>(
	make: (db: {
		readonly select: () => unknown;
		readonly insert: () => {
			readonly values: (values: ReadonlyArray<Record<string, unknown>>) => Effect.Effect<void>;
		};
	}) => Layer.Layer<A, E, R>,
	rows: ReadonlyArray<Record<string, unknown>> = [],
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const inserts = yield* Ref.make<ReadonlyArray<ReadonlyArray<Record<string, unknown>>>>([]);
			const limits = yield* Ref.make<ReadonlyArray<number>>([]);
			return Layer.merge(
				make({
					insert: () => ({ values: (values) => Ref.update(inserts, (all) => [...all, values]) }),
					select: () => ({
						from: () => {
							const query = {
								where: () => ({
									orderBy: () => ({
										limit: (limit: number) =>
											Ref.update(limits, (all) => [...all, limit]).pipe(Effect.as(rows)),
									}),
								}),
							};
							return { ...query, innerJoin: () => query };
						},
					}),
				}),
				Layer.succeed(RecordedDatabaseCalls, {
					limits: Ref.get(limits),
					inserts: Ref.get(inserts),
				}),
			);
		}),
	);

const backupRows = Array.from({ length: BACKUP_EVENT_PAGE_SIZE }, (_, index) => ({
	properties: {},
	sessionEntityId: null,
	eventSchemaSlug: "event",
	entityId: `entity-${index}`,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	occurredAt: new Date("2026-01-01T00:00:00.000Z"),
	id: `event-${index.toString().padStart(4, "0")}`,
}));

const restorePersistenceLayer = BackupRestorePersistence.layer.pipe(
	Layer.provideMerge(
		PluginInstallationRepository.layer.pipe(
			Layer.provideMerge(
				PluginConfigRevisions.layer.pipe(Layer.provide(PluginConfigEncryptionKey.layer)),
			),
		),
	),
	Layer.provideMerge(isolatedDatabaseLayer("event_restore_persistence")),
);

layer(restorePersistenceLayer)((test) => {
	test.effect(
		"restores source events without changing history",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const batch = [restoreEventInput("event-1"), restoreEventInput("event-2")];
				const persistence = yield* BackupRestorePersistence;
				yield* session.run((db) =>
					db
						.insert(tables.user)
						.values({ id: "user-id", name: "Restore owner", email: "restore-owner@example.test" }),
				);
				yield* session.run((db) =>
					db
						.insert(tables.entity)
						.values({
							id: "entity-id",
							userId: "user-id",
							name: "Restored entity",
							entitySchemaSlug: "record",
						}),
				);
				yield* session.transaction(persistence.restoreEvents(batch));

				const listEvents = () =>
					session.run((db) =>
						db
							.select({
								id: tables.event.id,
								userId: tables.event.userId,
								entityId: tables.event.entityId,
								createdAt: tables.event.createdAt,
								updatedAt: tables.event.updatedAt,
								occurredAt: tables.event.occurredAt,
								properties: tables.event.properties,
								eventSchemaSlug: tables.event.eventSchemaSlug,
							})
							.from(tables.event)
							.orderBy(tables.event.id),
					);
				const events = yield* listEvents();
				expect(events).toHaveLength(2);
				expect(events).toEqual([
					{
						id: "event-1",
						userId: "user-id",
						entityId: "entity-id",
						eventSchemaSlug: "review",
						properties: { rating: 80 },
						createdAt: DateTime.toDateUtc(DateTime.makeUnsafe("2024-01-01T00:00:00.000Z")),
						updatedAt: DateTime.toDateUtc(DateTime.makeUnsafe("2024-02-01T00:00:00.000Z")),
						occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe("2023-12-01T00:00:00.000Z")),
					},
					{
						id: "event-2",
						userId: "user-id",
						entityId: "entity-id",
						eventSchemaSlug: "review",
						properties: { rating: 80 },
						createdAt: DateTime.toDateUtc(DateTime.makeUnsafe("2024-01-01T00:00:00.000Z")),
						updatedAt: DateTime.toDateUtc(DateTime.makeUnsafe("2024-02-01T00:00:00.000Z")),
						occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe("2023-12-01T00:00:00.000Z")),
					},
				]);

				yield* session.transaction(persistence.restoreEvents([]));
				const eventsAfterEmptyRestore = yield* listEvents();
				expect(eventsAfterEmptyRestore).toHaveLength(2);
				expect(eventsAfterEmptyRestore).toEqual(events);
			}),
		testTimeout,
	);

	test.effect(
		"indexes restored references regardless of the referenced event's batch position",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const persistence = yield* BackupRestorePersistence;
				const owner = {
					userId: UserId.make("reference-user"),
					entityId: EntityId.make("reference-entity"),
				};
				yield* session.run((db) =>
					db
						.insert(tables.user)
						.values({ id: owner.userId, name: "Reference owner", email: "reference@example.test" }),
				);
				yield* session.run((db) =>
					db
						.insert(tables.entity)
						.values({
							id: owner.entityId,
							userId: owner.userId,
							name: "Referenced entity",
							entitySchemaSlug: "record",
						}),
				);
				const referrer = {
					...restoreEventInput("event-referrer"),
					...owner,
					properties: { about: "event-referenced" },
					references: [{ property: "about", referencedEventId: "event-referenced" }],
				};
				yield* session.transaction(
					persistence.restoreEvents([
						referrer,
						{ ...restoreEventInput("event-referenced"), ...owner },
					]),
				);
				expect(
					yield* session.run((db) =>
						db
							.select({
								property: tables.eventReference.property,
								referencedEventId: tables.eventReference.referencedEventId,
								referencingEventId: tables.eventReference.referencingEventId,
							})
							.from(tables.eventReference),
					),
				).toEqual([
					{
						property: "about",
						referencingEventId: "event-referrer",
						referencedEventId: "event-referenced",
					},
				]);
			}),
		testTimeout,
	);
});

layer(
	recordingDatabaseLayer(
		(db) => EventsRepository.layer.pipe(Layer.provide(fakeDatabaseSession(db))),
		backupRows,
	),
)((test) => {
	test.effect(
		"pages backup history by ID with a fixed bounded query size",
		() =>
			Effect.gen(function* () {
				const repository = yield* EventsRepository;
				for (let page = 0; page < 20; page += 1) {
					expect(
						(yield* repository.listUserEventsForBackup({
							excluded: [],
							userId: UserId.make("user-id"),
							afterId: EventId.make(`event-${page.toString().padStart(4, "0")}`),
						})).length,
					).toBe(BACKUP_EVENT_PAGE_SIZE);
				}
				expect(yield* (yield* RecordedDatabaseCalls).limits).toEqual(
					Array.from({ length: 20 }, () => BACKUP_EVENT_PAGE_SIZE),
				);
			}),
		testTimeout,
	);
});

layer(
	EventsRepository.layer.pipe(Layer.provideMerge(isolatedDatabaseLayer("event_repository_writes"))),
)((test) => {
	test.effect(
		"requires an active transaction for event writes",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const repository = yield* EventsRepository;
				const userId = UserId.make("event-write-owner");
				const entityId = EntityId.make("event-write-entity");
				yield* session.run((db) =>
					db
						.insert(tables.user)
						.values({ id: userId, name: "Event owner", email: "event-write@example.test" }),
				);
				yield* session.run((db) =>
					db
						.insert(tables.entity)
						.values({ id: entityId, name: "Source", entitySchemaSlug: "record" }),
				);
				const event = {
					userId,
					entityId,
					eventSchemaPluginId: null,
					properties: { rating: 5 },
					eventSchemaName: "Review",
					id: EventId.make("event-write"),
					propertiesSchema: { fields: {} },
					eventSchemaSlug: EventSchemaSlug.make("review"),
					occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-01T00:00:00.000Z")),
				};
				const transactionError = yield* Effect.flip(repository.createEvent(event));
				expect(transactionError).toBeInstanceOf(DbError);
				expect(transactionError.message).toBe("Event writes require an active transaction");
				expect((yield* session.transaction(repository.createEvent(event))).id).toBe(event.id);
			}),
		testTimeout,
	);
});

layer(
	EventsRepository.layer.pipe(Layer.provideMerge(isolatedDatabaseLayer("event_backup_exclusions"))),
)((test) => {
	test.effect(
		"omits excluded event schemas from backup history by exact owner",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const repository = yield* EventsRepository;
				yield* session.run((db) =>
					db
						.insert(tables.user)
						.values({ id: "user-id", name: "Backup owner", email: "backup-owner@example.test" }),
				);
				yield* session.run((db) =>
					db.insert(tables.entity).values([
						{ id: "library", name: "Library", userId: "user-id", entitySchemaSlug: "library" },
						{ id: "record", name: "Record", userId: "user-id", entitySchemaSlug: "record" },
					]),
				);
				const occurredAt = DateTime.toDateUtc(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"));
				yield* session.run((db) =>
					db.insert(tables.event).values([
						{
							occurredAt,
							properties: {},
							userId: "user-id",
							entityId: "library",
							id: "event-checkpoint",
							eventSchemaSlug: "checkpoint",
						},
						{
							occurredAt,
							properties: {},
							userId: "user-id",
							entityId: "record",
							eventSchemaSlug: "checkpoint",
							id: "event-other-entity-schema",
						},
						{
							occurredAt,
							properties: {},
							userId: "user-id",
							id: "event-review",
							entityId: "library",
							eventSchemaSlug: "review",
						},
					]),
				);
				const ids = (
					excluded: Parameters<typeof repository.listUserEventsForBackup>[0]["excluded"],
				) =>
					Effect.map(
						repository.listUserEventsForBackup({ excluded, userId: UserId.make("user-id") }),
						(rows) => rows.map(({ id }) => id),
					);
				expect(
					yield* ids([{ pluginId: null, slug: "checkpoint", entitySchemaSlug: "library" }]),
				).toEqual(["event-other-entity-schema", "event-review"]);
				expect(
					yield* ids([{ slug: "checkpoint", pluginId: "plugin-id", entitySchemaSlug: "library" }]),
				).toEqual(["event-checkpoint", "event-other-entity-schema", "event-review"]);
			}),
		testTimeout,
	);
});
