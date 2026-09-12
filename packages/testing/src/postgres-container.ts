import { once } from "node:events";
import { createWriteStream, type WriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Wait } from "testcontainers";

export type StartedPostgresContainer = {
	url: string;
	logPath: string;
	logStream: WriteStream;
	container: StartedPostgreSqlContainer;
};

export async function startPostgresContainer(input: {
	label: string;
	maxConnections?: number;
}): Promise<StartedPostgresContainer> {
	const logPath = join(tmpdir(), `ryot-${input.label}-postgres-${process.pid}.log`);
	const logStream = createWriteStream(logPath, { flags: "w" });
	const container = await new PostgreSqlContainer("postgres:18-alpine")
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
		.withWaitStrategy(Wait.forLogMessage("database system is ready"))
		.start();

	return { logPath, container, logStream, url: container.getConnectionUri() };
}

export async function stopPostgresContainer(started?: StartedPostgresContainer) {
	if (!started) {
		return;
	}

	await started.container.stop();
	if (!started.logStream.closed) {
		started.logStream.end();
		await once(started.logStream, "close");
	}
}

export const postgresGlobalSetup =
	(input: { label: string; maxConnections?: number }) =>
	async ({ provide }: { provide: (key: "databaseUrl", value: string) => void }) => {
		const running = process.env["TEST_DATABASE_URL"];
		if (running) {
			provide("databaseUrl", running);
			return async () => {};
		}

		let postgres: StartedPostgresContainer;
		try {
			postgres = await startPostgresContainer(input);
		} catch (cause) {
			throw new Error(
				`Could not start PostgreSQL for the ${input.label} suite. Start a container runtime (a non-default socket needs DOCKER_HOST and TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE in the package's .env, as in e2e/.env), or point TEST_DATABASE_URL at a running instance (bun run docker:up).`,
				{ cause },
			);
		}

		provide("databaseUrl", postgres.url);
		console.info(`PostgreSQL logs: ${postgres.logPath}`);

		return async () => {
			await stopPostgresContainer(postgres);
		};
	};
