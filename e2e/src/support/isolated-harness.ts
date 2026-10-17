import { Effect } from "effect";
import getPort from "get-port";

import { requirePresent } from "./assertions";
import {
	buildApiEnv,
	harnessApiEnv,
	spawnApiProcess,
	startCoreTestInfrastructure,
	waitForHealthCheck,
} from "./provisioning";
import { acquireInChildScope, makeTestResourceScope } from "./resource-scope";

const harnessTargetKeys = [
	"E2E_API_URL",
	"E2E_SERVER_PID",
	"E2E_FRONTEND_URL",
	"E2E_SERVER_LOG_FILE",
	"E2E_ADMIN_ACCESS_TOKEN",
] as const;

type HarnessTarget = Readonly<Record<(typeof harnessTargetKeys)[number], string | undefined>>;

// Fixtures read the harness target from the environment on every call, so retargeting it routes
// the whole file to the isolated API until `stop` restores the shared backend.
const setHarnessTarget = (target: HarnessTarget): HarnessTarget => {
	const previous: HarnessTarget = {
		E2E_API_URL: process.env.E2E_API_URL,
		E2E_SERVER_PID: process.env.E2E_SERVER_PID,
		E2E_FRONTEND_URL: process.env.E2E_FRONTEND_URL,
		E2E_SERVER_LOG_FILE: process.env.E2E_SERVER_LOG_FILE,
		E2E_ADMIN_ACCESS_TOKEN: process.env.E2E_ADMIN_ACCESS_TOKEN,
	};
	for (const key of harnessTargetKeys) {
		const value = target[key];
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	return previous;
};

export const retargetHarness = (input: {
	readonly origin: string;
	readonly adminAccessToken: string;
	readonly serverLogFile?: string | undefined;
	readonly serverPid?: number | undefined;
}) =>
	Effect.sync(() => {
		const previous = setHarnessTarget({
			E2E_FRONTEND_URL: input.origin,
			E2E_API_URL: `${input.origin}/api`,
			E2E_SERVER_LOG_FILE: input.serverLogFile,
			E2E_ADMIN_ACCESS_TOKEN: input.adminAccessToken,
			E2E_SERVER_PID: input.serverPid === undefined ? undefined : String(input.serverPid),
		});
		return Effect.sync(() => setHarnessTarget(previous)).pipe(Effect.asVoid);
	});

export const startIsolatedApiServer = Effect.fn("startIsolatedApiServer")(function* (input: {
	readonly label: string;
	readonly extraEnv?: Record<string, string | undefined>;
}) {
	const bucketName = `ryot-${input.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
	const [infrastructure, port] = yield* Effect.all(
		[startCoreTestInfrastructure({ bucketName }), Effect.promise(() => getPort())],
		{ concurrency: "unbounded" },
	);
	const origin = `http://127.0.0.1:${port}`;
	const env = buildApiEnv({
		port,
		label: input.label,
		frontendUrl: origin,
		s3BucketName: bucketName,
		dbUrl: infrastructure.dbUrl,
		redisUrl: infrastructure.redisUrl,
		s3Endpoint: infrastructure.s3Endpoint,
		extraEnv: { ...harnessApiEnv, ...input.extraEnv },
	});
	const apiProcess = yield* spawnApiProcess(env);
	yield* waitForHealthCheck(`${origin}/api/system/health`, input.label, apiProcess, 90);
	return { env, origin, pid: apiProcess.pid, apiUrl: `${origin}/api` };
}, acquireInChildScope);

export const startIsolatedHarness = (label: string) =>
	Effect.gen(function* () {
		const resources = makeTestResourceScope();
		return yield* resources.run(
			Effect.gen(function* () {
				const server = yield* startIsolatedApiServer({ label });
				yield* Effect.acquireRelease(
					retargetHarness({
						serverPid: server.pid,
						origin: server.origin,
						serverLogFile: server.env.SERVER_LOG_FILE,
						adminAccessToken: requirePresent(
							server.env.SERVER_ADMIN_ACCESS_TOKEN,
							"Admin token missing",
						),
					}),
					(restore) => restore,
				).pipe(Effect.asVoid);
				return { stop: resources.close };
			}),
		);
	});
