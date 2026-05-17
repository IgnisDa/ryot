import { type ChildProcess, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

const S3_ACCESS_KEY = "rustfsadmin";
const S3_SECRET_KEY = "rustfsadmin";

export type CoreTestInfrastructure = {
	dbUrl: string;
	redisUrl: string;
	s3Client: S3Client;
	s3Endpoint: string;
	s3Container: StartedTestContainer;
	redisContainer: StartedTestContainer;
	pgContainer: StartedPostgreSqlContainer;
};

export async function startCoreTestInfrastructure(input: {
	bucketName: string;
}): Promise<CoreTestInfrastructure> {
	process.env.TESTCONTAINERS_RYUK_DISABLED = "true";
	const [pgContainer, redisContainer, s3Container] = await Promise.all([
		new PostgreSqlContainer("postgres:18-alpine")
			.withDatabase("test_db")
			.withUsername("test_user")
			.withPassword("test_password")
			.withCommand(["postgres", "-c", "max_connections=400"])
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

	const dbUrl = pgContainer.getConnectionUri();
	const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
	const s3Endpoint = `http://${s3Container.getHost()}:${s3Container.getMappedPort(9000)}`;

	const s3Client = new S3Client({
		region: "us-east-1",
		endpoint: s3Endpoint,
		forcePathStyle: true,
		credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
	});

	await s3Client.send(new CreateBucketCommand({ Bucket: input.bucketName }));

	return { dbUrl, redisUrl, s3Client, s3Endpoint, pgContainer, s3Container, redisContainer };
}

export async function stopCoreTestInfrastructure(infrastructure?: CoreTestInfrastructure) {
	if (!infrastructure) {
		return;
	}

	await Promise.all([
		infrastructure.pgContainer.stop(),
		infrastructure.s3Container.stop(),
		infrastructure.redisContainer.stop(),
	]);
}

export function buildBackendEnv(input: {
	port: number;
	dbUrl: string;
	label: string;
	redisUrl: string;
	s3Endpoint: string;
	frontendUrl: string;
	s3BucketName: string;
	extraEnv?: Record<string, string | undefined>;
}): NodeJS.ProcessEnv {
	const safeLabel = input.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
	const logFile = join(tmpdir(), `ryot-e2e-${safeLabel}-${input.port}-${Date.now()}.log`);
	console.log(`[${input.label}] backend logs -> ${logFile}`);

	return {
		...process.env,
		TZ: "Etc/GMT",
		NODE_ENV: "test",
		DATABASE_POOL_MAX: "100",
		SERVER_LOG_FILE: logFile,
		DATABASE_URL: input.dbUrl,
		REDIS_URL: input.redisUrl,
		PORT: input.port.toString(),
		FRONTEND_URL: input.frontendUrl,
		DATABASE_WORKFLOW_POOL_MAX: "100",
		FILE_STORAGE_S3_REGION: "us-east-1",
		FILE_STORAGE_S3_URL: input.s3Endpoint,
		FILE_STORAGE_S3_ACCESS_KEY_ID: S3_ACCESS_KEY,
		SERVER_ADMIN_ACCESS_TOKEN: "test-admin-token",
		FILE_STORAGE_S3_BUCKET_NAME: input.s3BucketName,
		FILE_STORAGE_S3_SECRET_ACCESS_KEY: S3_SECRET_KEY,
		RYOT_PLUGIN_FITNESS_EXERCISE_PRELOAD_LIMIT: "20",
		RYOT_PLUGIN_E2E_SANDBOX_CONFIG_9D6F4B2A_FIXTURE_LIMIT: "17",
		FILE_STORAGE_LOCAL_SIGNING_SECRET: "test-local-signing-secret",
		RYOT_PLUGIN_E2E_SANDBOX_CONFIG_9D6F4B2A_FIXTURE_VALUE: "sandbox-plugin-config-value",
		FILE_STORAGE_LOCAL_DIR: join(tmpdir(), `ryot-e2e-local-${safeLabel}-${input.port}`),
		FILE_STORAGE_LOCAL_TEMP_DIR: join(tmpdir(), `ryot-e2e-local-temp-${safeLabel}-${input.port}`),
		...input.extraEnv,
	};
}

export function spawnBackendProcess(env: NodeJS.ProcessEnv, cwd = "../apps/app-backend") {
	return spawn("bun", ["run", "src/main.ts"], { env, cwd, stdio: "ignore" });
}

export async function waitForHealthCheck(
	url: string,
	label: string,
	maxRetries = 30,
	retryDelay = 1000,
) {
	const wait = () => new Promise((resolve) => setTimeout(resolve, retryDelay));

	const attempt = async (remainingRetries: number): Promise<void> => {
		try {
			const response = await fetch(url);
			if (response.ok) {
				return;
			}
		} catch {}

		if (remainingRetries <= 1) {
			throw new Error(`[${label}] Health check failed for ${url} after ${maxRetries} retries`);
		}

		await wait();
		return attempt(remainingRetries - 1);
	};

	return attempt(maxRetries);
}

export async function stopBackendProcess(proc?: ChildProcess) {
	if (proc?.exitCode !== null || proc.killed) {
		return;
	}

	await new Promise<void>((resolve) => {
		proc.once("exit", () => resolve());
		if (!proc.kill("SIGINT")) {
			resolve();
		}
	});
}
