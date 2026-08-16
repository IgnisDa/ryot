import { Effect } from "effect";

import { getBackendClient } from "~/fixtures/kernel";
import { getBackendUrl } from "~/support/backend";
import { describe, expect, it } from "~/support/effect-test";

describe("Health endpoint", () => {
	it.live("should return healthy status", () =>
		Effect.gen(function* () {
			const client = getBackendClient();
			const data = yield* client.call((c) => c.system.health());

			expect(data.status).toBe("healthy");
		}),
	);

	it.live("should handle configured CORS preflight requests", () =>
		Effect.gen(function* () {
			const response = yield* Effect.promise(() =>
				fetch(`${getBackendUrl()}/system/health`, {
					method: "OPTIONS",
					headers: {
						Origin: "http://client.test",
						"Access-Control-Request-Method": "GET",
						"Access-Control-Request-Headers": "b3,traceparent",
					},
				}),
			);

			expect(response.status).toBe(204);
			expect(response.headers.get("access-control-allow-origin")).toBe("http://client.test");
			expect(response.headers.get("access-control-allow-credentials")).toBe("true");
			expect(response.headers.get("access-control-allow-headers")).toBe("b3,traceparent");
		}),
	);
});
