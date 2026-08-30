import { PgClient } from "@effect/sql-pg";
import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { eq, sql } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Redacted } from "effect";

import { testDatabaseUrl } from "#lib/test-utils/database";

import { retryOnDeadlock } from "./errors";
import { DatabaseSession, DatabaseSessionStateError } from "./session";

const entry = pgTable("database_session_test", {
	id: text("id").primaryKey(),
	value: text("value").notNull(),
});

const sessionLayer = Layer.effectDiscard(
	Effect.gen(function* () {
		const root = yield* (yield* DatabaseSession).current;
		yield* root.execute(
			sql`create temporary table database_session_test (id text primary key, value text not null)`,
		);
	}),
).pipe(
	Layer.provideMerge(Layer.effect(DatabaseSession, DatabaseSession.make)),
	Layer.provideMerge(PgClient.layer({ maxConnections: 1, url: Redacted.make(testDatabaseUrl()) })),
);

layer(sessionLayer)((test) => {
	test.effect("uses the root executor outside transactions and restores it after commit", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const root = yield* session.current;
			expect(yield* session.isTransactionActive).toBe(false);
			yield* root.insert(entry).values({ id: "root", value: "outside" });

			const committed = yield* session.transaction(
				Effect.gen(function* () {
					const db = yield* session.current;
					expect(db).not.toBe(root);
					expect(yield* session.isTransactionActive).toBe(true);
					yield* session.requireTransaction;
					yield* db.insert(entry).values({ id: "committed", value: "inside" });
					return yield* db.select().from(entry).where(eq(entry.id, "root"));
				}),
			);
			expect(committed).toMatchObject([{ value: "outside" }]);
			expect(yield* session.current).toBe(root);
			expect(yield* session.isTransactionActive).toBe(false);
			yield* session.requireRoot;
			expect((yield* root.select().from(entry)).map((row) => row.id).sort()).toEqual([
				"committed",
				"root",
			]);
		}),
	);
});

layer(sessionLayer)((test) => {
	test.effect("rolls back typed failures without catching them or leaking transaction state", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const failure = { _tag: "FixtureFailure" as const };
			const observed = yield* Effect.flip(
				session.transaction(
					Effect.gen(function* () {
						const db = yield* session.current;
						yield* db.insert(entry).values({ value: "discard", id: "rolled-back" });
						return yield* Effect.fail(failure);
					}),
				),
			);
			expect(observed).toBe(failure);
			expect(yield* session.isTransactionActive).toBe(false);
			expect(yield* (yield* session.current).select().from(entry)).toEqual([]);
		}),
	);
});

layer(sessionLayer)((test) => {
	test.effect("runs statements on the current executor and maps their SQL failures", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			yield* session.run((db) => db.insert(entry).values({ id: "root", value: "outside" }));
			const error = yield* Effect.flip(
				session.run((db) => db.insert(entry).values({ id: "root", value: "duplicate" })),
			);
			assert(error instanceof DbError);
			expect(error.code).toBe("23505");

			const rolledBack = yield* Effect.flip(
				session.transaction(
					Effect.gen(function* () {
						yield* session.run((db) => db.insert(entry).values({ id: "inside", value: "discard" }));
						return yield* Effect.fail({ _tag: "FixtureFailure" as const });
					}),
				),
			);
			expect(rolledBack).toEqual({ _tag: "FixtureFailure" });
			expect(yield* session.run((db) => db.select().from(entry))).toMatchObject([{ id: "root" }]);
		}),
	);
});

layer(sessionLayer)((test) => {
	test.effect("maps SQL failures to DbError and rolls back earlier writes", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const error = yield* Effect.flip(
				session.transaction(
					Effect.gen(function* () {
						const db = yield* session.current;
						yield* db.insert(entry).values({ value: "first", id: "duplicate" });
						yield* db.insert(entry).values({ value: "second", id: "duplicate" });
					}),
				),
			);
			assert(error instanceof DbError);
			expect(error.code).toBe("23505");
			expect(yield* (yield* session.current).select().from(entry)).toEqual([]);
		}),
	);
});

layer(sessionLayer)((test) => {
	test.effect("restores state and rolls back after a defect", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const root = yield* session.current;
			const defect = new Error("unexpected failure");
			const exit = yield* Effect.exit(
				session.transaction(
					Effect.gen(function* () {
						const db = yield* session.current;
						yield* db.insert(entry).values({ id: "defect", value: "discard" });
						return yield* Effect.die(defect);
					}),
				),
			);
			assert(Exit.isFailure(exit));
			expect(Cause.squash(exit.cause)).toBe(defect);
			expect(yield* session.current).toBe(root);
			expect(yield* session.isTransactionActive).toBe(false);
			expect(yield* root.select().from(entry)).toEqual([]);
		}),
	);
});

layer(sessionLayer)((test) => {
	test.effect("enforces root and transaction ownership without nested savepoints", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const missing = yield* Effect.flip(session.requireTransaction);
			expect(missing).toEqual(new DatabaseSessionStateError({ reason: "transaction-required" }));

			yield* session.transaction(
				Effect.gen(function* () {
					const nested = yield* Effect.flip(session.transaction(Effect.void));
					expect(nested).toEqual(
						new DatabaseSessionStateError({ reason: "transaction-already-active" }),
					);
					const wrongOwner = yield* Effect.flip(session.requireRoot);
					expect(wrongOwner.reason).toBe("transaction-already-active");
					yield* session.requireTransaction;
				}),
			);
			yield* session.requireRoot;
		}),
	);
});

layer(sessionLayer)((test) => {
	test.effect("restores state and rolls back when an active transaction is interrupted", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const root = yield* session.current;
			const started = yield* Deferred.make<void>();
			const fiber = yield* Effect.forkChild(
				session.transaction(
					Effect.gen(function* () {
						const db = yield* session.current;
						yield* db.insert(entry).values({ value: "discard", id: "interrupted" });
						yield* Deferred.succeed(started, undefined);
						return yield* Effect.never;
					}),
				),
			);
			yield* Deferred.await(started);
			// Another fiber never inherits the active transaction from its sibling.
			expect(yield* session.isTransactionActive).toBe(false);
			expect(yield* session.current).toBe(root);
			yield* Fiber.interrupt(fiber);
			expect(yield* session.isTransactionActive).toBe(false);
			expect(yield* root.select().from(entry)).toEqual([]);
			yield* session.transaction(
				Effect.gen(function* () {
					const db = yield* session.current;
					yield* db.insert(entry).values({ value: "committed", id: "after-interruption" });
				}),
			);
			expect((yield* root.select().from(entry)).map((row) => row.id)).toEqual([
				"after-interruption",
			]);
		}),
	);
});

layer(sessionLayer)((test) => {
	test.effect("retries the complete transaction attempt after a deadlock failure", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			let attempts = 0;
			yield* retryOnDeadlock(
				session.transaction(
					Effect.gen(function* () {
						attempts += 1;
						const db = yield* session.current;
						yield* db.insert(entry).values({ id: "retried", value: String(attempts) });
						if (attempts === 1) {
							return yield* new DbError({ code: "40P01", message: "deadlock" });
						}
						return undefined;
					}),
				),
			);
			expect(attempts).toBe(2);
			expect(yield* (yield* session.current).select().from(entry)).toMatchObject([
				{ value: "2", id: "retried" },
			]);
		}),
	);
});
