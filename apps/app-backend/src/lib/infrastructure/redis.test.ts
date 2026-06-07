import { describe, expect, it } from "vitest";

import { redisKeys } from "./redis";

describe("sandbox cache keys", () => {
	it("keeps regular sandbox cache keys stable", () => {
		expect(redisKeys.sandboxCache("script-1", "key")).toBe("ryot:sandbox:cache:script-1:key");
	});

	it("namespaces get/set cache keys by server run", () => {
		expect(redisKeys.sandboxRunCache("run-1", "script-1", "key")).toBe(
			"ryot:sandbox:cache:run:run-1:script-1:key",
		);
		expect(redisKeys.sandboxRunCache("run-2", "script-1", "key")).not.toBe(
			redisKeys.sandboxRunCache("run-1", "script-1", "key"),
		);
	});
});
