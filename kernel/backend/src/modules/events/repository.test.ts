import { expect, it } from "@effect/vitest";
import { EntityId, EventId, EventSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";

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

it.effect("restores archived events as one batched insert and skips empty batches", () => {
	const inserts: Array<ReadonlyArray<Record<string, unknown>>> = [];
	const db = {
		insert: () => ({
			values: (values: ReadonlyArray<Record<string, unknown>>) => {
				inserts.push(values);
				return Effect.void;
			},
		}),
	};
	const batch = [restoreEventInput("event-1"), restoreEventInput("event-2")];

	return Effect.gen(function* () {
		const repository = yield* EventsRepository;
		yield* repository.restoreEvents(batch);
		yield* repository.restoreEvents([]);
		expect(inserts).toEqual([batch]);
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				EventsRepository.layer,
				Layer.succeed(Database, Object.assign(Object.create(null), db)),
			),
		),
	);
});

it.effect("pages backup history by ID with a fixed bounded query size", () => {
	const limits: number[] = [];
	const rows = Array.from({ length: BACKUP_EVENT_PAGE_SIZE }, (_, index) => ({
		properties: {},
		sessionEntityId: null,
		eventSchemaSlug: "event",
		entityId: `entity-${index}`,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		occurredAt: new Date("2026-01-01T00:00:00.000Z"),
		id: `event-${index.toString().padStart(4, "0")}`,
	}));
	const db = {
		select: () => ({
			from: () => ({
				where: () => ({
					orderBy: () => ({
						limit: (limit: number) => {
							limits.push(limit);
							return Effect.succeed(rows);
						},
					}),
				}),
			}),
		}),
	};
	return Effect.gen(function* () {
		const repository = yield* EventsRepository;
		for (let page = 0; page < 20; page += 1) {
			expect(
				(yield* repository.listUserEventsForBackup({
					userId: UserId.make("user-id"),
					afterId: EventId.make(`event-${page.toString().padStart(4, "0")}`),
				})).length,
			).toBe(BACKUP_EVENT_PAGE_SIZE);
		}
		expect(limits).toEqual(Array.from({ length: 20 }, () => BACKUP_EVENT_PAGE_SIZE));
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				EventsRepository.layer,
				Layer.succeed(Database, Object.assign(Object.create(null), db)),
			),
		),
	);
});
