import { describe, expect, it } from "vitest";

import { apiScopeKey, canonicalApiScope } from "./scope";

describe("API scope", () => {
	it("canonicalizes the server and partitions users and servers", () => {
		const first = apiScopeKey({ serverUrl: " https://one.test/// ", userId: "user-1" });

		expect(first).toBe(apiScopeKey({ serverUrl: "https://one.test", userId: "user-1" }));
		expect(first).not.toBe(apiScopeKey({ serverUrl: "https://one.test", userId: "user-2" }));
		expect(first).not.toBe(apiScopeKey({ serverUrl: "https://two.test", userId: "user-1" }));
	});

	it("keys only normalized server URL and user ID", () => {
		const input = {
			userId: "user-1",
			cookie: "session=secret",
			accessToken: "secret-token",
			serverUrl: "https://one.test/",
		};

		expect(canonicalApiScope(input)).toEqual({ userId: "user-1", serverUrl: "https://one.test" });
		expect(apiScopeKey(input)).toBe('["https://one.test","user-1"]');
		expect(apiScopeKey(input)).not.toContain("secret");
	});
});
