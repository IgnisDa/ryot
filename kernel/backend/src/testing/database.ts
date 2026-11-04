import { PgClient } from "@effect/sql-pg";
import { Duration, Effect, Layer, Redacted, Schema } from "effect";

import {
	databaseUrlFor,
	decodeTestDatabaseRun,
	dropRolesLike,
	escapeLikePattern,
	quoteIdentifier,
	randomIdentifier,
	testDatabaseRunVariable,
	withAdminClient,
} from "#testing/database-run";

// A child process of a test file passes the file's database on instead of creating its own role.
const fileDatabaseUrlVariable = "TEST_FILE_DATABASE_URL";

class TestDatabaseRunMissingError extends Schema.TaggedError<
	TestDatabaseRunMissingError,
	{ readonly brand: unique symbol }
>()("TestDatabaseRunMissingError", { message: Schema.String }) {}

const testDatabaseRun = Effect.suspend(() =>
	decodeTestDatabaseRun(Bun.env[testDatabaseRunVariable]),
).pipe(
	Effect.mapError(
		() =>
			new TestDatabaseRunMissingError({
				message: "Run database tests through the package test script",
			}),
	),
);

// A worker runs one file at a time, so roles from its earlier files are no longer in use. Root
// `afterAll` hooks run in registration order, which would drop the role before layer teardown.
const createFileDatabase = Effect.gen(function* () {
	const supplied = Bun.env[fileDatabaseUrlVariable];
	if (supplied !== undefined) {
		return supplied;
	}
	const run = yield* testDatabaseRun;
	const workerRolePrefix = `${run.prefix}_w${process.pid}_`;
	const role = `${workerRolePrefix}${(yield* randomIdentifier).slice(0, 24)}`;
	const password = yield* randomIdentifier;
	yield* withAdminClient(run.adminUrl, (client) =>
		Effect.gen(function* () {
			yield* dropRolesLike(client, `${escapeLikePattern(workerRolePrefix)}%`);
			yield* client.unsafe(
				`create role ${quoteIdentifier(role)} login createdb password '${password}' connection limit ${run.fileConnectionLimit}`,
			);
			yield* client.unsafe(`grant ${quoteIdentifier(run.ownerRole)} to ${quoteIdentifier(role)}`);
			yield* client.unsafe(
				`create database ${quoteIdentifier(role)} owner ${quoteIdentifier(role)}`,
			);
		}),
	);
	return databaseUrlFor(run.adminUrl, { role, password, database: role });
});

export const testDatabaseUrl = Effect.runSync(Effect.cached(Effect.orDie(createFileDatabase)));

// Layers stay built for their whole block, so idle connections are released instead of retained.
const testPoolIdleTimeout = Duration.seconds(1);

export const testDatabaseUrlFor = (database: string) =>
	Effect.map(testDatabaseUrl, (url) => new URL(`/${database}`, url).toString());

export const testPgClientLayer = ({
	database,
	...options
}: { readonly database?: string } & Omit<PgClient.PgPoolConfig, "url"> = {}) =>
	Layer.unwrap(
		Effect.map(database === undefined ? testDatabaseUrl : testDatabaseUrlFor(database), (url) =>
			PgClient.layer({ idleTimeout: testPoolIdleTimeout, ...options, url: Redacted.make(url) }),
		),
	);

export const testDatabaseTemplate = Effect.orDie(
	Effect.map(testDatabaseRun, (run) => run.template),
);

export const testFileDatabaseEnvironment = Effect.map(testDatabaseUrl, (url) => ({
	[fileDatabaseUrlVariable]: url,
}));
