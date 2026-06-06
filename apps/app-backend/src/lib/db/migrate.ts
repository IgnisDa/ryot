import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Effect } from "effect";

import { unknownToDbError } from "~/lib/errors";
import {
	dropLegacyTables,
	migrateLegacyTables,
	renameLegacyTables,
} from "~/modules/legacy-bootstrap";

import { DbService } from "./index";

export const migrateDB = Effect.gen(function* () {
	const { db } = yield* DbService;

	yield* renameLegacyTables;
	yield* Effect.logInfo("running database migrations");
	const migrationsFolder = new URL("../../drizzle", import.meta.url).pathname;
	yield* Effect.tryPromise({
		catch: unknownToDbError,
		try: () => migrate(db, { migrationsFolder }),
	});
	yield* Effect.logInfo("database migrations complete");
});

export class MigrationsComplete extends Effect.Service<MigrationsComplete>()("MigrationsComplete", {
	effect: migrateDB.pipe(Effect.as({ done: true as const })),
}) {}

export class LegacyBootstrapMigrateDrop extends Effect.Service<LegacyBootstrapMigrateDrop>()(
	"LegacyBootstrapMigrateDrop",
	{
		effect: Effect.gen(function* () {
			yield* migrateLegacyTables;
			yield* dropLegacyTables;
			return { done: true as const };
		}),
	},
) {}
