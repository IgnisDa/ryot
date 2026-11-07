import { Effect } from "effect";
import getPort from "get-port";

import { afterAll, beforeAll, runPromise } from "./effect-test";
import { setFileHarnessTarget } from "./harness-target";
import {
	buildApiEnv,
	harnessApiEnv,
	startApiProcess,
	startCoreTestInfrastructure,
} from "./provisioning";
import { acquireInChildScope, makeTestResourceScope } from "./resource-scope";

export const startIsolatedApiServer = Effect.fn("startIsolatedApiServer")(function* (input: {
	readonly label: string;
	readonly extraEnv?: Record<string, string | undefined>;
}) {
	const bucketName = `ryot-${input.label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
	const [infrastructure, port] = yield* Effect.all(
		[startCoreTestInfrastructure({ bucketName }), Effect.promise(() => getPort())],
		{ concurrency: "unbounded" },
	);
	const env = buildApiEnv({
		port,
		label: input.label,
		s3BucketName: bucketName,
		dbUrl: infrastructure.dbUrl,
		s3Endpoint: infrastructure.s3Endpoint,
		frontendUrl: `http://127.0.0.1:${port}`,
		extraEnv: { ...harnessApiEnv, ...input.extraEnv },
	});
	const apiProcess = yield* startApiProcess(env, input.label);
	return { target: apiProcess.target };
}, acquireInChildScope);

export const startIsolatedHarness = (
	label: string,
	extraEnv?: Record<string, string | undefined>,
) => {
	const resources = makeTestResourceScope();
	return resources
		.run(startIsolatedApiServer({ label, extraEnv }))
		.pipe(Effect.map((server) => ({ target: server.target, stop: resources.close })));
};

/**
 * Runs the calling file against its own server. Files that change instance-wide state, such as
 * system plugins, use it so pages open in other files never see those changes.
 */
export const runFileOnIsolatedServer = (label: string) => {
	const resources = makeTestResourceScope();
	beforeAll(() =>
		runPromise(
			resources.run(
				startIsolatedApiServer({ label }).pipe(
					Effect.tap((server) => Effect.sync(() => setFileHarnessTarget(server.target))),
				),
			),
		),
	);
	afterAll(() => runPromise(resources.close));
};
