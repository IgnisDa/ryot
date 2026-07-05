import { describe, expect, it } from "vitest";

import { redisKeys } from "./redis";

describe("sandbox cache keys", () => {
	it("includes the executing user in sandbox cache keys", () => {
		expect(redisKeys.sandboxCache("user-1", "script-1", "key")).toBe(
			"ryot:sandbox:cache:user:user-1:script-1:key",
		);
	});

	it("isolates the same script cache key between executing users", () => {
		expect(redisKeys.sandboxCache("user-2", "script-1", "key")).not.toBe(
			redisKeys.sandboxCache("user-1", "script-1", "key"),
		);
	});

	it("keeps userless kernel executions in a distinct partition", () => {
		expect(redisKeys.sandboxCache(null, "script-1", "key")).toBe(
			"ryot:sandbox:cache:kernel:script-1:key",
		);
	});

	it("adds a server-run partition to transient sandbox cache keys", () => {
		expect(redisKeys.sandboxRunCache("run-1", "user-1", "script-1", "key")).toBe(
			"ryot:sandbox:cache:run:run-1:user:user-1:script-1:key",
		);
		expect(redisKeys.sandboxRunCache("run-2", "user-1", "script-1", "key")).not.toBe(
			redisKeys.sandboxRunCache("run-1", "user-1", "script-1", "key"),
		);
	});
});
