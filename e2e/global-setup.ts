import { fileURLToPath } from "node:url";

import { startFakeHttpServerScoped } from "@ryot-app/testing/fake-http-server";
import { makeTestResourceScope } from "@ryot-app/testing/resource-scope";
import { Effect, FileSystem, Path } from "effect";
import getPort from "get-port";

import { provideE2eServices } from "./src/support/e2e-runtime";
import { verifyNativeSandboxProvisioning } from "./src/support/native-sandbox-provisioning";
import {
	buildApiEnv,
	harnessApiEnv,
	startApiProcess,
	startCoreTestInfrastructure,
	waitForFrontend,
} from "./src/support/provisioning";

const S3_BUCKET_NAME = "ryot-test";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const serverCwd = fileURLToPath(new URL("../apps/server", import.meta.url));

export default Effect.gen(function* () {
	const resources = yield* Effect.acquireRelease(
		Effect.sync(makeTestResourceScope),
		(acquired) => acquired.close,
	);
	const setup = yield* provideE2eServices(
		resources.run(
			Effect.gen(function* () {
				if (process.platform === "darwin") {
					yield* Effect.acquireRelease(
						Effect.sync(() =>
							Bun.spawn(["caffeinate", "-i", "-w", String(process.pid)], {
								stdout: "ignore",
								stderr: "ignore",
							}),
						),
						(proc) =>
							Effect.gen(function* () {
								proc.kill();
								yield* Effect.promise(() => proc.exited);
							}),
					);
				}
				const build = Bun.spawnSync(
					[
						"bun",
						"turbo",
						"build",
						"--filter=@ryot-app/media-plugin",
						"--filter=@ryot-app/kernel-client",
						"--filter=@ryot-app/fitness-plugin",
						"--filter=@ryot-app/fixture-plugin",
						"--filter=@ryot-app/sandbox",
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
				const verifier = yield* startFakeHttpServerScoped(() =>
					Response.json({ valid: true, expiry: "2030-01-01" }),
				);
				const proKeyEnv = {
					SERVER_PRO_KEY: "e2e-pro-key",
					SERVER_PRO_KEY_VERIFICATION_URL: verifier.url,
				};

				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const logDirectory = yield* fs.makeTempDirectory({ prefix: "ryot-e2e-server-logs-" });
				const apiEnv = buildApiEnv({
					frontendUrl,
					label: "API",
					port: apiPort,
					s3BucketName: S3_BUCKET_NAME,
					dbUrl: coreInfrastructure.dbUrl,
					s3Endpoint: coreInfrastructure.s3Endpoint,
					extraEnv: {
						...harnessApiEnv,
						...proKeyEnv,
						SERVER_LOG_FILE: path.join(logDirectory, "ryot.log"),
					},
				});
				const apiProcess = yield* startApiProcess(apiEnv, "E2E Setup", {
					shared: true,
					cwd: serverCwd,
				});
				yield* waitForFrontend(apiProcess, frontendUrl);

				return {
					proKeyEnv,
					frontendUrl,
					apiPid: apiProcess.pid,
					dbUrl: coreInfrastructure.dbUrl,
					pgLogPath: coreInfrastructure.pgLogPath,
					logFile: String(apiEnv.SERVER_LOG_FILE),
					apiUrl: `http://127.0.0.1:${apiPort}/api`,
					adminToken: String(apiEnv.SERVER_ADMIN_ACCESS_TOKEN),
				};
			}),
		),
	);
	yield* Effect.logInfo(`PostgreSQL logs: ${setup.pgLogPath}`);
	return {
		...setup.proKeyEnv,
		E2E_API_URL: setup.apiUrl,
		E2E_DATABASE_URL: setup.dbUrl,
		E2E_SERVER_LOG_FILE: setup.logFile,
		E2E_FRONTEND_URL: setup.frontendUrl,
		E2E_SERVER_PID: String(setup.apiPid),
		E2E_ADMIN_ACCESS_TOKEN: setup.adminToken,
	};
});
