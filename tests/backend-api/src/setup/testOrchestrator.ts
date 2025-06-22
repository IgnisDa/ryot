import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import path from "node:path";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import getPort from "get-port";
import type { StartedNetwork, StartedTestContainer } from "testcontainers";
import { GenericContainer, Network, Wait } from "testcontainers";
import { TEST_ADMIN_ACCESS_TOKEN } from "../utils";

const setupProcessLogging = (process: ChildProcess) => {
	process.stdout?.on("data", (data) => {
		console.log(`[Orchestrator] ${data}`);
	});
	process.stderr?.on("data", (data) => {
		console.error(`[Orchestrator] ${data}`);
	});
	process.on("close", (code, signal) => {
		console.log(
			`[Orchestrator] Process closed with code ${code} and signal ${signal}`,
		);
	});
};

export interface StartedServices {
	caddyBaseUrl: string;
	network: StartedNetwork;
	caddyProcess: ChildProcess;
	backendProcess: ChildProcess;
	frontendProcess: ChildProcess;
	minioContainer: StartedTestContainer;
	pgContainer: StartedPostgreSqlContainer;
}

const MONOREPO_ROOT = path.resolve(__dirname, "../../../../");
const MINIO_ACCESS_KEY = "minioadmin";
const MINIO_SECRET_KEY = "minioadmin";
const TEST_BUCKET_NAME = "test-bucket";
const DB_USER = "testuser";
const DB_PASSWORD = "testpassword";
const DB_NAME = "testdb";

async function createMinioBucket(endpoint: string): Promise<void> {
	const s3Client = new S3Client({
		endpoint,
		region: "us-east-1",
		forcePathStyle: true,
		credentials: {
			accessKeyId: MINIO_ACCESS_KEY,
			secretAccessKey: MINIO_SECRET_KEY,
		},
	});
	try {
		await s3Client.send(new CreateBucketCommand({ Bucket: TEST_BUCKET_NAME }));
		console.log(
			`[Orchestrator] MinIO bucket '${TEST_BUCKET_NAME}' created successfully.`,
		);
	} catch (err) {
		if (
			(err as { name?: string }).name === "BucketAlreadyOwnedByYou" ||
			(err as { name?: string }).name === "BucketAlreadyExists"
		) {
			console.log(
				`[Orchestrator] MinIO bucket '${TEST_BUCKET_NAME}' already exists.`,
			);
		} else {
			console.error(
				`[Orchestrator] Error creating MinIO bucket '${TEST_BUCKET_NAME}':`,
				err,
			);
			throw err;
		}
	}
}

async function startFrontendProcess(
	frontendPort: number,
): Promise<ChildProcess> {
	return new Promise((resolve) => {
		console.log(
			`[Orchestrator] Starting frontend process on port ${frontendPort}...`,
		);

		const frontendProcess = spawn(
			"yarn",
			["react-router-serve", "./build/server/index.js"],
			{
				stdio: ["ignore", "pipe", "pipe"],
				cwd: path.join(MONOREPO_ROOT, "apps/frontend"),
				env: { ...process.env, PORT: frontendPort.toString() },
			},
		);

		setupProcessLogging(frontendProcess);

		setTimeout(() => {
			console.log(
				"[Orchestrator] Frontend process assumed ready after 5 seconds.",
			);
			resolve(frontendProcess);
		}, 5000);
	});
}

async function waitForHealthCheck(
	url: string,
	maxRetries = 10,
	retryDelay = 500,
): Promise<void> {
	for (let i = 0; i < maxRetries; i++) {
		try {
			const response = await fetch(url);
			if (response.ok) {
				console.log(`[Orchestrator] Health check passed for ${url}`);
				return;
			}
		} catch {
			// Ignore fetch errors and retry
		}

		if (i < maxRetries - 1) {
			await new Promise((resolve) => setTimeout(resolve, retryDelay));
		}
	}
	throw new Error(`Health check failed for ${url} after ${maxRetries} retries`);
}

async function startCaddyProcess(
	caddyPort: number,
	backendPort: number,
	frontendPort: number,
): Promise<ChildProcess> {
	return new Promise((resolve, reject) => {
		console.log(
			`[Orchestrator] Starting Caddy process on port ${caddyPort}...`,
		);

		const caddyEnv = {
			PORT: caddyPort.toString(),
			CADDY_BACKEND_TARGET: `127.0.0.1:${backendPort}`,
			CADDY_FRONTEND_TARGET: `127.0.0.1:${frontendPort}`,
		};

		const caddyProcess = spawn(
			"caddy",
			["run", "--config", path.join(MONOREPO_ROOT, "ci", "Caddyfile")],
			{
				cwd: MONOREPO_ROOT,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, ...caddyEnv },
			},
		);

		setupProcessLogging(caddyProcess);

		const healthCheckUrl = `http://127.0.0.1:${caddyPort}/health`;

		setTimeout(async () => {
			try {
				await waitForHealthCheck(healthCheckUrl);
				console.log(
					"[Orchestrator] Caddy process ready and health check passed.",
				);
				resolve(caddyProcess);
			} catch (err) {
				console.error("[Orchestrator] Caddy health check failed:", err);
				reject(err);
			}
		}, 2000);
	});
}

