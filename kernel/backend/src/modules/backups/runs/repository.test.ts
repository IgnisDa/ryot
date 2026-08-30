import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { BackupConflict } from "@ryot-app/contract/modules/backups/schemas";
import { BackupRunId, UserId } from "@ryot-app/contract/schema/brands";
import type { SQLWrapper } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Context, Effect, Layer, Ref } from "effect";

import { DatabaseSession } from "#lib/infrastructure/db/session";
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
const pendingRow = {
	...row,
	progress: 0,
	expiresAt: null,
	startedAt: null,
	finishedAt: null,
	kind: "export" as const,
	status: "pending" as const,
};

type UpdatePredicate = { sql: string; params: unknown[] };

class FakeBackupRunsDatabase extends Context.Service<
	FakeBackupRunsDatabase,
	{ readonly updatePredicates: Effect.Effect<ReadonlyArray<UpdatePredicate>> }
>()("test/FakeBackupRunsDatabase") {}

const dialect = new PgDialect();

const makeRepositoryLayer = (options: {
	readonly updatedRows: ReadonlyArray<typeof row>;
	readonly selectedRows?: ReadonlyArray<typeof row>;
}) =>
	BackupsRepository.layer.pipe(
		Layer.provideMerge(
			Layer.unwrap(
				Effect.gen(function* () {
					const predicates = yield* Ref.make<ReadonlyArray<UpdatePredicate>>([]);
					const inserted = yield* Ref.make(false);
					const { selectedRows } = options;
					const db = {
						...(selectedRows === undefined
							? {}
							: {
									select: () => ({
										from: () => ({ where: () => ({ limit: () => Effect.succeed(selectedRows) }) }),
									}),
								}),
						update: () => ({
							set: () => ({
								where: (condition: SQLWrapper) => ({
									returning: () =>
										Ref.update(predicates, (all) => [
											...all,
											dialect.sqlToQuery(condition.getSQL()),
										]).pipe(Effect.as(options.updatedRows)),
								}),
							}),
						}),
						insert: () => ({
							values: () => ({
								returning: () =>
									Ref.getAndSet(inserted, true).pipe(
										Effect.flatMap((alreadyInserted) =>
											alreadyInserted
												? Effect.fail(
														new DbError({
															code: "23505",
															message: "duplicate key",
															constraint: "backup_run_user_active_unique",
														}),
													)
												: Effect.succeed([pendingRow]),
										),
									),
							}),
						}),
					};
					return Layer.merge(
						Layer.succeed(FakeBackupRunsDatabase, { updatePredicates: Ref.get(predicates) }),
						Layer.mock(DatabaseSession)({
							current: Effect.succeed(Object.assign(Object.create(null), db)),
						}),
					);
				}),
			),
		),
	);

layer(makeRepositoryLayer({ updatedRows: [row] }))((test) => {
	test.effect("scopes every workflow run mutation by run and user IDs", () =>
		Effect.gen(function* () {
			const repository = yield* BackupsRepository;
			yield* repository.markRunRunning({ runId, userId, progress: 5 });
			yield* repository.updateProgress({ runId, userId, progress: 90 });
			yield* repository.completeRun({ runId, userId });
			yield* repository.failRun({
				runId,
				userId,
				failure: { operation: "restore", code: "unexpected-failure" },
			});

			const predicates = yield* (yield* FakeBackupRunsDatabase).updatePredicates;
			expect(predicates).toHaveLength(4);
			for (const predicate of predicates) {
				expect(predicate.params).toContain(runId);
				expect(predicate.params).toContain(userId);
			}
		}),
	);
});

layer(makeRepositoryLayer({ updatedRows: [], selectedRows: [row] }))((test) => {
	test.effect("returns an existing running run without resetting its start time", () =>
		Effect.gen(function* () {
			const repository = yield* BackupsRepository;
			const replayed = yield* repository.markRunRunning({ runId, userId, progress: 5 });
			expect(yield* (yield* FakeBackupRunsDatabase).updatePredicates).toHaveLength(1);
			expect(replayed?.startedAt).toBe(startedAt);
			expect(replayed?.progress).toBe(90);
		}),
	);
});

layer(makeRepositoryLayer({ updatedRows: [] }))((test) => {
	test.effect("translates the concurrent active-run insert loser to Conflict", () =>
		Effect.gen(function* () {
			const repository = yield* BackupsRepository;
			const exits = yield* Effect.forEach(
				[
					repository.createRun({ userId, kind: "export" }),
					repository.createRun({ userId, kind: "restore" }),
				],
				Effect.exit,
				{ concurrency: "unbounded" },
			);
			expect(exits.filter((exit) => exit._tag === "Success")).toHaveLength(1);
			const failure = exits.find((exit) => exit._tag === "Failure");
			expect(failure?._tag).toBe("Failure");
			if (failure?._tag === "Failure") {
				assertExitFails(failure, new BackupConflict({ reason: { code: "active-run-exists" } }));
			}
		}),
	);
});
