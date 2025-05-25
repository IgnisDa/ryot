import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import type { StartedNetwork, StartedTestContainer } from "testcontainers";
import { GenericContainer, Network, Wait } from "testcontainers";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import getPort from "get-port";

export interface StartedServices {
	pgContainer: StartedPostgreSqlContainer;
	minioContainer: StartedTestContainer;
	caddyContainer: StartedTestContainer;
	backendProcess: ChildProcess;
	network: StartedNetwork;
	caddyBaseUrl: string;
	minioHost: string;
	minioPort: number;
	minioAccessKey: string;
	minioSecretKey: string;
	dbHost: string;
	dbPort: number;
	dbUser: string;
	dbPassword: string;
	dbName: string;
}

const MONOREPO_ROOT = path.resolve(__dirname, "../../../../");
const MINIO_ACCESS_KEY = "minioadmin";
const MINIO_SECRET_KEY = "minioadmin";
const TEST_BUCKET_NAME = "test-bucket";
const DB_USER = "testuser";
const DB_PASSWORD = "testpassword";
const DB_NAME = "testdb";

async function createMinioBucket(
	endpoint: string,
	accessKeyId: string,
	secretAccessKey: string,
	bucketName: string,
): Promise<void> {
	const s3Client = new S3Client({
		endpoint,
		credentials: { accessKeyId, secretAccessKey },
		region: "us-east-1",
		forcePathStyle: true,
	});
	try {
		await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
		console.log(
			`[Orchestrator] MinIO bucket '${bucketName}' created successfully.`,
		);
	} catch (err) {
		if (
			(err as { name?: string }).name === "BucketAlreadyOwnedByYou" ||
			(err as { name?: string }).name === "BucketAlreadyExists"
		) {
			console.log(
				`[Orchestrator] MinIO bucket '${bucketName}' already exists.`,
			);
		} else {
			console.error(
				`[Orchestrator] Error creating MinIO bucket '${bucketName}':`,
				err,
			);
			throw err;
		}
	}
}

