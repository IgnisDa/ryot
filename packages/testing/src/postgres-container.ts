import { tmpdir } from "node:os";

import { BunFileSystem, BunPath } from "@effect/platform-bun";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Data, Effect, Fiber, FileSystem, Layer, Path, Stream } from "effect";
import { Wait } from "testcontainers";

export type StartedPostgresContainer = {
	url: string;
	logPath: string;
	container: StartedPostgreSqlContainer;
	logs: Effect.Effect<void, PostgresContainerError>;
};

export class PostgresContainerError extends Data.TaggedError("PostgresContainerError")<{
	readonly cause: unknown;
	readonly message: string;
}> {}

const platformLayer = Layer.merge(BunFileSystem.layer, BunPath.layer);

const withPlatform = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
	Effect.scoped(
		Layer.build(platformLayer).pipe(Effect.flatMap((context) => Effect.provide(effect, context))),
	);

const containerError = (message: string, cause: unknown) =>
	new PostgresContainerError({ cause, message });

export const startPostgresContainerEffect = (input: { label: string; maxConnections?: number }) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		const context = yield* Effect.context();
		const logPath = path.join(tmpdir(), `ryot-${input.label}-postgres-${process.pid}.log`);
		let logFiber: Fiber.Fiber<void, PostgresContainerError> | undefined;
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
					.withLogConsumer((stream) => {
						logFiber = Effect.runForkWith(context)(
							Stream.fromAsyncIterable<Uint8Array, PostgresContainerError>(stream, (cause) =>
								containerError("Could not read PostgreSQL logs", cause),
							).pipe(
								Stream.run(fs.sink(logPath)),
								Effect.mapError((cause) =>
									containerError("Could not write PostgreSQL logs", cause),
								),
							),
						);
					})
					.withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections", 2))
					.start(),
		}).pipe(
			Effect.onError(() => (logFiber === undefined ? Effect.void : Fiber.interrupt(logFiber))),
		);

		return {
			logPath,
			container,
			url: container.getConnectionUri(),
			logs: Effect.suspend(() => (logFiber === undefined ? Effect.void : Fiber.join(logFiber))),
		};
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
		yield* started.logs;
	});

// The E2E fixture consumes the test infrastructure through a Promise API.
export const startPostgresContainer = (input: { label: string; maxConnections?: number }) =>
	Effect.runPromise(withPlatform(startPostgresContainerEffect(input)));
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
			Effect.gen(function* () {
				const postgres = yield* withPlatform(startPostgresContainerEffect(input)).pipe(
					Effect.mapError((cause) =>
						containerError(
							`Could not start PostgreSQL for the ${input.label} suite. Start a container runtime (a non-default socket needs DOCKER_HOST and TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE in the package's .env, as in e2e/.env), or point TEST_DATABASE_URL at a running instance (bun run docker:up).`,
							cause,
						),
					),
				);
				provide("databaseUrl", postgres.url);
				yield* Effect.logInfo(`PostgreSQL logs: ${postgres.logPath}`);
				return () => stopPostgresContainer(postgres);
			}),
		);
	};
