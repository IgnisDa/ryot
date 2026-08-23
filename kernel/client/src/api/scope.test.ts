import { describe, expect, it } from "vitest";

import { decodeServerOrigin } from "#/api/origin";
import { apiScopeKey } from "#/api/scope";

describe("API scope", () => {
	it("uses canonical origins to partition users and servers", () => {
		const firstOrigin = decodeServerOrigin("https://one.test");
		const first = apiScopeKey({ userId: "user-1", serverUrl: firstOrigin });

		expect(first).toBe(
			apiScopeKey({ userId: "user-1", serverUrl: decodeServerOrigin("https://one.test/") }),
		);
		expect(first).not.toBe(apiScopeKey({ userId: "user-2", serverUrl: firstOrigin }));
		expect(first).not.toBe(
			apiScopeKey({ userId: "user-1", serverUrl: decodeServerOrigin("https://two.test") }),
		);
	});

	it("excludes unrelated fields from the key", () => {
		const input = {
			userId: "user-1",
			cookie: "session=secret",
			accessToken: "secret-token",
			serverUrl: decodeServerOrigin("https://one.test/"),
		};

		expect(apiScopeKey(input)).toBe('["https://one.test","user-1"]');
		expect(apiScopeKey(input)).not.toContain("secret");
	});
});
