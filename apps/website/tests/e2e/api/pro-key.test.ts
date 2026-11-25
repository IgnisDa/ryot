import { expect } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import { webRequest } from "@ryot-app/testing/web-request";
import { Effect } from "effect";

import { startWebsite } from "../support/harness";
import { websiteTest } from "../support/test";

websiteTest((test) => {
	test.effect(
		"reports key status and separates invalid keys from verifier downtime",
		() =>
			Effect.gen(function* () {
				const { unkey, origin } = yield* startWebsite();
				const verify = (authorization: string) =>
					webRequest(new URL("/api/pro-key/verify", origin), {
						method: "POST",
						headers: { Authorization: authorization },
					});
				const malformed = yield* verify("Basic not-a-key");
				expect(malformed.status).toBe(400);
				expect(unkey.requests).toHaveLength(0);

				const valid = yield* verify("Bearer valid-key");
				expect(valid.status).toBe(200);
				expect(yield* Effect.promise(() => valid.json())).toEqual({
					valid: true,
					expiry: "2031-01-01T00:00:00.000Z",
				});

				const invalid = yield* verify("Bearer invalid-key");
				expect(invalid.status).toBe(200);
				expect(yield* Effect.promise(() => invalid.json())).toEqual({ valid: false });

				const unavailable = yield* verify("Bearer upstream-failure");
				expect(unavailable.status).toBe(503);
				for (const response of [malformed, valid, invalid, unavailable]) {
					expect(response.headers.get("Cache-Control")).toBe("no-store");
				}
			}),
		testTimeout,
	);
});
