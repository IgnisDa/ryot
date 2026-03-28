import { describe, expect, it } from "vitest";

import { savedViewLayoutStorageKey } from "./storage";

describe("saved-view layout persistence", () => {
	it("scopes its key by normalized server URL, user, and view", () => {
		const scope = { serverUrl: "https://one.test", userId: "user-1", viewSlug: "favorites" };
		expect(savedViewLayoutStorageKey({ ...scope, serverUrl: " https://one.test/ " })).toBe(
			savedViewLayoutStorageKey(scope),
		);
		expect(savedViewLayoutStorageKey({ ...scope, serverUrl: "https://two.test" })).not.toBe(
			savedViewLayoutStorageKey(scope),
		);
		expect(savedViewLayoutStorageKey({ ...scope, userId: "user-2" })).not.toBe(
			savedViewLayoutStorageKey(scope),
		);
	});
});
