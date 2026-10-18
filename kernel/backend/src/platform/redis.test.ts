import { identityTupleKey } from "@ryot-app/contract/modules/plugins/references";
import { describe, expect, it } from "vitest";

import { redisKeys } from "./redis";

const persistentKey = (userId: null | string) =>
	redisKeys.sandboxPersistentCache(userId, ["kernel"], ["kernel", "script-1"], "key");

describe("sandbox cache keys", () => {
	it("isolates persistent cache keys between executing users", () => {
		expect(persistentKey("user-1")).not.toBe(persistentKey("user-2"));
		expect(persistentKey(null)).not.toBe(persistentKey("user-1"));
	});

	it("trims persistent cache keys", () => {
		expect(
			redisKeys.sandboxPersistentCache("user-1", ["kernel"], ["kernel", "script-1"], " key "),
		).toBe(redisKeys.sandboxPersistentCache("user-1", ["kernel"], ["kernel", "script-1"], "key"));
	});

	it("adds a server-run partition to transient sandbox cache keys", () => {
		const tuple = identityTupleKey("user-1", "key");
		expect(redisKeys.sandboxRunCacheNamespace("run-1", tuple)).toBe(
			`ryot:sandbox:cache:run:run-1:${tuple}`,
		);
		expect(redisKeys.sandboxRunCacheNamespace("run-2", tuple)).not.toBe(
			redisKeys.sandboxRunCacheNamespace("run-1", tuple),
		);
	});

	it("keys provider search options by provider and script", () => {
		expect(redisKeys.providerSearchOptions("provider-1", "script-1")).toBe(
			"ryot:provider:search-options:provider-1:script-1",
		);
		expect(redisKeys.providerSearchOptions("provider-1", "script-1")).not.toBe(
			redisKeys.providerSearchOptions("provider-1", "script-2"),
		);
	});
});
