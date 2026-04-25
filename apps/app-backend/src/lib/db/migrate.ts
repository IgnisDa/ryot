import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Effect } from "effect";

import { unknownToDbError } from "../errors";
import { DbService } from "./index";

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

export class MigrationsComplete extends Effect.Service<MigrationsComplete>()("MigrationsComplete", {
	effect: migrateDB.pipe(Effect.as({ done: true as const })),
}) {}
