import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { EntityId, EventId, EventSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { Context, DateTime, Effect, Layer, Ref } from "effect";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { fakeDatabaseSession } from "#lib/test-utils/effect";
import { isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";
import { BackupRestorePersistence } from "#modules/backups/restore/persistence";
import { restorePersistenceWithDatabase } from "#modules/backups/restore/persistence.test-support";
import { EventStreamRepository } from "#modules/events/stream-repository";

import { BACKUP_EVENT_PAGE_SIZE, EventsRepository } from "./repository";

const restoreEventInput = (id: string) => ({
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
		readonly inserts: Effect.Effect<ReadonlyArray<ReadonlyArray<Record<string, unknown>>>>;
		readonly limits: Effect.Effect<ReadonlyArray<number>>;
	}
>()("test/RecordedDatabaseCalls") {}

const recordingDatabaseLayer = <A, E, R>(
	make: (db: {
		readonly insert: () => {
			readonly values: (values: ReadonlyArray<Record<string, unknown>>) => Effect.Effect<void>;
		};
		readonly select: () => unknown;
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
						from: () => ({
							where: () => ({
								orderBy: () => ({
									limit: (limit: number) =>
										Ref.update(limits, (all) => [...all, limit]).pipe(Effect.as(rows)),
								}),
							}),
						}),
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

layer(recordingDatabaseLayer(restorePersistenceWithDatabase))((test) => {
	test.effect("restores archived events as one batched insert and skips empty batches", () =>
		Effect.gen(function* () {
			const batch = [restoreEventInput("event-1"), restoreEventInput("event-2")];
			const persistence = yield* BackupRestorePersistence;
			yield* persistence.restoreEvents(batch);
			yield* persistence.restoreEvents([]);
			expect(yield* (yield* RecordedDatabaseCalls).inserts).toEqual([batch]);
		}),
	);
});

layer(
	recordingDatabaseLayer(
		(db) => EventsRepository.layer.pipe(Layer.provide(fakeDatabaseSession(db))),
		backupRows,
	),
)((test) => {
	test.effect("pages backup history by ID with a fixed bounded query size", () =>
		Effect.gen(function* () {
			const repository = yield* EventsRepository;
			for (let page = 0; page < 20; page += 1) {
				expect(
					(yield* repository.listUserEventsForBackup({
						userId: UserId.make("user-id"),
						afterId: EventId.make(`event-${page.toString().padStart(4, "0")}`),
					})).length,
				).toBe(BACKUP_EVENT_PAGE_SIZE);
			}
			expect(yield* (yield* RecordedDatabaseCalls).limits).toEqual(
				Array.from({ length: 20 }, () => BACKUP_EVENT_PAGE_SIZE),
			);
		}),
	);
});

const eventRepositoryStreamLayer = Layer.mergeAll(
	EventsRepository.layer,
	EventStreamRepository.layer,
).pipe(Layer.provideMerge(isolatedDatabaseLayer("event_repository_stream_mutations")));

layer(eventRepositoryStreamLayer)((test) => {
	test.effect("requires transactions and touches streams only for committed event writes", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* EventsRepository;
			const streams = yield* EventStreamRepository;
			const userId = UserId.make("event-stream-owner");
			const sourceEntityId = EntityId.make("event-stream-source");
			const targetEntityId = EntityId.make("event-stream-target");
			const eventSchemaSlug = EventSchemaSlug.make("review");
			const occurredAt = DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-01T00:00:00.000Z"));
			const sourceKey = {
				userId,
				eventSchemaSlug,
				entityId: sourceEntityId,
				eventSchemaPluginId: null,
			};
			const targetKey = { ...sourceKey, entityId: targetEntityId };
			yield* session.run((db) =>
				db
					.insert(tables.user)
					.values({ id: userId, name: "Event owner", email: "event-stream@example.test" }),
			);
			yield* session.run((db) =>
				db.insert(tables.entity).values([
					{ name: "Source", id: sourceEntityId, entitySchemaSlug: "record" },
					{ name: "Target", id: targetEntityId, entitySchemaSlug: "record" },
				]),
			);
			const event = {
				userId,
				occurredAt,
				eventSchemaSlug,
				entityId: sourceEntityId,
				eventSchemaPluginId: null,
				properties: { rating: 5 },
				eventSchemaName: "Review",
				id: EventId.make("event-stream-write"),
			};
			expect(yield* session.isTransactionActive).toBe(false);
			const transactionError = yield* Effect.flip(repository.createEvent(event));
			expect(transactionError).toBeInstanceOf(DbError);
			expect(transactionError.message).toBe("Event writes require an active transaction");
			const inserted = yield* session.transaction(
				Effect.gen(function* () {
					expect(yield* session.isTransactionActive).toBe(true);
					return yield* repository.createEvent(event);
				}),
			);
			expect(inserted.id).toBe(event.id);
			const request = (key: typeof sourceKey) =>
				streams.request({
					key,
					outputProperties: ["rating"],
					accountToken: "event-stream-account",
					pluginRevisionId: "event-stream-revision",
					processorScriptId: "event-stream-processor",
					pluginPin: { revisionId: "event-stream-revision" },
				});
			const sourceStreamId = yield* session.transaction(request(sourceKey));
			const targetStreamId = yield* session.transaction(request(targetKey));
			const sourceBeforeMove = yield* streams.get(sourceStreamId);
			const targetBeforeMove = yield* streams.get(targetStreamId);
			assert(sourceBeforeMove);
			assert(targetBeforeMove);
			expect(sourceBeforeMove.streamRevision).toBe(1);
			expect(targetBeforeMove.streamRevision).toBe(0);
			yield* session.transaction(repository.createEvent(event));
			expect((yield* streams.get(sourceStreamId))?.streamRevision).toBe(
				sourceBeforeMove.streamRevision,
			);

			yield* session.transaction(
				repository.updateEventEntityReferences({
					userId,
					eventId: event.id,
					mergeFrom: sourceEntityId,
					mergeInto: targetEntityId,
					updatedAt: DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-02T00:00:00.000Z")),
				}),
			);
			expect((yield* streams.get(sourceStreamId))?.streamRevision).toBe(
				sourceBeforeMove.streamRevision + 1,
			);
			expect((yield* streams.get(targetStreamId))?.streamRevision).toBe(
				targetBeforeMove.streamRevision + 1,
			);

			expect(
				yield* session.transaction(repository.deleteEvent({ userId, eventId: event.id })),
			).toBe(event.id);
			expect((yield* streams.get(targetStreamId))?.streamRevision).toBe(
				targetBeforeMove.streamRevision + 2,
			);
		}),
	);
});
