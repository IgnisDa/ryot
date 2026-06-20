import { describe, expect, it } from "vitest";

import { decodeServerOrigin } from "#/api/origin";
import { apiScopeKey } from "#/api/scope";

describe("API scope", () => {
	it("uses canonical origins to partition users and servers", () => {
		const firstOrigin = decodeServerOrigin("https://one.test");
		const first = apiScopeKey({ serverUrl: firstOrigin, userId: "user-1" });

		expect(first).toBe(
			apiScopeKey({ serverUrl: decodeServerOrigin("https://one.test/"), userId: "user-1" }),
		);
		expect(first).not.toBe(apiScopeKey({ serverUrl: firstOrigin, userId: "user-2" }));
		expect(first).not.toBe(
			apiScopeKey({ serverUrl: decodeServerOrigin("https://two.test"), userId: "user-1" }),
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