async function startBackendProcess(
	dbUrl: string,
	minioEndpoint: string,
	minioAccessKey: string,
	minioSecretKey: string,
	backendPort: number,
): Promise<ChildProcess> {
	return new Promise((resolve, reject) => {
		console.log(
			`[Orchestrator] Starting backend process on port ${backendPort}...`,
		);
		const backendEnv = {
			DATABASE_URL: dbUrl,
			FILE_STORAGE_S3_URL: minioEndpoint,
			FILE_STORAGE_S3_ACCESS_KEY_ID: minioAccessKey,
			FILE_STORAGE_S3_SECRET_ACCESS_KEY: minioSecretKey,
			FILE_STORAGE_S3_BUCKET_NAME: TEST_BUCKET_NAME,
			FILE_STORAGE_S3_REGION: "us-east-1",
			BACKEND_PORT: backendPort.toString(),
			SERVER_GRAPHQL_PLAYGROUND_ENABLED: "true",
			USERS_JWT_SECRET: "test-jwt-secret-for-e2e-tests",
		};

		const backendProcess = spawn(
			"cargo",
			["run", "--release", "--bin", "backend"],
			{
				cwd: path.join(MONOREPO_ROOT, "apps", "backend"),
				env: backendEnv,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);

		backendProcess.stdout?.on("data", (data: Buffer) => {
			const output = data.toString();
			for (const line of output.split("\n")) {
				if (line.trim()) console.log(`[Backend STDOUT] ${line.trim()}`);
			}
			if (
				output.includes("Listening on") &&
				output.includes(backendPort.toString())
			) {
				console.log("[Orchestrator] Backend process reported listening.");
				resolve(backendProcess);
			}
		});

		backendProcess.stderr?.on("data", (data: Buffer) => {
			const errorOutput = data.toString();
			for (const line of errorOutput.split("\n")) {
				if (line.trim()) console.error(`[Backend STDERR] ${line.trim()}`);
			}
		});

		backendProcess.on("error", (err) => {
			console.error("[Orchestrator] Failed to start backend process:", err);
			reject(err);
		});

		backendProcess.on("exit", (code, signal) => {
			if (code !== 0 && signal !== "SIGINT" && signal !== "SIGTERM") {
				console.error(
					`[Orchestrator] Backend process exited unexpectedly with code ${code} and signal ${signal}`,
				);
			}
		});
	});
}

export async function startAllServices(): Promise<StartedServices> {
	const network = await new Network().start();

	console.log("[Orchestrator] Starting PostgreSQL container...");
	const pgContainer = await new PostgreSqlContainer("postgres:16-alpine")
		.withDatabase(DB_NAME)
		.withUsername(DB_USER)
		.withPassword(DB_PASSWORD)
		.withNetwork(network)
		.withNetworkAliases("postgres")
		.withWaitStrategy(
			Wait.forLogMessage("database system is ready to accept connections", 2),
		)
		.start();
	console.log("[Orchestrator] PostgreSQL container started.");

	const dbHost = pgContainer.getHost();
	const dbPort = pgContainer.getPort();

	console.log("[Orchestrator] Starting MinIO container...");
	const minioContainer = await new GenericContainer("minio/minio:latest")
		.withEnvironment({
			MINIO_ROOT_USER: MINIO_ACCESS_KEY,
			MINIO_ROOT_PASSWORD: MINIO_SECRET_KEY,
		})
		.withCommand(["server", "/data", "--console-address", ":9090"])
		.withNetwork(network)
		.withNetworkAliases("minio")
		.withExposedPorts(9000, 9090)
		.withWaitStrategy(Wait.forHttp("/minio/health/live", 9000))
		.start();
	console.log("[Orchestrator] MinIO container started.");

	const minioHost = minioContainer.getHost();
	const minioPort = minioContainer.getMappedPort(9000);
	const minioExternalEndpoint = `http://${minioHost}:${minioPort}`;

	await createMinioBucket(
		minioExternalEndpoint,
		MINIO_ACCESS_KEY,
		MINIO_SECRET_KEY,
		TEST_BUCKET_NAME,
	);

	const freeBackendPort = await getPort();
	const backendDbUrl = `postgres://${DB_USER}:${DB_PASSWORD}@${dbHost}:${dbPort}/${DB_NAME}`;

	const backendProcess = await startBackendProcess(
		backendDbUrl,
		minioExternalEndpoint,
		MINIO_ACCESS_KEY,
		MINIO_SECRET_KEY,
		freeBackendPort,
	);

	console.log("[Orchestrator] Starting Caddy container...");
	const caddyContainer = await new GenericContainer("caddy:2.9.1")
		.withNetwork(network)
		.withCopyFilesToContainer([
			{
				source: path.join(MONOREPO_ROOT, "ci", "Caddyfile"),
				target: "/etc/caddy/Caddyfile",
			},
		])
		.withEnvironment({
			CADDY_BACKEND_TARGET: `http://host.docker.internal:${freeBackendPort}`,
		})
		.withExposedPorts(8000)
		.withWaitStrategy(Wait.forHttp("/health", 8000).forStatusCode(200))
		.start();
	console.log("[Orchestrator] Caddy container started.");

	const caddyHost = caddyContainer.getHost();
	const caddyPort = caddyContainer.getMappedPort(8000);
	const caddyBaseUrl = `http://${caddyHost}:${caddyPort}`;

	return {
		pgContainer,
		minioContainer,
		caddyContainer,
		backendProcess,
		network,
		caddyBaseUrl,
		minioHost,
		minioPort,
		minioAccessKey: MINIO_ACCESS_KEY,
		minioSecretKey: MINIO_SECRET_KEY,
		dbHost,
		dbPort,
		dbUser: DB_USER,
		dbPassword: DB_PASSWORD,
		dbName: DB_NAME,
	};
}

export async function stopAllServices(
	services: StartedServices | undefined,
): Promise<void> {
	if (!services) {
		return;
	}
	try {
		console.log("[Orchestrator] Stopping Caddy container...");
		await services.caddyContainer.stop();
	} catch (e) {
		console.error("Error stopping Caddy container:", e);
	}

	try {
		console.log("[Orchestrator] Stopping backend process...");
		if (services.backendProcess && !services.backendProcess.killed) {
			const killed = services.backendProcess.kill("SIGINT");
			if (killed) {
				await new Promise((resolve) =>
					services.backendProcess.on("exit", resolve),
				);
				console.log("[Orchestrator] Backend process terminated.");
			} else {
				console.warn(
					"[Orchestrator] Failed to send SIGINT to backend process.",
				);
			}
		}
	} catch (e) {
		console.error("Error stopping backend process:", e);
	}

	try {
		console.log("[Orchestrator] Stopping MinIO container...");
		await services.minioContainer.stop();
	} catch (e) {
		console.error("Error stopping MinIO container:", e);
	}

	try {
		console.log("[Orchestrator] Stopping PostgreSQL container...");
		await services.pgContainer.stop();
	} catch (e) {
		console.error("Error stopping PostgreSQL container:", e);
	}

	try {
		console.log("[Orchestrator] Stopping network...");
		await services.network.stop();
	} catch (e) {
		console.error("Error stopping network:", e);
	}

	console.log("[Orchestrator] All services stopped.");
}
