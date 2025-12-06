import { afterAll, beforeAll } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import type { paths } from "@ryot/generated/openapi/app-backend";
import {
	PostgreSqlContainer,
	type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { config } from "dotenv";
import getPort from "get-port";
import createClient from "openapi-fetch";
import {
	GenericContainer,
	type StartedTestContainer,
	Wait,
} from "testcontainers";

config({ path: ".env" });

let backendPort: number;
let backendProcess: ChildProcess;
let redisContainer: StartedTestContainer;
let pgContainer: StartedPostgreSqlContainer;

async function waitForHealthCheck(
	url: string,
	maxRetries = 30,
	retryDelay = 1000,
) {
	for (let i = 0; i < maxRetries; i++) {
		try {
			const response = await fetch(url);
			if (response.ok) {
				console.log(`[E2E Setup] Health check passed for ${url}`);
				return;
			}
		} catch {
			// Ignore and retry
		}

		if (i < maxRetries - 1) {
			await new Promise((resolve) => setTimeout(resolve, retryDelay));
		}
	}
	throw new Error(`Health check failed for ${url} after ${maxRetries} retries`);
}

beforeAll(async () => {
	console.log("[E2E Setup] Starting containers...");

	pgContainer = await new PostgreSqlContainer("postgres:18-alpine")
		.withDatabase("test_db")
		.withUsername("test_user")
		.withPassword("test_password")
		.withWaitStrategy(Wait.forLogMessage("database system is ready"))
		.start();

	redisContainer = await new GenericContainer("redis:alpine")
		.withExposedPorts(6379)
		.withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
		.start();

	const redisHost = redisContainer.getHost();
	const dbUrl = pgContainer.getConnectionUri();
	const redisPort = redisContainer.getMappedPort(6379);

	backendPort = await getPort();

	const backendEnv = {
		...process.env,
		NODE_ENV: "test",
		DATABASE_URL: dbUrl,
		PORT: backendPort.toString(),
		FRONTEND_URL: "http://localhost:3000",
		SERVER_ADMIN_ACCESS_TOKEN: "test-admin-token",
		REDIS_URL: `redis://${redisHost}:${redisPort}`,
	};

	console.log(`[E2E Setup] Starting backend on port ${backendPort}...`);

	backendProcess = spawn("bun", ["run", "src/index.ts"], {
		env: backendEnv,
		cwd: "../apps/app-backend",
		stdio: ["ignore", "pipe", "pipe"],
	});

	backendProcess.stdout?.on("data", (data) => {
		console.log(`[Backend] ${data}`);
	});

	backendProcess.stderr?.on("data", (data) => {
		console.error(`[Backend] ${data}`);
	});

	const healthCheckUrl = `http://127.0.0.1:${backendPort}/api/system/health`;
	await waitForHealthCheck(healthCheckUrl);

	console.log("[E2E Setup] Backend ready!");
}, 120000);

afterAll(async () => {
	console.log("[E2E Teardown] Stopping services...");

	if (backendProcess && !backendProcess.killed) {
		backendProcess.kill("SIGINT");
		await new Promise((resolve) => backendProcess.on("exit", resolve));
		console.log("[E2E Teardown] Backend process stopped");
	}

	await pgContainer?.stop();
	await redisContainer?.stop();

	console.log("[E2E Teardown] Complete!");
});

export function getBackendUrl() {
	return `http://127.0.0.1:${backendPort}/api`;
}

export function getBackendClient() {
	const client = createClient<paths>({ baseUrl: getBackendUrl() });
	return client;
}
