import { PgClient, PgConnection } from "@effect/sql-pg";
import { DbError } from "@ryot-app/contract/errors";
import { Context, Duration, Effect, Layer, Stream } from "effect";

export class DatabaseOwner extends Context.Service<DatabaseOwner>()(
	"@ryot-app/kernel-backend/platform/db/ownership/DatabaseOwner",
	{
		make: Effect.gen(function* () {
			const pg = yield* PgClient.PgClient;
			const connection = yield* PgConnection.make({
				...pg.config,
				keepAlive: Duration.seconds(5),
				applicationName: "ryot-database-owner",
			});
			const result = yield* connection.query(
				"select pg_try_advisory_lock(hashtext('ryot-backend-owner')) as acquired",
			);
			if (result.rows[0]?.["acquired"] !== true) {
				return yield* new DbError({ message: "Another Ryot backend already owns this database" });
			}
			const notifications = yield* connection.listen("ryot_backend_owner");
			const lost = Stream.fromQueue(notifications).pipe(
				Stream.runDrain,
				Effect.andThen(Effect.fail(new DbError({ message: "Database ownership was lost" }))),
			);
			return { run: <A, E, R>(work: Effect.Effect<A, E, R>) => work.pipe(Effect.raceFirst(lost)) };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
