import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Context, Effect, Layer } from "effect";

import { unknownToDbError } from "../errors";
import { DbService } from "./index";

export class MigrationsComplete extends Context.Tag("MigrationsComplete")<
	MigrationsComplete,
	{ readonly done: true }
>() {}

export const migrateDB = Effect.gen(function* () {
	const { db } = yield* DbService;
	const migrationsFolder = yield* Effect.sync(() => `${process.cwd()}/src/drizzle`);
	yield* Effect.logInfo("running database migrations");
	yield* Effect.tryPromise({
		catch: unknownToDbError,
		try: () => migrate(db, { migrationsFolder }),
	});
	yield* Effect.logInfo("database migrations complete");
});

export const MigrationsLive = Layer.effect(
	MigrationsComplete,
	migrateDB.pipe(Effect.as({ done: true as const })),
);
