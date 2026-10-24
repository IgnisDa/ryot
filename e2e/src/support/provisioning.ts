import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { CreateBucketCommand, PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";
import {
	startPostgresContainer,
	stopPostgresContainer,
} from "@ryot-app/testing/postgres-container";
import { Effect } from "effect";
import { GenericContainer, Wait } from "testcontainers";

import { acquireInChildScope } from "./resource-scope";
import { webRequest } from "./web-request";

const S3_ACCESS_KEY = "rustfsadmin";
const S3_SECRET_KEY = "rustfsadmin";

export type CoreTestInfrastructure = {
	dbUrl: string;
	redisUrl: string;
	pgLogPath: string;
	s3Endpoint: string;
};

export const acquireCoreTestInfrastructure = Effect.fn("acquireCoreTestInfrastructure")(
	function* (resources: {
		postgres: Effect.Effect<
			Pick<CoreTestInfrastructure, "dbUrl" | "pgLogPath"> & { release: Effect.Effect<void> }
		>;
		redis: Effect.Effect<{ redisUrl: string; release: Effect.Effect<void> }>;
		storage: Effect.Effect<{
			s3Endpoint: string;
			release: Effect.Effect<void>;
			client: Effect.Effect<{
				release: Effect.Effect<void>;
				createBucket: Effect.Effect<void>;
				configureCors: Effect.Effect<void>;
			}>;
		}>;
	}) {
		const [postgres, redis, storage] = yield* Effect.all(
			[
				Effect.acquireRelease(resources.postgres, (resource) => resource.release),
				Effect.acquireRelease(resources.redis, (resource) => resource.release),
				Effect.acquireRelease(resources.storage, (resource) => resource.release),
			],
			{ concurrency: "unbounded" },
		);
		const client = yield* Effect.acquireRelease(storage.client, (resource) => resource.release);
		yield* client.createBucket;
		yield* client.configureCors;
		return {
			dbUrl: postgres.dbUrl,
			redisUrl: redis.redisUrl,
			pgLogPath: postgres.pgLogPath,
			s3Endpoint: storage.s3Endpoint,
		} satisfies CoreTestInfrastructure;
	},
	acquireInChildScope,
);

export const startCoreTestInfrastructure = (input: { bucketName: string }) =>
	acquireCoreTestInfrastructure({
		postgres: Effect.promise(() => startPostgresContainer({ label: "e2e" })).pipe(
			Effect.map((postgres) => ({
				dbUrl: postgres.url,
				pgLogPath: postgres.logPath,
				release: Effect.promise(() => stopPostgresContainer(postgres)),
			})),
		),
		redis: Effect.promise(() =>
			new GenericContainer("redis:alpine")
				.withExposedPorts(6379)
				.withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
				.start(),
		).pipe(
			Effect.map((container) => ({
				release: Effect.promise(() => container.stop()).pipe(Effect.asVoid),
				redisUrl: `redis://${container.getHost()}:${container.getMappedPort(6379)}`,
			})),
		),
		storage: Effect.promise(() =>
			new GenericContainer("rustfs/rustfs")
				.withExposedPorts(9000)
				.withWaitStrategy(Wait.forHttp("/health", 9000))
				.start(),
		).pipe(
			Effect.map((container) => {
				const s3Endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
				return {
					s3Endpoint,
					release: Effect.promise(() => container.stop()).pipe(Effect.asVoid),
					client: Effect.sync(() => {
						const s3Client = new S3Client({
							region: "us-east-1",
							endpoint: s3Endpoint,
							forcePathStyle: true,
							credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
						});
						return {
							release: Effect.sync(() => s3Client.destroy()),
							createBucket: Effect.promise(() =>
								s3Client.send(new CreateBucketCommand({ Bucket: input.bucketName })),
							).pipe(Effect.asVoid),
							configureCors: Effect.promise(() =>
								s3Client.send(
									new PutBucketCorsCommand({
										Bucket: input.bucketName,
										CORSConfiguration: {
											CORSRules: [
												{
													AllowedOrigins: ["*"],
													AllowedHeaders: ["*"],
													AllowedMethods: ["GET", "HEAD", "PUT"],
												},
											],
										},
									}),
								),
							).pipe(Effect.asVoid),
						};
					}),
				};
			}),
		),
	});

export const harnessApiEnv = {
	SERVER_SMTP_USER: "",
	SERVER_SMTP_SERVER: "",
	SERVER_SMTP_PASSWORD: "",
	SERVER_OIDC_CLIENT_ID: "",
	SERVER_OIDC_ISSUER_URL: "",
	SERVER_OIDC_CLIENT_SECRET: "",
	SERVER_DISABLE_NOTIFICATIONS: "false",
	SERVER_SMTP_MAILBOX: "Ryot <no-reply@ryot.io>",
	SERVER_CLIENT_DIR: fileURLToPath(new URL("../../../kernel/client/dist", import.meta.url)),
};

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
	const logFile =
		input.extraEnv?.SERVER_LOG_FILE ??
		`${tmpdir()}/ryot-e2e-${safeLabel}-${Date.now()}-${input.port}.log`;
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
		SERVER_EGRESS_ALLOWED_NETWORKS: "127.0.0.1/32",
		FILE_STORAGE_S3_BUCKET_NAME: input.s3BucketName,
		FILE_STORAGE_S3_SECRET_ACCESS_KEY: S3_SECRET_KEY,
		...input.extraEnv,
	};
}

export const spawnApiProcess = (env: NodeJS.ProcessEnv, cwd = "../apps/server") =>
	Effect.acquireRelease(
		Effect.sync(() => {
			const logFile = env.SERVER_LOG_FILE;
			return Bun.spawn(["bun", "run", "src/main.ts"], {
				env,
				cwd,
				stdin: "ignore",
				stdout: logFile ? Bun.file(`${logFile}.stdout`) : "ignore",
				stderr: logFile ? Bun.file(`${logFile}.stderr`) : "ignore",
			});
		}),
		stopApiProcess,
	);

export const waitForHealthCheck = (
	url: string,
	label: string,
	process: Effect.Success<ReturnType<typeof spawnApiProcess>>,
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

export const stopApiProcess = (proc?: Pick<Bun.Subprocess, "exitCode" | "exited" | "kill">) =>
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
