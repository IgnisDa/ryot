import type { ChildProcess } from "node:child_process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import getPort from "get-port";
import type { TestProject } from "vitest/node";

import {
	buildApiEnv,
	spawnApiProcess,
	spawnFrontendProcess,
	startCoreTestInfrastructure,
	stopApiProcess,
	stopCoreTestInfrastructure,
	stopFrontendProcess,
	waitForHealthCheck,
} from "./src/support/provisioning";

declare module "vitest" {
	export interface ProvidedContext {
		apiUrl: string;
		apiLogFile: string;
		frontendUrl: string;
	}
}

const S3_BUCKET_NAME = "ryot-test";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const serverCwd = fileURLToPath(new URL("../apps/server", import.meta.url));
const frontendCwd = fileURLToPath(new URL("../kernel/client", import.meta.url));

export default async function ({ provide }: TestProject) {
	const fixturePluginBuild = spawnSync("bun", ["turbo", "--filter=@ryot/fixture-plugin", "build"], {
		stdio: "inherit",
		cwd: repositoryRoot,
	});
	if (fixturePluginBuild.status !== 0) {
		throw new Error(
			`Fixture plugin build failed with exit code ${fixturePluginBuild.status ?? "unknown"}`,
		);
	}

	const assembly = spawnSync("bun", ["run", "assemble"], {
		cwd: serverCwd,
		stdio: "inherit",
	});
	if (assembly.status !== 0) {
		throw new Error(`Server assembly failed with exit code ${assembly.status ?? "unknown"}`);
	}

	const [apiPort, coreInfrastructure] = await Promise.all([
		getPort(),
		startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME }),
	]);
	const frontendPort = await getPort({ exclude: [apiPort] });
	const frontendUrl = `http://127.0.0.1:${frontendPort}`;

	let apiProcess: ChildProcess | undefined;
	let frontendProcess: ChildProcess | undefined;
	try {
		const apiEnv = buildApiEnv({
			frontendUrl,
			label: "API",
			port: apiPort,
			s3BucketName: S3_BUCKET_NAME,
			dbUrl: coreInfrastructure.dbUrl,
			redisUrl: coreInfrastructure.redisUrl,
			s3Endpoint: coreInfrastructure.s3Endpoint,
			extraEnv: {
				SERVER_SMTP_USER: "",
				SERVER_SMTP_SERVER: "",
				SERVER_SMTP_PASSWORD: "",
				SERVER_OIDC_CLIENT_ID: "",
				SERVER_OIDC_ISSUER_URL: "",
				SERVER_OIDC_CLIENT_SECRET: "",
				SERVER_CORS_ORIGINS: frontendUrl,
				SERVER_DISABLE_NOTIFICATIONS: "false",
				SERVER_SMTP_MAILBOX: "Ryot <no-reply@ryot.io>",
			},
		});
		apiProcess = spawnApiProcess(apiEnv, serverCwd);

		const healthCheckUrl = `http://127.0.0.1:${apiPort}/api/system/health`;
		await waitForHealthCheck(healthCheckUrl, "E2E Setup");

		frontendProcess = spawnFrontendProcess(frontendPort, frontendCwd);
		await waitForHealthCheck(frontendUrl, "E2E Frontend");

		provide("apiUrl", `http://127.0.0.1:${apiPort}/api`);
		provide("apiLogFile", String(apiEnv.SERVER_LOG_FILE));
		provide("frontendUrl", frontendUrl);
	} catch (error) {
		await stopFrontendProcess(frontendProcess);
		await stopApiProcess(apiProcess);
		await stopCoreTestInfrastructure(coreInfrastructure);
		throw error;
	}

	return async () => {
		await stopFrontendProcess(frontendProcess);
		await stopApiProcess(apiProcess);
		await stopCoreTestInfrastructure(coreInfrastructure);
	};
}
