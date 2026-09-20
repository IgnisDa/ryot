import { expect, layer } from "@effect/vitest";
import { EntityId, EventId, EventSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

import { fakeDatabaseSession } from "#lib/test-utils/effect";
import { BackupRestorePersistence } from "#modules/backups/restore/persistence";
import { restorePersistenceWithDatabase } from "#modules/backups/restore/persistence.test-support";

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
