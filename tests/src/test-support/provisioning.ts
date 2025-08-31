import { type ChildProcess, spawn } from "node:child_process";

import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

const S3_ACCESS_KEY = "rustfsadmin";
const S3_SECRET_KEY = "rustfsadmin";
const MAX_BUFFERED_LOG_CHARS = 50000;

const intentionallyStoppedProcesses = new WeakSet<ChildProcess>();
const processLogBuffers = new WeakMap<
	ChildProcess,
	{ flushed: boolean; stderr: string; stdout: string }
>();

function appendLog(buffer: string, data: unknown) {
	const text =
		typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
	const next = `${buffer}${text}`;
	return next.length > MAX_BUFFERED_LOG_CHARS ? next.slice(-MAX_BUFFERED_LOG_CHARS) : next;
}

function flushProcessLogs(proc: ChildProcess, label: string, reason: string) {
	const state = processLogBuffers.get(proc);
	if (state?.flushed) {
		return;
	}

	if (state) {
		state.flushed = true;
	}

	console.error(`[${label}] ${reason}`);

	if (!state) {
		return;
	}

	const stdout = state.stdout.trimEnd();
	const stderr = state.stderr.trimEnd();

	if (stdout) {
		console.error(`[${label}] stdout:\n${stdout}`);
	}

	if (stderr) {
		console.error(`[${label}] stderr:\n${stderr}`);
	}
}

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
	const [pgContainer, redisContainer, s3Container] = await Promise.all([
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

	return {
		dbUrl,
		redisUrl,
		s3Client,
		s3Endpoint,
		pgContainer,
		s3Container,
		redisContainer,
	};
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
	dbUrl: string;
	port: number;
	redisUrl: string;
	s3Endpoint: string;
	frontendUrl: string;
	s3BucketName: string;
	extraEnv?: Record<string, string | undefined>;
}): NodeJS.ProcessEnv {
	return {
		...process.env,
		NODE_ENV: "test",
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
		...input.extraEnv,
	};
}

export function spawnBackendProcess(env: NodeJS.ProcessEnv, cwd = "../apps/app-backend") {
	return spawn("bun", ["run", "src/index.ts"], {
		env,
		cwd,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

export function attachProcessLogs(proc: ChildProcess, label: string) {
	processLogBuffers.set(proc, { flushed: false, stderr: "", stdout: "" });

	proc.stdout?.setEncoding("utf8");
	proc.stderr?.setEncoding("utf8");

	proc.stdout?.on("data", (data) => {
		const state = processLogBuffers.get(proc);
		if (state) {
			state.stdout = appendLog(state.stdout, data);
		}
	});

	proc.stderr?.on("data", (data) => {
		const state = processLogBuffers.get(proc);
		if (state) {
			state.stderr = appendLog(state.stderr, data);
		}
	});

	proc.once("close", (code, signal) => {
		if (!intentionallyStoppedProcesses.has(proc)) {
			flushProcessLogs(
				proc,
				label,
				`exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`,
			);
		}
	});

	proc.once("error", (error) => {
		if (!intentionallyStoppedProcesses.has(proc)) {
			flushProcessLogs(proc, label, `failed to start: ${error.message}`);
		}
	});
}

export async function waitForHealthCheck(
	url: string,
	label: string,
	maxRetries = 30,
	retryDelay = 1000,
) {
	for (let i = 0; i < maxRetries; i++) {
		try {
			// oxlint-disable-next-line no-await-in-loop
			const response = await fetch(url);
			if (response.ok) {
				return;
			}
		} catch {}

		if (i < maxRetries - 1) {
			// oxlint-disable-next-line no-await-in-loop
			await new Promise((resolve) => setTimeout(resolve, retryDelay));
		}
	}

	throw new Error(`[${label}] Health check failed for ${url} after ${maxRetries} retries`);
}

export async function stopBackendProcess(proc?: ChildProcess) {
	if (proc?.exitCode !== null || proc.killed) {
		return;
	}

	await new Promise<void>((resolve) => {
		proc.once("exit", () => resolve());
		if (!proc.kill("SIGINT")) {
			resolve();
			return;
		}

		intentionallyStoppedProcesses.add(proc);
	});
}
