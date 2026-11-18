import { Effect, type Scope } from "effect";
import getPort from "get-port";

import type { E2eServices } from "./e2e-runtime";
import { afterAll, beforeAll, runPromise } from "./effect-test";
import { type HarnessTarget, setFileHarnessTarget } from "./harness-target";
import {
	buildApiEnv,
	harnessApiEnv,
	startApiProcess,
	startCoreTestInfrastructure,
} from "./provisioning";
import { acquireInChildScope, makeTestResourceScope } from "./resource-scope";

export const startIsolatedApiServer = Effect.fn("startIsolatedApiServer")(function* (input: {
	readonly label: string;
	readonly frontendHost?: string;
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
		extraEnv: { ...harnessApiEnv, ...input.extraEnv },
		frontendUrl: `http://${input.frontendHost ?? "127.0.0.1"}:${port}`,
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
export const runFileOnIsolatedServer = (
	label: string,
	start: (
		label: string,
	) => Effect.Effect<{ target: HarnessTarget }, unknown, E2eServices | Scope.Scope> = (
		serverLabel,
	) => startIsolatedApiServer({ label: serverLabel }),
) => {
	const resources = makeTestResourceScope();
	beforeAll(() =>
		runPromise(
			resources.run(
				start(label).pipe(
					Effect.tap((server) => Effect.sync(() => setFileHarnessTarget(server.target))),
				),
			),
		),
	);
	afterAll(() => runPromise(resources.close));
};
