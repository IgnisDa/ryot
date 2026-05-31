import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Context, Effect, Layer } from "effect";

import { DbService } from "./db";
import { unknownToDbError } from "./errors";

export class MigrationsComplete extends Context.Tag("MigrationsComplete")<
	MigrationsComplete,
	{ readonly done: true }
>() {}

export const migrateDB = Effect.gen(function* () {
	const { db } = yield* DbService;
	const migrationsFolder = yield* Effect.sync(() => `${process.cwd()}/src/drizzle`);
	yield* Effect.logInfo("running reference database migrations");
	yield* Effect.tryPromise({
		try: () => migrate(db, { migrationsFolder }),
		catch: unknownToDbError,
	});
	yield* Effect.logInfo("reference database migrations complete");
});

export const MigrationsLive = Layer.effect(
	MigrationsComplete,
	migrateDB.pipe(Effect.as({ done: true as const })),
);
