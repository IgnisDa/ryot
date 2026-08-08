/**
 * TEMPORARY local smoke for the admission probe: disposable infrastructure plus one backend on port
 * 8000, then remote-setup and one probe scenario. Not committed.
 * Usage: bun run src/scripts/sandbox-admission/local-smoke.ts <scenario> <reps>
 */
import { spawnSync } from "node:child_process";

import {
	buildApiEnv,
	spawnApiProcess,
	startCoreTestInfrastructure,
	stopApiProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";

const [scenario = "single", reps = "1"] = process.argv.slice(2);
const infrastructure = await startCoreTestInfrastructure({ bucketName: "ryot-smoke" });
const frontendUrl = "http://127.0.0.1:8000";
const env = buildApiEnv({
	port: 8000,
	frontendUrl,
	label: "smoke",
	s3BucketName: "ryot-smoke",
	dbUrl: infrastructure.dbUrl,
	redisUrl: infrastructure.redisUrl,
	s3Endpoint: infrastructure.s3Endpoint,
	extraEnv: {
		SERVER_LOG_LEVEL: "info",
		SANDBOX_WORKER_CONCURRENCY: "2",
		SCHEDULER_DISABLE_DISPATCHERS: "true",
	},
});
const api = spawnApiProcess(env, new URL("../../../../apps/server", import.meta.url).pathname);
try {
	await waitForHealthCheck(`${frontendUrl}/api/system/health`, "smoke", 180);
	const shared = {
		...process.env,
		E2E_FRONTEND_URL: frontendUrl,
		E2E_API_URL: `${frontendUrl}/api`,
		E2E_ADMIN_ACCESS_TOKEN: String(env.SERVER_ADMIN_ACCESS_TOKEN),
		SERVER_ADMIN_ACCESS_TOKEN: String(env.SERVER_ADMIN_ACCESS_TOKEN),
	};
	const state = "/tmp/adm-smoke-state.json";
	const setup = spawnSync("bun", ["run", "src/scripts/sandbox-admission/remote-setup.ts", state], {
		env: shared,
		stdio: "inherit",
	});
	if (setup.status !== 0) {
		throw new Error("setup failed");
	}
	const probe = spawnSync(
		"bun",
		["src/scripts/sandbox-admission/remote-probe.mjs", state, "smoke", scenario, reps],
		{ env: shared, stdio: "inherit" },
	);
	if (probe.status !== 0) {
		throw new Error("probe failed");
	}
} finally {
	await stopApiProcess(api);
	await stopCoreTestInfrastructure(infrastructure);
}
