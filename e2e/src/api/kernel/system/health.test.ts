import { Effect } from "effect";

import { getApiClient } from "~/fixtures/kernel";
import { getApiUrl } from "~/support/api";
import { describe, expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/frontend";

describe("Health endpoint", () => {
	it.live("should return healthy status", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const data = yield* client.call((c) => c.system.health());

			expect(data.status).toBe("healthy");
		}),
	);

	it.live("should handle configured CORS preflight requests", () =>
		Effect.gen(function* () {
			const frontendUrl = getFrontendUrl();
			const response = yield* Effect.promise(() =>
				fetch(`${getApiUrl()}/system/health`, {
					method: "OPTIONS",
					headers: {
						Origin: frontendUrl,
						"Access-Control-Request-Method": "GET",
						"Access-Control-Request-Headers": "b3,traceparent",
					},
				}),
			);

			expect(response.status).toBe(204);
			expect(response.headers.get("access-control-allow-origin")).toBe("*");
			expect(response.headers.get("access-control-allow-credentials")).toBeNull();
			expect(response.headers.get("access-control-allow-headers")).toBe("b3,traceparent");
		}),
	);
});
