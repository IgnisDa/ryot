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
		apiLogFile: string;
		frontendUrl: string;
	}
}

const S3_BUCKET_NAME = "ryot-test";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const serverCwd = fileURLToPath(new URL("../apps/server", import.meta.url));
const clientDist = fileURLToPath(new URL("../kernel/client/dist", import.meta.url));

export default async function ({ provide }: TestProject) {
	const build = spawnSync(
		"bun",
		[
			"turbo",
			"build",
			"--filter=@ryot-app/media-plugin",
			"--filter=@ryot-app/kernel-client",
			"--filter=@ryot-app/fixture-plugin",
		],
		{ stdio: "inherit", cwd: repositoryRoot },
	);
	if (build.status !== 0) {
		throw new Error(`E2E build failed with exit code ${build.status ?? "unknown"}`);
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
	const frontendUrl = `http://127.0.0.1:${apiPort}`;

	let apiProcess: ChildProcess | undefined;
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
				SERVER_CLIENT_DIR: clientDist,
				SERVER_OIDC_CLIENT_SECRET: "",
				SERVER_DISABLE_NOTIFICATIONS: "false",
				SERVER_SMTP_MAILBOX: "Ryot <no-reply@ryot.io>",
			},
		});
		apiProcess = spawnApiProcess(apiEnv, serverCwd);

		const healthCheckUrl = `http://127.0.0.1:${apiPort}/api/system/health`;
		await waitForHealthCheck(healthCheckUrl, "E2E Setup");
		await waitForHealthCheck(frontendUrl, "E2E SPA");

		provide("apiUrl", `http://127.0.0.1:${apiPort}/api`);
		provide("apiLogFile", String(apiEnv.SERVER_LOG_FILE));
		provide("frontendUrl", frontendUrl);
	} catch (error) {
		await stopApiProcess(apiProcess);
		await stopCoreTestInfrastructure(coreInfrastructure);
		throw error;
	}

	return async () => {
		await stopApiProcess(apiProcess);
		await stopCoreTestInfrastructure(coreInfrastructure);
	};
}
