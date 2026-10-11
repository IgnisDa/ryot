import { sql } from "drizzle-orm";
import { Context, Effect, Layer, Redacted } from "effect";

import { PgClientLive } from "#platform/db/postgres";
import { DatabaseSession } from "#platform/db/session";
import {
	runWorkflowMessageMigrations,
	workflowMessageFenceStatements,
} from "#platform/db/workflow-message-fence";
import { applyBaselineMigration, baselineMigrationStatements } from "#testing/baseline-migration";
import { testDatabaseUrl } from "#testing/database";
import { databaseLayer, makeAppConfigLayer } from "#testing/effect";

export class IsolatedDatabase extends Context.Service<IsolatedDatabase, { readonly url: string }>()(
	"test/IsolatedDatabase",
) {}

// The drop is registered before the isolated pool is built, so it runs after that pool closes.
export const isolatedDatabaseLayer = (prefix: string) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const name = `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
			const session = yield* DatabaseSession;
			yield* session.run((admin) =>
				Effect.acquireRelease(admin.execute(sql`create database ${sql.identifier(name)}`), () =>
					admin.execute(sql`drop database ${sql.identifier(name)} with (force)`).pipe(Effect.orDie),
				),
			);
			const url = new URL(`/${name}`, testDatabaseUrl()).toString();
			const statements = yield* baselineMigrationStatements();
			const migrated = Layer.effectDiscard(
				Effect.gen(function* () {
					const database = yield* DatabaseSession;
					yield* database.run((db) =>
						applyBaselineMigration(statements, (statement) => db.execute(sql.raw(statement))),
					);
					yield* runWorkflowMessageMigrations;
					yield* database.run((db) =>
						applyBaselineMigration(workflowMessageFenceStatements, (statement) =>
							db.execute(sql.raw(statement)),
						),
					);
				}),
			);
			return migrated.pipe(
				Layer.provideMerge(
					Layer.effect(DatabaseSession, DatabaseSession.make).pipe(
						Layer.provideMerge(PgClientLive),
						Layer.provide(makeAppConfigLayer({ database: { url: Redacted.make(url) } })),
						Layer.fresh,
					),
				),
				Layer.provideMerge(Layer.succeed(IsolatedDatabase, { url })),
			);
		}),
	).pipe(Layer.provide(databaseLayer));
