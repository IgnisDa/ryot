import { describe, expect, it } from "vitest";

import { appStorageKey, ownedAppStorageKeys, scopedStorageKey } from "./keys";

describe("app persistence keys", () => {
	it("selects only Ryot-owned keys", () => {
		expect(
			ownedAppStorageKeys([appStorageKey("server-url"), "unrelated", appStorageKey("theme")]),
		).toEqual(["ryot:server-url", "ryot:theme"]);
	});

	it("scopes feature storage by canonical server and user", () => {
		expect(
			scopedStorageKey(
				"saved-view-layout",
				{ serverUrl: "HTTPS://EXAMPLE.COM/", userId: "user-1" },
				"watchlist",
			),
		).toBe('saved-view-layout:["HTTPS://EXAMPLE.COM","user-1","watchlist"]');
	});
});
