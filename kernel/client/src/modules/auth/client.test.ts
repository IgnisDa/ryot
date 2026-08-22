import { describe, expect, it } from "vitest";

import type { BrowserStorage } from "../../persistence/storage";
import { BETTER_AUTH_STORAGE_KEYS, clearAuthStorage, getAuthClient } from "./client";

const makeStorage = (entries: readonly (readonly [string, string])[]) => {
	const values = new Map(entries);
	const storage: BrowserStorage = {
		removeItem: (key) => values.delete(key),
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
	};
	return { storage, values };
};

describe("browser auth client", () => {
	it("caches clients by normalized server origin", () => {
		const first = getAuthClient(" https://one.test/// ");

		expect(getAuthClient("https://one.test")).toBe(first);
		expect(getAuthClient("https://two.test")).not.toBe(first);
	});

	it("clears only Better Auth storage and resets cached clients", () => {
		const first = getAuthClient("https://one.test");
		const { storage, values } = makeStorage([
			["unrelated", "keep"],
			["ryot:theme", "dark"],
			["ryot:other-setting", "keep"],
			[BETTER_AUTH_STORAGE_KEYS[0], "session-event"],
		]);

		clearAuthStorage(storage);

		expect(Object.fromEntries(values)).toEqual({
			unrelated: "keep",
			"ryot:theme": "dark",
			"ryot:other-setting": "keep",
		});
		expect(getAuthClient("https://one.test")).not.toBe(first);
	});
});
