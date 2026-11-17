import { Effect } from "effect";

import { startFakeHttpServerScoped } from "~/support/fake-http-server";
import { startIsolatedApiServer } from "~/support/isolated-harness";

export const startProApiServer = Effect.fn("startProApiServer")(function* (label: string) {
	const fakeUnkey = yield* startFakeHttpServerScoped(() =>
		Response.json({
			meta: { requestId: crypto.randomUUID() },
			data: { valid: true, code: "VALID", meta: { expiry: "2030-01-01" } },
		}),
	);
	return yield* startIsolatedApiServer({
		label,
		extraEnv: { SERVER_PRO_KEY: "e2e-pro-key", SERVER_PRO_KEY_VERIFICATION_URL: fakeUnkey.url },
	});
});
