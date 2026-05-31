import { assert, describe, expect, it } from "vitest";

import { parseServerOrigin } from "../api/origin";
import {
	clearServerSelection,
	getServerSelection,
	getThemePreference,
	SERVER_SELECTION_KEY,
	setServerSelection,
	setThemePreference,
	THEME_PREFERENCE_KEY,
	type BrowserStorage,
} from "./storage";

const makeStorage = (entries: readonly (readonly [string, string])[] = []) => {
	const values = new Map(entries);
	const storage: BrowserStorage = {
		removeItem: (key) => values.delete(key),
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
	};
	return { storage, values };
};

describe("browser persistence", () => {
	it("changes and clears only the server selection", () => {
		const { storage, values } = makeStorage([
			["unrelated", "keep"],
			[THEME_PREFERENCE_KEY, "dark"],
			["ryot:other-setting", "keep-too"],
		]);
		const first = parseServerOrigin("https://one.example.com");
		const second = parseServerOrigin("https://two.example.com/base");
		assert(first.ok && second.ok);

		setServerSelection(first.origin, storage);
		setServerSelection(second.origin, storage);
		expect(getServerSelection(storage)).toBe("https://two.example.com/base");
		clearServerSelection(storage);

		expect(values.has(SERVER_SELECTION_KEY)).toBe(false);
		expect(Object.fromEntries(values)).toEqual({
			unrelated: "keep",
			[THEME_PREFERENCE_KEY]: "dark",
			"ryot:other-setting": "keep-too",
		});
	});

	it("persists valid themes and defaults invalid values to system", () => {
		const { storage, values } = makeStorage();
		setThemePreference("light", storage);
		expect(values.get(THEME_PREFERENCE_KEY)).toBe("light");
		expect(getThemePreference(storage)).toBe("light");
		values.set(THEME_PREFERENCE_KEY, "sepia");
		expect(getThemePreference(storage)).toBe("system");
	});

	it("ignores a malformed persisted server selection", () => {
		const { storage } = makeStorage([[SERVER_SELECTION_KEY, "javascript:alert(1)"]]);
		expect(getServerSelection(storage)).toBeNull();
	});
});
