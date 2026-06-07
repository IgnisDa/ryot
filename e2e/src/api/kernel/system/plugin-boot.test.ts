import type { ChildProcess } from "node:child_process";

import { exerciseListRecipe } from "@ryot/fitness-plugin/query-recipes";
import { Duration, Effect } from "effect";
import getPort from "get-port";

import { createAuthenticatedClient, executeRyotQLRecipe } from "~/fixtures/kernel";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";
import {
	buildApiEnv,
	spawnApiProcess,
	startCoreTestInfrastructure,
	stopApiProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";

const S3_BUCKET_NAME = "ryot-plugin-boot-test";
const SEEDED_EXERCISE_NAME = "3/4 Sit-Up";

let apiPort: number;
let apiProcess: ChildProcess | undefined;
let coreInfrastructure: Awaited<ReturnType<typeof startCoreTestInfrastructure>> | undefined;

function getApiUrl() {
	return `http://127.0.0.1:${apiPort}/api`;
}

beforeAll(async () => {
	const [infrastructure, port] = await Promise.all([
		startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME }),
		getPort(),
	]);
	apiPort = port;
	coreInfrastructure = infrastructure;

	const apiOrigin = `http://127.0.0.1:${apiPort}`;
	const env = buildApiEnv({
		port: apiPort,
		frontendUrl: apiOrigin,
		dbUrl: infrastructure.dbUrl,
		s3BucketName: S3_BUCKET_NAME,
		redisUrl: infrastructure.redisUrl,
		label: "Plugin Boot Disabled API",
		s3Endpoint: infrastructure.s3Endpoint,
		extraEnv: { SCHEDULER_DISABLE_DISPATCHERS: "true" },
	});
	apiProcess = spawnApiProcess(env);
	await waitForHealthCheck(`${apiOrigin}/api/system/health`, "Plugin Boot Disabled Setup", 90);
}, 120_000);

afterAll(async () => {
	await stopApiProcess(apiProcess);
	await stopCoreTestInfrastructure(coreInfrastructure);
});

describe("Plugin boot dispatch", () => {
	it.live("does not seed the exercise catalog when dispatchers are disabled", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(getApiUrl());

			yield* Effect.sleep(Duration.seconds(5));

			const result = yield* executeRyotQLRecipe(
				client,
				exerciseListRecipe({ limit: 1, name: SEEDED_EXERCISE_NAME }),
			);

			expect(result.items).toHaveLength(0);
		}),
	);
});
