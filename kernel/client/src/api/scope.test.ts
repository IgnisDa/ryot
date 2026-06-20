import { expect, it } from "vitest";

import { apiScopeKey, canonicalApiScope } from "./request-key";

it("canonicalizes equivalent authenticated API scopes", () => {
	const canonical = canonicalApiScope({
		userId: "user-1",
		serverUrl: " https://server.test/// ",
	});
	expect(canonical).toEqual({ userId: "user-1", serverUrl: "https://server.test" });
	expect(apiScopeKey(canonical)).toBe(
		apiScopeKey({ userId: "user-1", serverUrl: "https://server.test/" }),
	);
});

it("partitions authenticated API scope by server and user", () => {
	const scope = { userId: "user-1", serverUrl: "https://server.test" };
	expect(apiScopeKey({ ...scope, userId: "user-2" })).not.toBe(apiScopeKey(scope));
	expect(apiScopeKey({ ...scope, serverUrl: "https://other.test" })).not.toBe(apiScopeKey(scope));
});
