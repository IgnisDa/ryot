import { fileURLToPath } from "node:url";

import { Effect, FileSystem, Path } from "effect";
import getPort from "get-port";

import { runPromise } from "./src/support/e2e-runtime";
import { verifyNativeSandboxProvisioning } from "./src/support/native-sandbox-provisioning";
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

// oxlint-disable-next-line effecttsgo/async-function -- Vitest globalSetup owns the Promise-returning setup contract.
export const setupE2e = async (extraEnv: Readonly<Record<string, string | undefined>> = {}) => {
	const setup = await runPromise(
		Effect.gen(function* () {
			const build = Bun.spawnSync(
				[
					"bun",
					"turbo",
					"build",
					"--filter=@ryot-app/media-plugin",
					"--filter=@ryot-app/kernel-client",
					"--filter=@ryot-app/fitness-plugin",
					"--filter=@ryot-app/fixture-plugin",
					"--filter=@ryot-app/sandboxd",
				],
				{ stdin: "inherit", stdout: "inherit", stderr: "inherit", cwd: repositoryRoot },
			);
			if (build.exitCode !== 0) {
				throw new Error(`E2E build failed with exit code ${build.exitCode}`);
			}
			yield* verifyNativeSandboxProvisioning(repositoryRoot);

			const assembly = Bun.spawnSync(["bun", "run", "assemble"], {
				cwd: serverCwd,
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
			});
			if (assembly.exitCode !== 0) {
				throw new Error(`Server assembly failed with exit code ${assembly.exitCode}`);
			}

			const [apiPort, coreInfrastructure] = yield* Effect.all(
				[
					Effect.promise(() => getPort()),
					startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME }),
				],
				{ concurrency: "unbounded" },
			);
			const frontendUrl = `http://127.0.0.1:${apiPort}`;

			let apiProcess: ReturnType<typeof spawnApiProcess> | undefined;
			const shutdown = Effect.gen(function* () {
				yield* stopApiProcess(apiProcess);
				yield* stopCoreTestInfrastructure(coreInfrastructure);
			});
			const startup = Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const logDirectory = yield* fs.makeTempDirectory({ prefix: "ryot-e2e-server-logs-" });
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
						SERVER_LOG_FILE: path.join(logDirectory, "ryot.log"),
						...extraEnv,
					},
				});
				apiProcess = spawnApiProcess(apiEnv, serverCwd);

				const healthCheckUrl = `http://127.0.0.1:${apiPort}/api/system/health`;
				yield* waitForHealthCheck(healthCheckUrl, "E2E Setup", apiProcess);
				yield* waitForHealthCheck(frontendUrl, "E2E SPA", apiProcess);

				return {
					shutdown,
					frontendUrl,
					apiPid: apiProcess.pid,
					pgLogPath: coreInfrastructure.pgLogPath,
					logFile: String(apiEnv.SERVER_LOG_FILE),
					apiUrl: `http://127.0.0.1:${apiPort}/api`,
					adminToken: String(apiEnv.SERVER_ADMIN_ACCESS_TOKEN),
				};
			});
			return yield* startup.pipe(Effect.onError(() => shutdown));
		}),
	);
	process.env.E2E_FRONTEND_URL = setup.frontendUrl;
	process.env.E2E_SERVER_PID = String(setup.apiPid);
	process.env.E2E_API_URL = setup.apiUrl;
	process.env.E2E_ADMIN_ACCESS_TOKEN = setup.adminToken;
	process.env.E2E_SERVER_LOG_FILE = setup.logFile;
	console.info(`PostgreSQL logs: ${setup.pgLogPath}`);
	return () => runPromise(setup.shutdown);
};

export default () => setupE2e();
