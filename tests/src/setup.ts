import { afterAll, beforeAll } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";

import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { paths } from "@ryot/generated/openapi/app-backend";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { config } from "dotenv";
import getPort from "get-port";
import createClient from "openapi-fetch";
import { Client as PgClient } from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

config({ path: ".env" });

const S3_BUCKET_NAME = "ryot-test";
const S3_ACCESS_KEY = "rustfsadmin";
const S3_SECRET_KEY = "rustfsadmin";

let s3Client: S3Client;
let pgClient: PgClient;
let backendPort: number;
let backendProcess: ChildProcess;
let s3Container: StartedTestContainer;
let redisContainer: StartedTestContainer;
let pgContainer: StartedPostgreSqlContainer;

async function waitForHealthCheck(url: string, maxRetries = 30, retryDelay = 1000) {
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

	[pgContainer, redisContainer, s3Container] = await Promise.all([
		new PostgreSqlContainer("postgres:18-alpine")
			.withDatabase("test_db")
			.withUsername("test_user")
			.withPassword("test_password")
			.withWaitStrategy(Wait.forLogMessage("database system is ready"))
			.start(),
		new GenericContainer("redis:alpine")
			.withExposedPorts(6379)
			.withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
			.start(),
		new GenericContainer("rustfs/rustfs")
			.withExposedPorts(9000)
			.withWaitStrategy(Wait.forHttp("/health", 9000))
			.start(),
	]);

	const redisHost = redisContainer.getHost();
	const dbUrl = pgContainer.getConnectionUri();
	const redisPort = redisContainer.getMappedPort(6379);
	const s3Host = s3Container.getHost();
	const s3MappedPort = s3Container.getMappedPort(9000);
	const s3Endpoint = `http://${s3Host}:${s3MappedPort}`;

	s3Client = new S3Client({
		region: "us-east-1",
		endpoint: s3Endpoint,
		forcePathStyle: true,
		credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
	});

	await s3Client.send(new CreateBucketCommand({ Bucket: S3_BUCKET_NAME }));
	console.log(`[E2E Setup] S3 bucket '${S3_BUCKET_NAME}' created at ${s3Endpoint}`);

	backendPort = await getPort();

	const backendEnv = {
		...process.env,
		NODE_ENV: "test",
		DATABASE_URL: dbUrl,
		PORT: backendPort.toString(),
		FILE_STORAGE_S3_URL: s3Endpoint,
		FILE_STORAGE_S3_REGION: "us-east-1",
		FRONTEND_URL: "http://localhost:3000",
		FILE_STORAGE_S3_BUCKET_NAME: S3_BUCKET_NAME,
		FILE_STORAGE_S3_ACCESS_KEY_ID: S3_ACCESS_KEY,
		SERVER_ADMIN_ACCESS_TOKEN: "test-admin-token",
		REDIS_URL: `redis://${redisHost}:${redisPort}`,
		FILE_STORAGE_S3_SECRET_ACCESS_KEY: S3_SECRET_KEY,
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

	pgClient = new PgClient({ connectionString: dbUrl });
	await pgClient.connect();

	console.log("[E2E Setup] Backend ready!");
}, 120000);

afterAll(async () => {
	console.log("[E2E Teardown] Stopping services...");

	if (backendProcess && !backendProcess.killed) {
		backendProcess.kill("SIGINT");
		await new Promise((resolve) => backendProcess.on("exit", resolve));
		console.log("[E2E Teardown] Backend process stopped");
	}

	await Promise.all([
		pgClient?.end(),
		pgContainer?.stop(),
		s3Container?.stop(),
		redisContainer?.stop(),
	]);

	console.log("[E2E Teardown] Complete!");
});

export function getS3Client() {
	return s3Client;
}

export function getS3BucketName() {
	return S3_BUCKET_NAME;
}

export function getBackendUrl() {
	return `http://127.0.0.1:${backendPort}/api`;
}

export function getBackendClient() {
	const client = createClient<paths>({ baseUrl: getBackendUrl() });
	return client;
}

export function getPgClient() {
	return pgClient;
}
