import { Effect } from "effect";

import { getBackendClient } from "~/fixtures";
import { describe, expect, it } from "~/support/effect-test";

describe("Health endpoint", () => {
	it.live("should return healthy status", () =>
		Effect.gen(function* () {
			const client = getBackendClient();
			const data = yield* client.call((c) => c.system.health());

			expect(data.status).toBe("healthy");
		}),
	);
});
