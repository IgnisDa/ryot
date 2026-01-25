import type { ChildProcess } from "node:child_process";

import { buildExerciseListQueryDocument } from "@ryot/plugin-fitness/query-recipes";
import { Duration, Effect } from "effect";
import getPort from "get-port";

import { createAuthenticatedClient, executeQueryEngine } from "~/fixtures";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";
import {
	buildBackendEnv,
	spawnBackendProcess,
	startCoreTestInfrastructure,
	stopBackendProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";

const S3_BUCKET_NAME = "ryot-plugin-boot-test";
const SEEDED_EXERCISE_NAME = "3/4 Sit-Up";

let backendPort: number;
let backendProcess: ChildProcess | undefined;
let coreInfrastructure: Awaited<ReturnType<typeof startCoreTestInfrastructure>> | undefined;

function getBackendUrl() {
	return `http://127.0.0.1:${backendPort}/api`;
}

beforeAll(async () => {
	const [infrastructure, port] = await Promise.all([
		startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME }),
		getPort(),
	]);
	backendPort = port;
	coreInfrastructure = infrastructure;

	const backendOrigin = `http://127.0.0.1:${backendPort}`;
	const env = buildBackendEnv({
		port: backendPort,
		frontendUrl: backendOrigin,
		dbUrl: infrastructure.dbUrl,
		s3BucketName: S3_BUCKET_NAME,
		redisUrl: infrastructure.redisUrl,
		label: "Plugin Boot Disabled Backend",
		s3Endpoint: infrastructure.s3Endpoint,
		extraEnv: { SCHEDULER_DISABLE_DISPATCHERS: "true" },
	});
	backendProcess = spawnBackendProcess(env);
	await waitForHealthCheck(`${backendOrigin}/api/system/health`, "Plugin Boot Disabled Setup");
}, 120_000);

afterAll(async () => {
	await stopBackendProcess(backendProcess);
	await stopCoreTestInfrastructure(coreInfrastructure);
});

describe("Plugin boot dispatch", () => {
	it.live("does not seed the exercise catalog when dispatchers are disabled", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(getBackendUrl());

			yield* Effect.sleep(Duration.seconds(5));

			const { data } = yield* executeQueryEngine(
				client,
				buildExerciseListQueryDocument({ limit: 1, name: SEEDED_EXERCISE_NAME }),
			);

			expect(data.items).toHaveLength(0);
		}),
	);
});
