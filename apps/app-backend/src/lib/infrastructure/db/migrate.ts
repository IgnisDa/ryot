import { unknownToDbError } from "@ryot/contract/errors";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Context, Effect, Layer } from "effect";

import { dropLegacyTables } from "#modules/legacy-bootstrap/drop-tables";
import { migrateLegacyTables } from "#modules/legacy-bootstrap/migrate-data";
import { renameLegacyTables } from "#modules/legacy-bootstrap/rename-tables";

import { DbService } from "./service";

const migrateDB = Effect.gen(function* () {
	const { db } = yield* DbService;

	yield* renameLegacyTables;
	yield* Effect.logInfo("running database migrations");
	const migrationsFolder = `${process.cwd()}/src/drizzle`;
	yield* Effect.tryPromise({
		catch: unknownToDbError,
		try: () => migrate(db, { migrationsFolder }),
	});
	yield* Effect.logInfo("database migrations complete");
});

export class MigrationsComplete extends Context.Service<MigrationsComplete>()(
	"MigrationsComplete",
	{ make: migrateDB.pipe(Effect.as({ done: true as const })) },
) {
	static readonly layer = Layer.effect(this, this.make);
}

export class LegacyBootstrapMigrateDrop extends Context.Service<LegacyBootstrapMigrateDrop>()(
	"LegacyBootstrapMigrateDrop",
	{
		make: Effect.gen(function* () {
			yield* migrateLegacyTables;
			yield* dropLegacyTables;
			return { done: true as const };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
