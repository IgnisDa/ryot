import { migrate } from "drizzle-orm/effect-postgres/migrator";
import { Context, Effect, Layer } from "effect";

import { databaseError } from "./errors";
import { DatabaseSession } from "./session";

const migrateDB = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.requireRoot;
	const database = yield* session.current;

	yield* Effect.logInfo("running database migrations");
	const migrationsFolder = `${process.cwd()}/src/drizzle`;
	yield* migrate(database, { migrationsFolder }).pipe(Effect.mapError(databaseError));
	yield* Effect.logInfo("database migrations complete");
});

export class MigrationsComplete extends Context.Service<MigrationsComplete>()(
	"MigrationsComplete",
	{ make: migrateDB.pipe(Effect.as({ done: true as const })) },
) {
	static readonly layer = Layer.effect(this, this.make);
}
