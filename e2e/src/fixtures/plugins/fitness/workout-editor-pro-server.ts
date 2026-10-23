import { Effect } from "effect";

import { startFakeHttpServerScoped } from "~/support/fake-http-server";
import { startIsolatedApiServer } from "~/support/isolated-harness";

export const workoutEditorProServer = Effect.gen(function* () {
	const fakeUnkey = yield* startFakeHttpServerScoped(() =>
		Response.json({
			meta: { requestId: crypto.randomUUID() },
			data: { valid: true, code: "VALID", meta: { expiry: "2030-01-01" } },
		}),
	);
	return yield* startIsolatedApiServer({
		label: "Workout editor Pro",
		extraEnv: {
			SERVER_PRO_KEY: "e2e-workout-editor-pro-key",
			SERVER_PRO_KEY_VERIFICATION_URL: fakeUnkey.url,
		},
	});
});
