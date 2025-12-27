import { afterAll, beforeAll } from "bun:test";
import type { ChildProcess } from "node:child_process";

import getPort from "get-port";
import { Pool as PgPool } from "pg";

import { requirePresent } from "./support/assertions";
import {
	buildBackendEnv,
	startCoreTestInfrastructure,
	spawnBackendProcess,
	stopBackendProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "./support/provisioning";

const S3_BUCKET_NAME = "ryot-test";

let backendPort: number;
let pgPool: PgPool | undefined;
let backendProcess: ChildProcess | undefined;
let coreInfrastructure: Awaited<ReturnType<typeof startCoreTestInfrastructure>> | undefined;

function requireCoreInfrastructure() {
	return requirePresent(coreInfrastructure, "Test infrastructure is not initialised");
}

function requirePgPool() {
	return requirePresent(pgPool, "PG pool is not initialised");
}

beforeAll(async () => {
	coreInfrastructure = await startCoreTestInfrastructure({
		bucketName: S3_BUCKET_NAME,
	});

	const frontendPort = await getPort();

	backendPort = await getPort();
	const infrastructure = requireCoreInfrastructure();

	backendProcess = spawnBackendProcess(
		buildBackendEnv({
			label: "Backend",
			port: backendPort,
			dbUrl: infrastructure.dbUrl,
			s3BucketName: S3_BUCKET_NAME,
			redisUrl: infrastructure.redisUrl,
			s3Endpoint: infrastructure.s3Endpoint,
			frontendUrl: `http://127.0.0.1:${frontendPort}`,
			extraEnv: {
				SERVER_SMTP_USER: "",
				SERVER_SMTP_SERVER: "",
				SERVER_SMTP_PASSWORD: "",
				SERVER_OIDC_CLIENT_ID: "",
				SERVER_OIDC_ISSUER_URL: "",
				SERVER_OIDC_CLIENT_SECRET: "",
				SERVER_DISABLE_NOTIFICATIONS: "false",
				SERVER_SMTP_MAILBOX: "Ryot <no-reply@ryot.io>",
			},
		}),
	);

	const healthCheckUrl = `http://127.0.0.1:${backendPort}/api/system/health`;
	await waitForHealthCheck(healthCheckUrl, "E2E Setup");

	pgPool = new PgPool({ connectionString: infrastructure.dbUrl });
	await pgPool.query("select 1");
}, 120000);

afterAll(async () => {
	if (backendProcess) {
		await stopBackendProcess(backendProcess);
	}

	await Promise.all([pgPool?.end(), stopCoreTestInfrastructure(coreInfrastructure)]);
});

export function getS3Client() {
	return requireCoreInfrastructure().s3Client;
}

export function getS3BucketName() {
	return S3_BUCKET_NAME;
}

export function getBackendUrl() {
	return `http://127.0.0.1:${backendPort}/api`;
}

export function getPgClient() {
	return requirePgPool();
}
