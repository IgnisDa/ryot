import { expect, it } from "@effect/vitest";
import { EntityId, EventId, EventSchemaSlug, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";

import { BACKUP_EVENT_PAGE_SIZE, EventsRepository } from "./repository";

it.effect("restores an event with its archived identity and timestamps", () => {
	let persisted: Record<string, unknown> | undefined;
	const db = {
		insert: () => ({
			values: (values: Record<string, unknown>) => ({
				returning: () => {
					persisted = values;
					return Effect.succeed([{ id: values["id"] }]);
				},
			}),
		}),
	};
	const input = {
		sessionEntityId: null,
		properties: { rating: 80 },
		id: EventId.make("event-id"),
		userId: UserId.make("user-id"),
		entityId: EntityId.make("entity-id"),
		eventSchemaSlug: EventSchemaSlug.make("review"),
		createdAt: new Date("2024-01-01T00:00:00.000Z"),
		updatedAt: new Date("2024-02-01T00:00:00.000Z"),
		occurredAt: new Date("2023-12-01T00:00:00.000Z"),
	};

	return Effect.gen(function* () {
		const repository = yield* EventsRepository;
		expect(yield* repository.restoreEvent(input)).toBe(input.id);
		expect(persisted).toEqual(input);
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
