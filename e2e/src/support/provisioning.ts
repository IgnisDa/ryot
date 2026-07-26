import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import {
	startPostgresContainer,
	type StartedPostgresContainer,
	stopPostgresContainer,
} from "@ryot-app/testing/postgres-container";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

const S3_ACCESS_KEY = "rustfsadmin";
const S3_SECRET_KEY = "rustfsadmin";

export type CoreTestInfrastructure = {
	dbUrl: string;
	redisUrl: string;
	pgLogPath: string;
	s3Client: S3Client;
	s3Endpoint: string;
	s3Container: StartedTestContainer;
	postgres: StartedPostgresContainer;
	redisContainer: StartedTestContainer;
};

export async function startCoreTestInfrastructure(input: {
	bucketName: string;
}): Promise<CoreTestInfrastructure> {
	process.env.TESTCONTAINERS_RYUK_DISABLED = "true";
	const [postgres, redisContainer, s3Container] = await Promise.all([
		startPostgresContainer({ label: "e2e" }),
		new GenericContainer("redis:alpine")
			.withExposedPorts(6379)
			.withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
			.start(),
		new GenericContainer("rustfs/rustfs")
			.withExposedPorts(9000)
			.withWaitStrategy(Wait.forHttp("/health", 9000))
			.start(),
	]);

	const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
	const s3Endpoint = `http://${s3Container.getHost()}:${s3Container.getMappedPort(9000)}`;

	const s3Client = new S3Client({
		region: "us-east-1",
		endpoint: s3Endpoint,
		forcePathStyle: true,
		credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
	});

	await s3Client.send(new CreateBucketCommand({ Bucket: input.bucketName }));

	return {
		postgres,
		redisUrl,
		s3Client,
		s3Endpoint,
		s3Container,
		redisContainer,
		dbUrl: postgres.url,
		pgLogPath: postgres.logPath,
	};
}

export async function stopCoreTestInfrastructure(infrastructure?: CoreTestInfrastructure) {
	if (!infrastructure) {
		return;
	}

	await Promise.all([
		stopPostgresContainer(infrastructure.postgres),
		infrastructure.s3Container.stop(),
		infrastructure.redisContainer.stop(),
	]);
}

export function buildApiEnv(input: {
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
	const logFile = join(tmpdir(), `ryot-e2e-${safeLabel}-${Date.now()}-${input.port}.log`);
	console.log(`[${input.label}] api logs -> ${logFile}`);

	return {
		...process.env,
		TZ: "Etc/GMT",
		NODE_ENV: "test",
		SERVER_LOG_LEVEL: "all",
		DATABASE_POOL_MAX: "100",
		SERVER_LOG_FILE: logFile,
		DATABASE_URL: input.dbUrl,
		REDIS_URL: input.redisUrl,
		PORT: input.port.toString(),
		FRONTEND_URL: input.frontendUrl,
		FILE_STORAGE_S3_REGION: "us-east-1",
		FILE_STORAGE_S3_URL: input.s3Endpoint,
		FILE_STORAGE_S3_ACCESS_KEY_ID: S3_ACCESS_KEY,
		SERVER_ADMIN_ACCESS_TOKEN: "test-admin-token",
		FILE_STORAGE_S3_BUCKET_NAME: input.s3BucketName,
		FILE_STORAGE_S3_SECRET_ACCESS_KEY: S3_SECRET_KEY,
		RYOT_PLUGIN_FITNESS_EXERCISE_PRELOAD_LIMIT: "20",
		RYOT_PLUGIN_E2E_SANDBOX_CONFIG_9D6F4B2A_FIXTURE_LIMIT: "17",
		RYOT_PLUGIN_E2E_SANDBOX_CONFIG_9D6F4B2A_FIXTURE_VALUE: "sandbox-plugin-config-value",
		...input.extraEnv,
	};
}

export function spawnApiProcess(env: NodeJS.ProcessEnv, cwd = "../apps/server") {
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

export async function stopApiProcess(proc?: ReturnType<typeof spawn>) {
	return stopProcess(proc, "API");
}

async function stopProcess(proc: ReturnType<typeof spawn> | undefined, label: string) {
	if (proc?.exitCode !== null || proc.killed) {
		return;
	}

	if (!(proc instanceof EventEmitter)) {
		throw new TypeError(`${label} process is not an event emitter`);
	}

	const exited = once(proc, "exit");
	if (proc.kill("SIGINT")) {
		await exited;
	}
}
