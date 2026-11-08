import { expect } from "bun:test";

import { PgClient } from "@effect/sql-pg";
import { DbError } from "@ryot-app/contract/errors";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Exit, Fiber, Ref } from "effect";

import { testPgClientLayer } from "#testing/database";

import { DatabaseOwner } from "./ownership";

layer(testPgClientLayer())((test) => {
	test.effect("rejects a second owner and admits a replacement after shutdown", () =>
		Effect.gen(function* () {
			yield* Effect.scoped(
				Effect.gen(function* () {
					yield* DatabaseOwner.make;
					const result = yield* Effect.exit(Effect.scoped(DatabaseOwner.make));
					assertExitFails(
						result,
						new DbError({ message: "Another Ryot backend already owns this database" }),
					);
				}),
			);
			yield* Effect.scoped(DatabaseOwner.make);
		}),
	);

	test.effect("interrupts application work when its ownership connection is lost", () =>
		Effect.gen(function* () {
			const pg = yield* PgClient.PgClient;
			const owner = yield* DatabaseOwner.make;
			const stopped = yield* Ref.make(false);
			const running = yield* owner
				.run(Effect.never.pipe(Effect.ensuring(Ref.set(stopped, true))))
				.pipe(Effect.forkChild);
			yield* pg`select pg_terminate_backend(pid) from pg_stat_activity
				where datname = current_database() and application_name = 'ryot-database-owner'`;
			const result = yield* Fiber.await(running);
			expect(Exit.isFailure(result)).toBe(true);
			expect(yield* Ref.get(stopped)).toBe(true);
		}),
	);
});
