import type { ChildProcess } from "node:child_process";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import getPort from "get-port";

import {
	buildApiEnv,
	spawnApiProcess,
	startCoreTestInfrastructure,
	stopApiProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "./src/support/provisioning";

const S3_BUCKET_NAME = "ryot-test";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const serverCwd = fileURLToPath(new URL("../apps/server", import.meta.url));
const clientDist = fileURLToPath(new URL("../kernel/client/dist", import.meta.url));

export default async function () {
	const build = spawnSync(
		"bun",
		[
			"turbo",
			"build",
			"--filter=@ryot-app/media-plugin",
			"--filter=@ryot-app/kernel-client",
			"--filter=@ryot-app/fitness-plugin",
			"--filter=@ryot-app/fixture-plugin",
		],
		{ stdio: "inherit", cwd: repositoryRoot },
	);
	if (build.status !== 0) {
		throw new Error(`E2E build failed with exit code ${build.status ?? "unknown"}`);
	}

	const assembly = spawnSync("bun", ["run", "assemble"], { cwd: serverCwd, stdio: "inherit" });
	if (assembly.status !== 0) {
		throw new Error(`Server assembly failed with exit code ${assembly.status ?? "unknown"}`);
	}

	const [apiPort, coreInfrastructure] = await Promise.all([
		getPort(),
		startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME }),
	]);
	const frontendUrl = `http://127.0.0.1:${apiPort}`;
	const benchmarkProfileDir = join(tmpdir(), `ryot-e2e-benchmark-profiles-${apiPort}`);

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
				SANDBOX_BENCHMARK_PROFILE_DIR: benchmarkProfileDir,
			},
		});
		apiProcess = spawnApiProcess(apiEnv, serverCwd);

		const healthCheckUrl = `http://127.0.0.1:${apiPort}/api/system/health`;
		await waitForHealthCheck(healthCheckUrl, "E2E Setup");
		await waitForHealthCheck(frontendUrl, "E2E SPA");

		process.env.E2E_FRONTEND_URL = frontendUrl;
		process.env.E2E_API_URL = `http://127.0.0.1:${apiPort}/api`;
		process.env.E2E_ADMIN_ACCESS_TOKEN = String(apiEnv.SERVER_ADMIN_ACCESS_TOKEN);
		process.env.E2E_BENCHMARK_PROFILE_DIR = benchmarkProfileDir;
		console.info(`PostgreSQL logs: ${coreInfrastructure.pgLogPath}`);
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
