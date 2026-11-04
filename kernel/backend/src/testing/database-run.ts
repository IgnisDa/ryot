import { BunCrypto } from "@effect/platform-bun";
import { PgClient } from "@effect/sql-pg";
import { sql } from "drizzle-orm";
import { Effect, Layer, Redacted, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { Reactivity } from "effect/reactivity";

import { DatabaseSession } from "#platform/db/session";
import {
	runWorkflowMessageMigrations,
	workflowMessageFenceStatements,
} from "#platform/db/workflow-message-fence";
import { applyBaselineMigration, baselineMigrationStatements } from "#testing/baseline-migration";

export const testDatabaseRunVariable = "RYOT_TEST_DATABASE";

const TestDatabaseRun = Schema.Struct({
	prefix: Schema.String,
	adminUrl: Schema.String,
	template: Schema.String,
	ownerRole: Schema.String,
	fileConnectionLimit: Schema.Int,
});

export const encodeTestDatabaseRun = Schema.encodeEffect(Schema.fromJsonString(TestDatabaseRun));
export const decodeTestDatabaseRun = Schema.decodeUnknownEffect(
	Schema.fromJsonString(TestDatabaseRun),
);

// Every connection a test file opens authenticates as that file's role, so Postgres enforces this.
const fileConnectionLimit = 24;
// One superuser connection per worker replaces its previous file role with the next one.
const workerAdminConnections = 1;
const runnerConnections = 2;
const defaultSuperuserReservedConnections = 3;

export const testDatabaseMaxConnections = (workers: number) =>
	workers * (fileConnectionLimit + workerAdminConnections) +
	runnerConnections +
	defaultSuperuserReservedConnections;

class TestDatabaseCapacityError extends Schema.TaggedError<
	TestDatabaseCapacityError,
	{ readonly brand: unique symbol }
>()("TestDatabaseCapacityError", { message: Schema.String }) {}

export const randomIdentifier = Effect.sync(() => SecureRandom.uuidV4Unsafe().replaceAll("-", ""));

export const quoteIdentifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

export const escapeLikePattern = (value: string) => value.replaceAll(/[\\%_]/g, "\\$&");

export const databaseUrlFor = (
	adminUrl: string,
	input: { role: string; database: string; password: string },
) => {
	const url = new URL(`/${input.database}`, adminUrl);
	url.username = input.role;
	url.password = input.password;
	return url.toString();
};

export const withAdminClient = <A, E, R>(
	adminUrl: string,
	use: (client: PgClient.PgClient) => Effect.Effect<A, E, R>,
) =>
	Effect.scoped(
		Effect.flatMap(PgClient.make({ maxConnections: 1, url: Redacted.make(adminUrl) }), use),
	).pipe(Effect.provideServiceEffect(Reactivity.Reactivity, Reactivity.make));

const Capacity = Schema.Array(Schema.Struct({ available: Schema.Int, maxConnections: Schema.Int }));

const verifyCapacity = (client: PgClient.PgClient, workers: number) =>
	Effect.gen(function* () {
		const [capacity] = yield* client
			.unsafe(
				`select current_setting('max_connections')::int as "maxConnections",
					current_setting('max_connections')::int
						- current_setting('superuser_reserved_connections')::int
						- current_setting('reserved_connections')::int
						- (select count(*)::int from pg_stat_activity where backend_type = 'client backend')
						as available`,
			)
			.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Capacity)));
		const required = workers * (fileConnectionLimit + workerAdminConnections);
		if (capacity === undefined || capacity.available < required) {
			return yield* new TestDatabaseCapacityError({
				message: `${workers} test workers need ${required} free PostgreSQL connections, but ${capacity?.available ?? 0} of max_connections ${capacity?.maxConnections ?? 0} are available. Lower --parallel or raise max_connections to at least ${testDatabaseMaxConnections(workers)}.`,
			});
		}
		return undefined;
	});

const RunDatabases = Schema.Array(
	Schema.Struct({ name: Schema.String, isTemplate: Schema.Boolean }),
);
const RunRoles = Schema.Array(Schema.Struct({ name: Schema.String }));

export const dropRolesLike = (client: PgClient.PgClient, rolePattern: string) =>
	Effect.gen(function* () {
		const databases = yield* client
			.unsafe(
				`select d.datname as name, d.datistemplate as "isTemplate" from pg_database d
					join pg_roles r on r.oid = d.datdba where r.rolname like $1`,
				[rolePattern],
			)
			.pipe(Effect.flatMap(Schema.decodeUnknownEffect(RunDatabases)));
		for (const database of databases) {
			if (database.isTemplate) {
				yield* client.unsafe(
					`alter database ${quoteIdentifier(database.name)} with is_template false`,
				);
			}
			yield* client.unsafe(`drop database ${quoteIdentifier(database.name)} with (force)`);
		}
		const roles = yield* client
			.unsafe(`select rolname as name from pg_roles where rolname like $1`, [rolePattern])
			.pipe(Effect.flatMap(Schema.decodeUnknownEffect(RunRoles)));
		for (const role of roles) {
			yield* client.unsafe(`drop role ${quoteIdentifier(role.name)}`);
		}
	});

const migrateTestDatabase = Layer.effectDiscard(
	Effect.gen(function* () {
		const statements = yield* baselineMigrationStatements();
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

export const prepareTestDatabaseRun = Effect.fn("prepareTestDatabaseRun")(function* (input: {
	workers: number;
	adminUrl: string;
}) {
	const prefix = `ryot_test_${(yield* randomIdentifier).slice(0, 8)}`;
	const ownerRole = `${prefix}_owner`;
	const template = `${prefix}_template`;
	const ownerPassword = yield* randomIdentifier;
	yield* withAdminClient(input.adminUrl, (client) => verifyCapacity(client, input.workers));
	yield* Effect.acquireRelease(
		withAdminClient(input.adminUrl, (client) =>
			Effect.gen(function* () {
				yield* client.unsafe(
					`create role ${quoteIdentifier(ownerRole)} login password '${ownerPassword}'`,
				);
				yield* client.unsafe(
					`create database ${quoteIdentifier(template)} owner ${quoteIdentifier(ownerRole)}`,
				);
			}),
		),
		() =>
			withAdminClient(input.adminUrl, (client) =>
				dropRolesLike(client, `${escapeLikePattern(prefix)}\\_%`),
			).pipe(Effect.orDie),
	);
	const ownerUrl = databaseUrlFor(input.adminUrl, {
		role: ownerRole,
		database: template,
		password: ownerPassword,
	});
	yield* Effect.scoped(
		Layer.build(
			migrateTestDatabase.pipe(
				Layer.provide(Layer.effect(DatabaseSession, DatabaseSession.make)),
				Layer.provide(PgClient.layer({ maxConnections: 1, url: Redacted.make(ownerUrl) })),
				Layer.provide(BunCrypto.layerSecureRandom),
			),
		),
	);
	yield* withAdminClient(input.adminUrl, (client) =>
		client.unsafe(
			`alter database ${quoteIdentifier(template)} with allow_connections false is_template true`,
		),
	);
	return { prefix, template, ownerRole, fileConnectionLimit, adminUrl: input.adminUrl };
});
