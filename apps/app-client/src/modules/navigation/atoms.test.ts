import { describe, expect, it } from "vitest";

import { workspaceStorageKey } from "./storage";

describe("workspace persistence", () => {
	it("scopes its key by normalized server URL and user", () => {
		expect(workspaceStorageKey({ serverUrl: " https://one.test/ ", userId: "user-1" })).toBe(
			workspaceStorageKey({ serverUrl: "https://one.test", userId: "user-1" }),
		);
		expect(workspaceStorageKey({ serverUrl: "https://two.test", userId: "user-1" })).not.toBe(
			workspaceStorageKey({ serverUrl: "https://one.test", userId: "user-1" }),
		);
		expect(workspaceStorageKey({ serverUrl: "https://one.test", userId: "user-2" })).not.toBe(
			workspaceStorageKey({ serverUrl: "https://one.test", userId: "user-1" }),
		);
	});
});
