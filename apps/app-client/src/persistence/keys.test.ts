import { describe, expect, it } from "vitest";

import { appStorageKey, ownedAppStorageKeys } from "./keys";

describe("app persistence keys", () => {
	it("selects only Ryot-owned keys", () => {
		expect(
			ownedAppStorageKeys([appStorageKey("server-url"), "unrelated", appStorageKey("theme")]),
		).toEqual(["ryot:server-url", "ryot:theme"]);
	});
});
