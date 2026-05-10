import { expect, it } from "@effect/vitest";
import { BackupRunId, UserId } from "@ryot/contract/schema/brands";
import type { SQLWrapper } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";

import { BackupsRepository } from "./repository";

const runId = BackupRunId.make("run-id");
const userId = UserId.make("user-id");
const startedAt = new Date(1).toISOString();
const row = {
	userId,
	id: runId,
	error: null,
	progress: 90,
	expiresAt: null,
	finishedAt: null,
	artifactKey: null,
	artifactProvider: null,
	kind: "restore" as const,
	status: "running" as const,
	createdAt: new Date(0),
	startedAt: new Date(1),
};

it.effect("scopes every workflow run mutation by run and user IDs", () => {
	const dialect = new PgDialect();
	const predicates: Array<{ sql: string; params: unknown[] }> = [];
	const db = {
		update: () => ({
			set: () => ({
				where: (condition: SQLWrapper) => ({
					returning: () => {
						predicates.push(dialect.sqlToQuery(condition.getSQL()));
						return Effect.succeed([row]);
					},
				}),
			}),
		}),
	};

	return Effect.gen(function* () {
		const repository = yield* BackupsRepository;
		yield* repository.markRunRunning({ runId, userId, progress: 5 });
		yield* repository.updateProgress({ runId, userId, progress: 90 });
		yield* repository.completeRun({ runId, userId });
		yield* repository.failRun({ runId, userId, error: "safe failure" });

		expect(predicates).toHaveLength(4);
		for (const predicate of predicates) {
			expect(predicate.params).toContain(runId);
			expect(predicate.params).toContain(userId);
		}
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				BackupsRepository.layer,
				Layer.succeed(Database, Object.assign(Object.create(null), db)),
			),
		),
	);
});

it.effect("returns an existing running run without resetting its start time", () => {
	let updates = 0;
	const db = {
		update: () => ({
			set: () => ({
				where: () => ({
					returning: () => {
						updates += 1;
						return Effect.succeed([]);
					},
				}),
			}),
		}),
		select: () => ({
			from: () => ({ where: () => ({ limit: () => Effect.succeed([row]) }) }),
		}),
	};

	return Effect.gen(function* () {
		const repository = yield* BackupsRepository;
		const replayed = yield* repository.markRunRunning({ runId, userId, progress: 5 });
		expect(updates).toBe(1);
		expect(replayed?.startedAt).toBe(startedAt);
		expect(replayed?.progress).toBe(90);
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				BackupsRepository.layer,
				Layer.succeed(Database, Object.assign(Object.create(null), db)),
			),
		),
	);
});
