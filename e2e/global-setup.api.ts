import type { ChildProcess } from "node:child_process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import getPort from "get-port";
import type { TestProject } from "vitest/node";

import {
	buildApiEnv,
	spawnApiProcess,
	startCoreTestInfrastructure,
	stopApiProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "./src/support/provisioning";

declare module "vitest" {
	export interface ProvidedContext {
		apiUrl: string;
	}
}

const S3_BUCKET_NAME = "ryot-test";

const serverCwd = fileURLToPath(new URL("../apps/server", import.meta.url));

export default async function ({ provide }: TestProject) {
	const assembly = spawnSync("bun", ["run", "assemble"], {
		cwd: serverCwd,
		stdio: "inherit",
	});
	if (assembly.status !== 0) {
		throw new Error(`Server assembly failed with exit code ${assembly.status ?? "unknown"}`);
	}

	const [apiPort, frontendPort, coreInfrastructure] = await Promise.all([
		getPort(),
		getPort(),
		startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME }),
	]);

	const apiProcess: ChildProcess = spawnApiProcess(
		buildApiEnv({
			label: "API",
			port: apiPort,
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
				SERVER_CORS_ORIGINS: "http://client.test",
				SERVER_SMTP_MAILBOX: "Ryot <no-reply@ryot.io>",
			},
		}),
		serverCwd,
	);

	const healthCheckUrl = `http://127.0.0.1:${apiPort}/api/system/health`;
	await waitForHealthCheck(healthCheckUrl, "E2E Setup");

	provide("apiUrl", `http://127.0.0.1:${apiPort}/api`);

	return async () => {
		await stopApiProcess(apiProcess);
		await stopCoreTestInfrastructure(coreInfrastructure);
	};
}
