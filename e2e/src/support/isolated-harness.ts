import { Effect } from "effect";
import getPort from "get-port";

import {
	buildApiEnv,
	harnessApiEnv,
	spawnApiProcess,
	startCoreTestInfrastructure,
	waitForHealthCheck,
} from "./provisioning";
import { acquireInChildScope, makeTestResourceScope } from "./resource-scope";

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
	const target = apiProcess.target;
	return { env, origin, target, pid: apiProcess.pid, apiUrl: target.apiUrl };
}, acquireInChildScope);

export const startIsolatedHarness = (label: string) =>
	Effect.gen(function* () {
		const resources = makeTestResourceScope();
		return yield* resources.run(
			Effect.gen(function* () {
				const server = yield* startIsolatedApiServer({ label });
				return { target: server.target, stop: resources.close };
			}),
		);
	});
