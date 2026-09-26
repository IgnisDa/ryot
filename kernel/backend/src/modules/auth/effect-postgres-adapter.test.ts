import type { BetterAuthOptions } from "@better-auth/core";
import { getCurrentAdapter, runWithTransaction } from "@better-auth/core/context";
import type { DBAdapter } from "@better-auth/core/db/adapter";
import { expect, layer } from "@effect/vitest";
import { inArray } from "drizzle-orm";
import { Cause, Deferred, Effect, Exit, Layer } from "effect";
import { assert } from "vitest";

import * as authSchema from "#lib/infrastructure/db/schema/tables/auth";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { RedisService } from "#lib/infrastructure/redis";
import { makeRedisService } from "#lib/test-utils/effect";
import { isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";

import { effectPostgresAuthAdapter } from "./effect-postgres-adapter";

const authOptions = {} satisfies BetterAuthOptions;

const testLayer = Layer.mergeAll(
	isolatedDatabaseLayer("auth_adapter_test"),
	Layer.succeed(RedisService, makeRedisService()),
);

const runBetterAuthTransaction = <A>(adapter: DBAdapter, work: () => Promise<A>) =>
	Promise.resolve(runWithTransaction(adapter, work));

layer(testLayer)((test) => {
	test.effect(
		"keeps hook Effects in the active Better Auth transaction with rollback and concurrent isolation",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const runtime = yield* Effect.context<DatabaseSession | RedisService>();
				const database = effectPostgresAuthAdapter({ session, context: runtime });
				const adapter = database.adapter(authOptions);
				const rollbackEmail = "rollback@auth-adapter.test";
				const rollbackFailure = new Error("rollback auth transaction");

				const rollbackExit = yield* Effect.exit(
					Effect.promise(() =>
						runBetterAuthTransaction(adapter, () =>
							database.runInCurrentContext(
								null,
								Effect.gen(function* () {
									expect(yield* session.isTransactionActive).toBe(true);
									const current = yield* Effect.promise(() => getCurrentAdapter(adapter));
									expect(current).not.toBe(adapter);
									yield* Effect.promise(() =>
										current.create({
											model: "user",
											data: { name: "Rollback", emailVerified: false, email: rollbackEmail },
										}),
									);
									const visible = yield* session.run((db) =>
										db
											.select({ email: authSchema.user.email })
											.from(authSchema.user)
											.where(inArray(authSchema.user.email, [rollbackEmail])),
									);
									expect(visible).toEqual([{ email: rollbackEmail }]);
									return yield* Effect.fail(rollbackFailure);
								}),
							),
						),
					),
				);
				assert(Exit.isFailure(rollbackExit));
				expect(Cause.squash(rollbackExit.cause)).toMatchObject({ cause: rollbackFailure });
				expect(yield* session.isTransactionActive).toBe(false);
				expect(
					yield* Effect.promise(() =>
						adapter.findOne({ model: "user", where: [{ field: "email", value: rollbackEmail }] }),
					),
				).toBeNull();

				const leftInserted = yield* Deferred.make<void>();
				const rightInserted = yield* Deferred.make<void>();
				const leftObserved = yield* Deferred.make<void>();
				const rightObserved = yield* Deferred.make<void>();
				const emails = ["left@auth-adapter.test", "right@auth-adapter.test"] as const;
				const transact = (
					email: (typeof emails)[number],
					inserted: Deferred.Deferred<void>,
					peerInserted: Deferred.Deferred<void>,
					observed: Deferred.Deferred<void>,
					peerObserved: Deferred.Deferred<void>,
				) =>
					Effect.promise(() =>
						runBetterAuthTransaction(adapter, () =>
							database.runInCurrentContext(
								null,
								Effect.gen(function* () {
									expect(yield* session.isTransactionActive).toBe(true);
									const current = yield* Effect.promise(() => getCurrentAdapter(adapter));
									expect(current).not.toBe(adapter);
									yield* Effect.promise(() =>
										current.create({
											model: "user",
											data: { email, name: email, emailVerified: false },
										}),
									);
									yield* Deferred.succeed(inserted, undefined);
									yield* Deferred.await(peerInserted);
									const visible = yield* session.run((db) =>
										db
											.select({ email: authSchema.user.email })
											.from(authSchema.user)
											.where(inArray(authSchema.user.email, emails)),
									);
									yield* Deferred.succeed(observed, undefined);
									yield* Deferred.await(peerObserved);
									return { current, visible: visible.map((row) => row.email) };
								}),
							),
						),
					);

				const [left, right] = yield* Effect.all(
					[
						transact(emails[0], leftInserted, rightInserted, leftObserved, rightObserved),
						transact(emails[1], rightInserted, leftInserted, rightObserved, leftObserved),
					],
					{ concurrency: 2 },
				);
				expect(left.current).not.toBe(right.current);
				expect(left.visible).toEqual([emails[0]]);
				expect(right.visible).toEqual([emails[1]]);
				expect(yield* session.isTransactionActive).toBe(false);
				expect(
					(yield* session.run((db) =>
						db
							.select({ email: authSchema.user.email })
							.from(authSchema.user)
							.where(inArray(authSchema.user.email, emails)),
					))
						.map((row) => row.email)
						.sort(),
				).toEqual([...emails].sort());
			}),
	);
});
