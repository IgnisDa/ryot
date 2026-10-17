import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/effect-postgres/migrator";
import { Context, Effect, Layer } from "effect";

import { immutableRevisionStatements } from "./immutable-revisions";
import { DatabaseSession } from "./session";
import { userPluginStateStatements } from "./user-plugin-state";
import {
	runWorkflowMessageMigrations,
	workflowMessageFenceStatements,
} from "./workflow-message-fence";

const migrateDB = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.requireRoot;

	yield* Effect.logInfo("running database migrations");
	const migrationsFolder = `${process.cwd()}/src/drizzle`;
	yield* session.run((database) => migrate(database, { migrationsFolder }));
	yield* runWorkflowMessageMigrations;
	yield* session.transaction(
		Effect.gen(function* () {
			yield* session.run((database) =>
				database.execute(sql`select pg_advisory_xact_lock(hashtext('ryot:immutable-revisions'))`),
			);
			for (const statement of [
				...immutableRevisionStatements,
				...userPluginStateStatements,
				...workflowMessageFenceStatements,
			]) {
				yield* session.run((database) => database.execute(sql.raw(statement)));
			}
		}),
	);
	yield* Effect.logInfo("database migrations complete");
});

export class MigrationsComplete extends Context.Service<MigrationsComplete>()(
	"MigrationsComplete",
	{ make: migrateDB.pipe(Effect.as({ done: true as const })) },
) {
	static readonly layer = Layer.effect(this, this.make);
}
