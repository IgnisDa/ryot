import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import getPort from "get-port";
import type { TestProject } from "vitest/node";

import {
	buildBackendEnv,
	spawnBackendProcess,
	startCoreTestInfrastructure,
	stopBackendProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "./src/support/provisioning";

declare module "vitest" {
	export interface ProvidedContext {
		dbUrl: string;
		backendUrl: string;
	}
}

const S3_BUCKET_NAME = "ryot-test";

const backendCwd = fileURLToPath(new URL("../apps/app-backend", import.meta.url));

export default async function ({ provide }: TestProject) {
	const [backendPort, frontendPort, coreInfrastructure] = await Promise.all([
		getPort(),
		getPort(),
		startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME }),
	]);

	const backendProcess: ChildProcess = spawnBackendProcess(
		buildBackendEnv({
			label: "Backend",
			port: backendPort,
			s3BucketName: S3_BUCKET_NAME,
			dbUrl: coreInfrastructure.dbUrl,
			redisUrl: coreInfrastructure.redisUrl,
			s3Endpoint: coreInfrastructure.s3Endpoint,
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
		backendCwd,
	);

	const healthCheckUrl = `http://127.0.0.1:${backendPort}/api/system/health`;
	await waitForHealthCheck(healthCheckUrl, "E2E Setup");

	provide("dbUrl", coreInfrastructure.dbUrl);
	provide("backendUrl", `http://127.0.0.1:${backendPort}/api`);

	return async () => {
		await stopBackendProcess(backendProcess);
		await stopCoreTestInfrastructure(coreInfrastructure);
	};
}
