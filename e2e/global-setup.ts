import type { ChildProcess } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
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

const defaultRepositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const digest = (contents: Uint8Array) => createHash("sha256").update(contents).digest("hex");
const sourceManifest = async (repositoryRoot: string) => {
	const roots = [
		"bun.lock",
		"kernel/client/vite.config.ts",
		"kernel/client/src/routes/_authenticated",
		"packages/client-plugin-compiler/src",
		"packages/client-sdk/src",
		"packages/client-ui-sdk/src",
		"plugins/stylex-tracer/client",
		"plugins/stylex-tracer/host",
	] as const;
	const sourcePaths = await Promise.all(
		roots.map(async (root) => {
			const rootStat = await stat(`${repositoryRoot}/${root}`);
			if (rootStat.isFile()) {
				return [root];
			}
			return Array.fromAsync(
				new Bun.Glob("**/*").scan({ onlyFiles: true, cwd: `${repositoryRoot}/${root}` }),
			).then((files) => files.map((path) => `${root}/${path}`));
		}),
	);
	const paths = sourcePaths
		.flat()
		.filter((path) => !/\.(?:test|spec)\./.test(path))
		.sort();
	const files = await Promise.all(
		paths.map(async (path) => {
			const contents = new Uint8Array(await Bun.file(`${repositoryRoot}/${path}`).arrayBuffer());
			return { path, sha256: digest(contents), bytes: contents.byteLength };
		}),
	);
	const encoded = new TextEncoder().encode(JSON.stringify(files));
	return { files, sha256: digest(encoded) };
};

export default async function () {
	const stylexTracer = process.env.RUN_STYLEX_TRACER_E2E === "1";
	const hmr = process.env.RUN_STYLEX_TRACER_HMR_E2E === "1";
	const repositoryRoot = hmr
		? (process.env.STYLEX_TRACER_HMR_ROOT ?? defaultRepositoryRoot)
		: defaultRepositoryRoot;
	const serverCwd = `${repositoryRoot}/apps/server`;
	const clientDist = `${repositoryRoot}/kernel/client/dist`;
	const ordinaryBuildEnv = { ...process.env };
	delete ordinaryBuildEnv.RYOT_STYLEX_TRACER;
	const buildFilters = [
		"--filter=@ryot-app/media-plugin",
		"--filter=@ryot-app/fitness-plugin",
		"--filter=@ryot-app/fixture-plugin",
		...(stylexTracer ? [] : ["--filter=@ryot-app/kernel-client"]),
	];
	const build = spawnSync("bun", ["turbo", "build", ...buildFilters], {
		stdio: "inherit",
		cwd: repositoryRoot,
		env: ordinaryBuildEnv,
	});
	if (build.status !== 0) {
		throw new Error(`E2E build failed with exit code ${build.status ?? "unknown"}`);
	}
	if (stylexTracer) {
		const tracerBuild = spawnSync(
			"bun",
			[
				"turbo",
				"build",
				"--env-mode=loose",
				"--force",
				"--filter=@ryot-app/kernel-client",
				"--filter=@ryot-app/stylex-tracer-plugin",
			],
			{ stdio: "inherit", cwd: repositoryRoot, env: { ...process.env, RYOT_STYLEX_TRACER: "1" } },
		);
		if (tracerBuild.status !== 0) {
			throw new Error(
				`StyleX tracer E2E build failed with exit code ${tracerBuild.status ?? "unknown"}`,
			);
		}
	}

	const assembly = spawnSync("bun", ["run", "assemble"], { cwd: serverCwd, stdio: "inherit" });
	if (assembly.status !== 0) {
		throw new Error(`Server assembly failed with exit code ${assembly.status ?? "unknown"}`);
	}

	const [apiPort, coreInfrastructure] = await Promise.all([
		getPort(hmr ? { port: 3000 } : undefined),
		startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME }),
	]);
	if (hmr && apiPort !== 3000) {
		await stopCoreTestInfrastructure(coreInfrastructure);
		throw new Error("StyleX tracer HMR requires free backend port 3000 for the Vite proxy");
	}
	const frontendUrl = hmr ? "http://localhost:3005" : `http://127.0.0.1:${apiPort}`;

	let apiProcess: ChildProcess | undefined;
	let clientProcess: ChildProcess | undefined;
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
				RYOT_STYLEX_TRACER: stylexTracer ? "1" : undefined,
			},
		});
		apiProcess = spawnApiProcess(apiEnv, serverCwd);

		const healthCheckUrl = `http://127.0.0.1:${apiPort}/api/system/health`;
		await waitForHealthCheck(healthCheckUrl, "E2E Setup");
		if (hmr) {
			const startedClient = spawn("bun", ["run", "dev", "--", "--host", "localhost"], {
				stdio: "ignore",
				cwd: `${repositoryRoot}/kernel/client`,
				env: { ...process.env, RYOT_STYLEX_TRACER: "1" },
			});
			clientProcess = startedClient;
			process.env.E2E_VITE_PROCESS_ID = String(startedClient.pid);
		}
		await waitForHealthCheck(frontendUrl, "E2E SPA");
		if (hmr) {
			process.env.E2E_FRONTEND_ASSET_MODE = "vite-development";
		} else {
			const builtIndex = await readFile(`${clientDist}/index.html`);
			const servedResponse = await fetch(frontendUrl);
			const servedIndex = new Uint8Array(await servedResponse.arrayBuffer());
			const builtIndexSha256 = digest(builtIndex);
			const servedIndexSha256 = digest(servedIndex);
			if (builtIndexSha256 !== servedIndexSha256) {
				throw new Error(
					"E2E backend did not serve the kernel production build from SERVER_CLIENT_DIR",
				);
			}
			process.env.E2E_FRONTEND_ASSET_MODE = "production";
			process.env.E2E_FRONTEND_INDEX_SHA256 = builtIndexSha256;
			process.env.E2E_STYLEX_SOURCE_MANIFEST = JSON.stringify(await sourceManifest(repositoryRoot));
			process.env.E2E_STYLEX_BASELINE_HEAD = spawnSync("git", ["rev-parse", "HEAD"], {
				encoding: "utf8",
				cwd: repositoryRoot,
			}).stdout.trim();
		}

		process.env.E2E_FRONTEND_URL = frontendUrl;
		process.env.E2E_API_URL = `http://127.0.0.1:${apiPort}/api`;
		process.env.E2E_ADMIN_ACCESS_TOKEN = String(apiEnv.SERVER_ADMIN_ACCESS_TOKEN);
		process.env.E2E_BACKEND_PROCESS_ID = String(apiProcess.pid);
	} catch (error) {
		await stopApiProcess(clientProcess);
		await stopApiProcess(apiProcess);
		await stopCoreTestInfrastructure(coreInfrastructure);
		throw error;
	}

	return async () => {
		await stopApiProcess(clientProcess);
		await stopApiProcess(apiProcess);
		await stopCoreTestInfrastructure(coreInfrastructure);
	};
}
