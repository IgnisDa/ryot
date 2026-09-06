import { tmpdir } from "node:os";

import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import {
	startPostgresContainer,
	type StartedPostgresContainer,
	stopPostgresContainer,
} from "@ryot-app/testing/postgres-container";
import { Effect } from "effect";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

import { webRequest } from "./web-request";

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

export const startCoreTestInfrastructure = (input: { bucketName: string }) =>
	Effect.gen(function* () {
		const [postgres, redisContainer, s3Container] = yield* Effect.all(
			[
				Effect.promise(() => startPostgresContainer({ label: "e2e" })),
				Effect.promise(() =>
					new GenericContainer("redis:alpine")
						.withExposedPorts(6379)
						.withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
						.start(),
				),
				Effect.promise(() =>
					new GenericContainer("rustfs/rustfs")
						.withExposedPorts(9000)
						.withWaitStrategy(Wait.forHttp("/health", 9000))
						.start(),
				),
			],
			{ concurrency: "unbounded" },
		);

		const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
		const s3Endpoint = `http://${s3Container.getHost()}:${s3Container.getMappedPort(9000)}`;

		const s3Client = new S3Client({
			region: "us-east-1",
			endpoint: s3Endpoint,
			forcePathStyle: true,
			credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
		});

		yield* Effect.promise(() =>
			s3Client.send(new CreateBucketCommand({ Bucket: input.bucketName })),
		);

		return {
			postgres,
			redisUrl,
			s3Client,
			s3Endpoint,
			s3Container,
			redisContainer,
			dbUrl: postgres.url,
			pgLogPath: postgres.logPath,
		} satisfies CoreTestInfrastructure;
	});

export const stopCoreTestInfrastructure = (infrastructure?: CoreTestInfrastructure) =>
	Effect.gen(function* () {
		if (!infrastructure) {
			return;
		}

		yield* Effect.all(
			[
				Effect.promise(() => stopPostgresContainer(infrastructure.postgres)),
				Effect.promise(() => infrastructure.s3Container.stop()),
				Effect.promise(() => infrastructure.redisContainer.stop()),
			],
			{ concurrency: "unbounded" },
		);
	});

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
	const logFile = `${tmpdir()}/ryot-e2e-${safeLabel}-${Date.now()}-${input.port}.log`;
	console.log(
		`[${input.label}] api logs -> ${logFile} (console: ${logFile}.stdout, ${logFile}.stderr)`,
	);

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
		SANDBOX_WORKER_CONCURRENCY: "5",
		FRONTEND_URL: input.frontendUrl,
		FILE_STORAGE_S3_REGION: "us-east-1",
		FILE_STORAGE_S3_URL: input.s3Endpoint,
		FILE_STORAGE_S3_ACCESS_KEY_ID: S3_ACCESS_KEY,
		SERVER_ADMIN_ACCESS_TOKEN: "test-admin-token",
		FILE_STORAGE_S3_BUCKET_NAME: input.s3BucketName,
		FILE_STORAGE_S3_SECRET_ACCESS_KEY: S3_SECRET_KEY,
		RYOT_PLUGIN_E2E_SANDBOX_CONFIG_9D6F4B2A_FIXTURE_LIMIT: "17",
		RYOT_PLUGIN_E2E_SANDBOX_CONFIG_9D6F4B2A_FIXTURE_VALUE: "sandbox-plugin-config-value",
		...input.extraEnv,
	};
}

export function spawnApiProcess(env: NodeJS.ProcessEnv, cwd = "../apps/server") {
	const logFile = env.SERVER_LOG_FILE;
	return Bun.spawn(["bun", "run", "src/main.ts"], {
		env,
		cwd,
		stdin: "ignore",
		stdout: logFile ? Bun.file(`${logFile}.stdout`) : "ignore",
		stderr: logFile ? Bun.file(`${logFile}.stderr`) : "ignore",
	});
}

export const waitForHealthCheck = (
	url: string,
	label: string,
	process: ReturnType<typeof spawnApiProcess>,
	maxRetries = 30,
	retryDelay = 1000,
) =>
	Effect.gen(function* () {
		for (let attempt = 0; attempt < maxRetries; attempt += 1) {
			if (process.exitCode !== null) {
				throw new Error(
					`[${label}] API process exited with code ${process.exitCode} before ${url} became healthy`,
				);
			}
			const healthy = yield* webRequest(url).pipe(
				Effect.map((response) => response.ok),
				Effect.orElseSucceed(() => false),
			);
			if (healthy) {
				return;
			}
			if (attempt < maxRetries - 1) {
				yield* Effect.sleep(retryDelay);
			}
		}
		throw new Error(`[${label}] Health check failed for ${url} after ${maxRetries} retries`);
	});

export const stopApiProcess = (
	proc?: Pick<ReturnType<typeof spawnApiProcess>, "exitCode" | "exited" | "kill">,
) =>
	Effect.gen(function* () {
		if (proc?.exitCode !== null) {
			return;
		}
		proc.kill("SIGINT");
		const exited = yield* Effect.promise(() => proc.exited).pipe(
			Effect.timeoutOption("20 seconds"),
		);
		if (exited._tag === "Some") {
			return;
		}
		// A sent signal does not prove that the tracked child has exited.
		proc.kill("SIGKILL");
		yield* Effect.promise(() => proc.exited);
	});
