import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { BackupConflict } from "@ryot-app/contract/modules/backups/schemas";
import { BackupRunId, UserId } from "@ryot-app/contract/schema/brands";
import type { SQLWrapper } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import { assertExitFails } from "#lib/test-utils/assertions";

import { BackupsRepository } from "./repository";

const runId = BackupRunId.make("run-id");
const userId = UserId.make("user-id");
const startedAt = new Date(1).toISOString();
const row = {
	userId,
	id: runId,
	progress: 90,
	failure: null,
	expiresAt: null,
	finishedAt: null,
	artifactKey: null,
	artifactProvider: null,
	createdAt: new Date(0),
	startedAt: new Date(1),
	kind: "restore" as const,
	status: "running" as const,
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
		yield* repository.failRun({
			runId,
			userId,
			failure: { operation: "restore", code: "unexpected-failure" },
		});

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
		select: () => ({ from: () => ({ where: () => ({ limit: () => Effect.succeed([row]) }) }) }),
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

it.effect("translates the concurrent active-run insert loser to Conflict", () => {
	let inserted = false;
	const pendingRow = {
		...row,
		progress: 0,
		expiresAt: null,
		startedAt: null,
		finishedAt: null,
		kind: "export" as const,
		status: "pending" as const,
	};
	const db = {
		insert: () => ({
			values: () => ({
				returning: () =>
					Effect.suspend(() => {
						if (inserted) {
							return Effect.fail(
								new DbError({
									code: "23505",
									message: "duplicate key",
									constraint: "backup_run_user_active_unique",
								}),
							);
						}
						inserted = true;
						return Effect.succeed([pendingRow]);
					}),
			}),
		}),
	};

	return Effect.gen(function* () {
		const repository = yield* BackupsRepository;
		const exits = yield* Effect.all(
			[
				repository.createRun({ userId, kind: "export" }),
				repository.createRun({ userId, kind: "restore" }),
			].map(Effect.exit),
			{ concurrency: "unbounded" },
		);
		expect(exits.filter((exit) => exit._tag === "Success")).toHaveLength(1);
		const failure = exits.find((exit) => exit._tag === "Failure");
		expect(failure?._tag).toBe("Failure");
		if (failure?._tag === "Failure") {
			assertExitFails(failure, new BackupConflict({ reason: { code: "active-run-exists" } }));
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
