import { assert, describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { parseServerOrigin } from "../api/origin";
import {
	ClientStorage,
	clientStorageLayer,
	SERVER_SELECTION_KEY,
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
	it.effect("changes and clears only the server selection", () => {
		const { storage, values } = makeStorage([
			["unrelated", "keep"],
			[THEME_PREFERENCE_KEY, "dark"],
			["ryot:other-setting", "keep-too"],
		]);
		const first = parseServerOrigin("https://one.example.com");
		const second = parseServerOrigin("https://two.example.com/base");
		assert(first.ok && second.ok);

		return Effect.gen(function* () {
			const service = yield* ClientStorage;
			yield* service.setServerSelection(first.origin);
			yield* service.setServerSelection(second.origin);
			expect(yield* service.getServerSelection).toBe("https://two.example.com/base");
			yield* service.clearServerSelection;

			expect(values.has(SERVER_SELECTION_KEY)).toBe(false);
			expect(Object.fromEntries(values)).toEqual({
				unrelated: "keep",
				[THEME_PREFERENCE_KEY]: "dark",
				"ryot:other-setting": "keep-too",
			});
		}).pipe(Effect.provide(clientStorageLayer(storage)));
	});

	it.effect("persists valid themes and defaults invalid values to system", () => {
		const { storage, values } = makeStorage();
		return Effect.gen(function* () {
			const service = yield* ClientStorage;
			yield* service.setThemePreference("light");
			expect(values.get(THEME_PREFERENCE_KEY)).toBe("light");
			expect(yield* service.getThemePreference).toBe("light");
			values.set(THEME_PREFERENCE_KEY, "sepia");
			expect(yield* service.getThemePreference).toBe("system");
		}).pipe(Effect.provide(clientStorageLayer(storage)));
	});

	it.effect("ignores a malformed persisted server selection", () => {
		const { storage } = makeStorage([[SERVER_SELECTION_KEY, "javascript:alert(1)"]]);
		return Effect.gen(function* () {
			const service = yield* ClientStorage;
			expect(yield* service.getServerSelection).toBeNull();
		}).pipe(Effect.provide(clientStorageLayer(storage)));
	});
});
