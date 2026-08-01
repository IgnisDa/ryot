import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";

import { UserLifecycleRepository } from "./repository";

it.effect("normalizes persisted lifecycle rows to the wire operation", () => {
	const row = {
		metadata: {},
		failure: null,
		userId: "user-1",
		id: "operation-1",
		workflowAttempt: 1,
		kind: "reset" as const,
		status: "completed" as const,
		accessRevocationStartedAt: null,
		createdAt: new Date("2026-08-24T00:00:00.000Z"),
		startedAt: new Date("2026-08-24T00:00:01.000Z"),
		finishedAt: new Date("2026-08-24T00:00:03.000Z"),
		accessRevokedAt: new Date("2026-08-24T00:00:01.000Z"),
		databaseCleanupCompletedAt: new Date("2026-08-24T00:00:02.000Z"),
		resetResult: { userId: "user-1", email: "user@example.com", resetUrl: null },
	};
	const database = Database.of(
		Object.assign(Object.create(null), {
			select: () => ({ from: () => ({ where: () => ({ limit: () => Effect.succeed([row]) }) }) }),
		}),
	);
	const repositoryLayer = UserLifecycleRepository.layer.pipe(
		Layer.provide(Layer.succeed(Database, database)),
	);
	const layer = Layer.merge(repositoryLayer, Layer.succeed(Database, database));

	return Effect.gen(function* () {
		const repository = yield* UserLifecycleRepository;
		expect(yield* repository.getById("operation-1")).toEqual({
			kind: "reset",
			failure: null,
			userId: "user-1",
			id: "operation-1",
			status: "completed",
			createdAt: "2026-08-24T00:00:00.000Z",
			startedAt: "2026-08-24T00:00:01.000Z",
			finishedAt: "2026-08-24T00:00:03.000Z",
			resetResult: { userId: "user-1", email: "user@example.com", resetUrl: null },
		});
	}).pipe(Effect.provide(layer));
});

it.effect("acquires the per-user lock before reading an active operation", () => {
	const events: string[] = [];
	const active = {
		failure: null,
		startedAt: null,
		finishedAt: null,
		userId: "user-1",
		id: "operation-1",
		resetResult: null,
		workflowAttempt: 0,
		accessRevokedAt: null,
		kind: "delete" as const,
		status: "pending" as const,
		accessRevocationStartedAt: null,
		databaseCleanupCompletedAt: null,
		createdAt: new Date("2026-08-24T00:00:00.000Z"),
		metadata: {
			apiKeys: [],
			locators: [],
			accounts: [],
			usesLocalAuth: true,
			recreatedAccountId: "account-1",
			user: {
				id: "user-1",
				name: "User",
				disabledAt: null,
				emailVerified: true,
				email: "user@example.com",
			},
		},
	};
	const database = Database.of(
		Object.assign(Object.create(null), {
			execute: () => Effect.sync(() => void events.push("lock")),
			select: () => {
				events.push("active");
				return { from: () => ({ where: () => ({ limit: () => Effect.succeed([active]) }) }) };
			},
		}),
	);
	const repositoryLayer = UserLifecycleRepository.layer.pipe(
		Layer.provide(Layer.succeed(Database, database)),
	);
	return Effect.gen(function* () {
		const repository = yield* UserLifecycleRepository;
		const prepared = yield* repository.loadPreparationForUpdate(UserId.make("user-1"), "reset");
		expect(prepared?.active?.operation.id).toBe("operation-1");
		expect(events).toEqual(["lock", "active"]);
	}).pipe(Effect.provide(Layer.merge(repositoryLayer, Layer.succeed(Database, database))));
});
