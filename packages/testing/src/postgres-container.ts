import { once } from "node:events";
// Testcontainers supplies a Node stream; its log consumer requires a native WriteStream.
// oxlint-disable-next-line effecttsgo/node-builtin-import
import { createWriteStream, type WriteStream } from "node:fs";
import { tmpdir } from "node:os";
// Log files use the host platform's temporary directory and native path separator.
// oxlint-disable-next-line effecttsgo/node-builtin-import
import { join } from "node:path";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Data, Effect } from "effect";
import { Wait } from "testcontainers";

export type StartedPostgresContainer = {
	url: string;
	logPath: string;
	logStream: WriteStream;
	container: StartedPostgreSqlContainer;
};

export class PostgresContainerError extends Data.TaggedError("PostgresContainerError")<{
	readonly cause: unknown;
	readonly message: string;
}> {}

const containerError = (message: string, cause: unknown) =>
	new PostgresContainerError({ cause, message });

export const startPostgresContainerEffect = (input: { label: string; maxConnections?: number }) =>
	Effect.gen(function* () {
		const logPath = join(tmpdir(), `ryot-${input.label}-postgres-${process.pid}.log`);
		const logStream = createWriteStream(logPath, { flags: "w" });
		const container = yield* Effect.tryPromise({
			catch: (cause) => containerError("Could not start PostgreSQL container", cause),
			try: () =>
				new PostgreSqlContainer("postgres:18-alpine")
					.withDatabase("test_db")
					.withUsername("test_user")
					.withPassword("test_password")
					.withCommand([
						"postgres",
						"-c",
						`max_connections=${input.maxConnections ?? 400}`,
						"-c",
						"log_lock_waits=on",
						"-c",
						"deadlock_timeout=100ms",
						"-c",
						"log_min_error_statement=error",
						"-c",
						"log_line_prefix=%m [%p] tx=%x ",
					])
					.withLogConsumer((stream) => stream.pipe(logStream))
					.withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections", 2))
					.start(),
		}).pipe(Effect.onError(() => Effect.sync(() => logStream.end())));

		return { logPath, container, logStream, url: container.getConnectionUri() };
	});

export const stopPostgresContainerEffect = (started?: StartedPostgresContainer) =>
	Effect.gen(function* () {
		if (!started) {
			return;
		}

		yield* Effect.tryPromise({
			try: () => started.container.stop(),
			catch: (cause) => containerError("Could not stop PostgreSQL container", cause),
		});
		if (!started.logStream.closed) {
			started.logStream.end();
			yield* Effect.tryPromise({
				try: () => once(started.logStream, "close"),
				catch: (cause) => containerError("Could not close PostgreSQL logs", cause),
			});
		}
	});

// The E2E fixture consumes the test infrastructure through a Promise API.
export const startPostgresContainer = (input: { label: string; maxConnections?: number }) =>
	Effect.runPromise(startPostgresContainerEffect(input));
export const stopPostgresContainer = (started?: StartedPostgresContainer) =>
	Effect.runPromise(stopPostgresContainerEffect(started));

export const postgresGlobalSetup =
	(input: { label: string; maxConnections?: number }) =>
	({ provide }: { provide: (key: "databaseUrl", value: string) => void }) => {
		const running = process.env["TEST_DATABASE_URL"];
		if (running) {
			provide("databaseUrl", running);
			return () => Promise.resolve();
		}

		return Effect.runPromise(
			startPostgresContainerEffect(input).pipe(
				Effect.mapError((cause) =>
					containerError(
						`Could not start PostgreSQL for the ${input.label} suite. Start a container runtime (a non-default socket needs DOCKER_HOST and TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE in the package's .env, as in e2e/.env), or point TEST_DATABASE_URL at a running instance (bun run docker:up).`,
						cause,
					),
				),
				Effect.tap((postgres) =>
					Effect.gen(function* () {
						provide("databaseUrl", postgres.url);
						yield* Effect.logInfo(`PostgreSQL logs: ${postgres.logPath}`);
					}),
				),
				Effect.map((postgres) => () => Effect.runPromise(stopPostgresContainerEffect(postgres))),
			),
		);
	};
