import { afterAll, beforeAll } from "bun:test";
import type { ChildProcess } from "node:child_process";

import { config } from "dotenv";
import getPort from "get-port";
import { Client as PgClient } from "pg";

import { createBackendClient } from "./fixtures/backend-client";
import { requirePresent } from "./test-support/assertions";
import {
	attachProcessLogs,
	buildBackendEnv,
	startCoreTestInfrastructure,
	spawnBackendProcess,
	stopBackendProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "./test-support/provisioning";

config({ path: ".env" });

const S3_BUCKET_NAME = "ryot-test";

let coreInfrastructure: Awaited<ReturnType<typeof startCoreTestInfrastructure>> | undefined;
let pgClient: PgClient | undefined;
let backendPort: number;
let backendProcess: ChildProcess | undefined;

function requireCoreInfrastructure() {
	return requirePresent(coreInfrastructure, "Test infrastructure is not initialised");
}

function requirePgClient() {
	return requirePresent(pgClient, "PG client is not initialised");
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
			dbUrl: infrastructure.dbUrl,
			frontendUrl: `http://127.0.0.1:${frontendPort}`,
			port: backendPort,
			redisUrl: infrastructure.redisUrl,
			s3BucketName: S3_BUCKET_NAME,
			s3Endpoint: infrastructure.s3Endpoint,
			extraEnv: {
				SERVER_OIDC_CLIENT_ID: "",
				SERVER_OIDC_ISSUER_URL: "",
				SERVER_OIDC_CLIENT_SECRET: "",
			},
		}),
	);
	attachProcessLogs(backendProcess, "Backend");

	const healthCheckUrl = `http://127.0.0.1:${backendPort}/api/system/health`;
	await waitForHealthCheck(healthCheckUrl, "E2E Setup");

	pgClient = new PgClient({ connectionString: infrastructure.dbUrl });
	await pgClient.connect();
}, 120000);

afterAll(async () => {
	if (backendProcess) {
		await stopBackendProcess(backendProcess);
	}

	await Promise.all([pgClient?.end(), stopCoreTestInfrastructure(coreInfrastructure)]);
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

export function getBackendClient() {
	return createBackendClient(getBackendUrl());
}

export function getPgClient() {
	return requirePgClient();
}
