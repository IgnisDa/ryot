import { Effect } from "effect";
import getPort from "get-port";

import { startFakeHttpServerScoped } from "~/support/fake-http-server";
import {
	buildApiEnv,
	harnessApiEnv,
	spawnApiProcess,
	startCoreTestInfrastructure,
	stopApiProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";

const S3_BUCKET_NAME = "ryot-workout-editor-pro-test";

export const workoutEditorProServer = Effect.gen(function* () {
	const infrastructure = yield* Effect.acquireRelease(
		startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME }),
		stopCoreTestInfrastructure,
	);
	const fakeUnkey = yield* startFakeHttpServerScoped(() =>
		Response.json({
			meta: { requestId: crypto.randomUUID() },
			data: { valid: true, code: "VALID", meta: { expiry: "2030-01-01" } },
		}),
	);
	const port = yield* Effect.promise(() => getPort());
	const frontendUrl = `http://127.0.0.1:${port}`;
	const apiProcess = yield* Effect.acquireRelease(
		Effect.sync(() =>
			spawnApiProcess(
				buildApiEnv({
					port,
					frontendUrl,
					label: "Workout editor Pro",
					dbUrl: infrastructure.dbUrl,
					s3BucketName: S3_BUCKET_NAME,
					redisUrl: infrastructure.redisUrl,
					s3Endpoint: infrastructure.s3Endpoint,
					extraEnv: {
						...harnessApiEnv,
						SERVER_PRO_KEY: "e2e-workout-editor-pro-key",
						SERVER_PRO_KEY_VERIFICATION_URL: fakeUnkey.url,
					},
				}),
			),
		),
		stopApiProcess,
	);

	yield* waitForHealthCheck(
		`${frontendUrl}/api/system/health`,
		"Workout editor Pro API setup",
		apiProcess,
		90,
	);
	yield* waitForHealthCheck(frontendUrl, "Workout editor Pro frontend setup", apiProcess, 90);

	return { frontendUrl, apiUrl: `${frontendUrl}/api` };
});