async function startBackendProcess(
	dbUrl: string,
	backendPort: number,
	minioEndpoint: string,
): Promise<ChildProcess> {
	return new Promise((resolve) => {
		console.log(
			`[Orchestrator] Starting backend process on port ${backendPort}...`,
		);
		const backendEnv = {
			DATABASE_URL: dbUrl,
			FILE_STORAGE_S3_URL: minioEndpoint,
			SERVER_BACKEND_PORT: backendPort.toString(),
			FILE_STORAGE_S3_BUCKET_NAME: TEST_BUCKET_NAME,
			FILE_STORAGE_S3_ACCESS_KEY_ID: MINIO_ACCESS_KEY,
			SERVER_ADMIN_ACCESS_TOKEN: TEST_ADMIN_ACCESS_TOKEN,
			FILE_STORAGE_S3_SECRET_ACCESS_KEY: MINIO_SECRET_KEY,
		};

		const backendProcess = spawn(
			"cargo",
			["run", "--release", "--bin", "backend"],
			{
				cwd: MONOREPO_ROOT,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, ...backendEnv },
			},
		);

		setupProcessLogging(backendProcess);

		setTimeout(() => {
			console.log(
				"[Orchestrator] Backend process assumed ready after 10 seconds.",
			);
			resolve(backendProcess);
		}, 10000);
	});
}

export async function startAllServices(): Promise<StartedServices> {
	const network = await new Network().start();

	console.log("[Orchestrator] Starting containers in parallel...");
	const [pgContainer, minioContainer] = await Promise.all([
		new PostgreSqlContainer("postgres:16-alpine")
			.withDatabase(DB_NAME)
			.withUsername(DB_USER)
			.withPassword(DB_PASSWORD)
			.withNetwork(network)
			.withNetworkAliases("postgres")
			.withWaitStrategy(
				Wait.forLogMessage("database system is ready to accept connections", 2),
			)
			.start(),
		new GenericContainer("minio/minio:latest")
			.withEnvironment({
				MINIO_ROOT_USER: MINIO_ACCESS_KEY,
				MINIO_ROOT_PASSWORD: MINIO_SECRET_KEY,
			})
			.withCommand(["server", "/data", "--console-address", ":9090"])
			.withNetwork(network)
			.withNetworkAliases("minio")
			.withExposedPorts(9000, 9090)
			.withWaitStrategy(Wait.forHttp("/minio/health/live", 9000))
			.start(),
	]);
	console.log("[Orchestrator] PostgreSQL and MinIO containers started.");

	const dbHost = pgContainer.getHost();
	const dbPort = pgContainer.getPort();
	const minioHost = minioContainer.getHost();
	const minioPort = minioContainer.getMappedPort(9000);
	const minioExternalEndpoint = `http://${minioHost}:${minioPort}`;

	await createMinioBucket(minioExternalEndpoint);

	const [freeBackendPort, freeFrontendPort, freeCaddyPort] = await Promise.all([
		getPort(),
		getPort(),
		getPort(),
	]);
	const backendDbUrl = `postgres://${DB_USER}:${DB_PASSWORD}@${dbHost}:${dbPort}/${DB_NAME}`;

	console.log(
		"[Orchestrator] Starting backend and frontend processes in parallel...",
	);
	const [backendProcess, frontendProcess] = await Promise.all([
		startBackendProcess(backendDbUrl, freeBackendPort, minioExternalEndpoint),
		startFrontendProcess(freeFrontendPort),
	]);

	console.log("[Orchestrator] Starting Caddy process...");
	const caddyProcess = await startCaddyProcess(
		freeCaddyPort,
		freeBackendPort,
		freeFrontendPort,
	);

	const caddyBaseUrl = `http://127.0.0.1:${freeCaddyPort}`;

	return {
		network,
		pgContainer,
		caddyProcess,
		caddyBaseUrl,
		minioContainer,
		backendProcess,
		frontendProcess,
	};
}

export async function stopAllServices(
	services: StartedServices | undefined,
): Promise<void> {
	if (!services) {
		return;
	}

	console.log("[Orchestrator] Stopping all services in parallel...");

	const stopCaddy = async () => {
		try {
			if (services.caddyProcess && !services.caddyProcess.killed) {
				const killed = services.caddyProcess.kill("SIGINT");
				if (killed) {
					await new Promise((resolve) =>
						services.caddyProcess.on("exit", resolve),
					);
					console.log("[Orchestrator] Caddy process terminated.");
				} else {
					console.warn(
						"[Orchestrator] Failed to send SIGINT to Caddy process.",
					);
				}
			}
		} catch (e) {
			console.error("Error stopping Caddy process:", e);
		}
	};

	const stopFrontend = async () => {
		try {
			if (services.frontendProcess && !services.frontendProcess.killed) {
				const killed = services.frontendProcess.kill();
				if (killed) {
					await new Promise((resolve) =>
						services.frontendProcess.on("exit", resolve),
					);
					console.log("[Orchestrator] Frontend process terminated.");
				} else {
					console.warn(
						"[Orchestrator] Failed to send SIGINT to frontend process.",
					);
				}
			}
		} catch (e) {
			console.error("Error stopping frontend process:", e);
		}
	};

	const stopBackend = async () => {
		try {
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
	};

	const stopMinio = async () => {
		try {
			await services.minioContainer.stop();
			console.log("[Orchestrator] MinIO container stopped.");
		} catch (e) {
			console.error("Error stopping MinIO container:", e);
		}
	};

	const stopPostgres = async () => {
		try {
			await services.pgContainer.stop();
			console.log("[Orchestrator] PostgreSQL container stopped.");
		} catch (e) {
			console.error("Error stopping PostgreSQL container:", e);
		}
	};

	const stopNetwork = async () => {
		try {
			await services.network.stop();
			console.log("[Orchestrator] Network stopped.");
		} catch (e) {
			console.error("Error stopping network:", e);
		}
	};

	await Promise.all([
		stopCaddy(),
		stopFrontend(),
		stopBackend(),
		stopMinio(),
		stopPostgres(),
	]);
	await stopNetwork();

	console.log("[Orchestrator] All services stopped.");
}
