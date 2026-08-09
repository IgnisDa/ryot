import { assert, describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { parseServerOrigin } from "#/api/origin";
import {
	ClientStorage,
	clientStorageLayer,
	lastWorkspaceKey,
	SERVER_SELECTION_KEY,
	sessionTokenKey,
	THEME_PREFERENCE_KEY,
	type BrowserStorage,
} from "#/persistence/storage";

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

	it.effect("partitions the last workspace by normalized server and user scope", () => {
		const { storage, values } = makeStorage();
		const secondUser = { serverUrl: "https://one.example.com", userId: "user-2" };
		const secondServer = { serverUrl: "https://two.example.com", userId: "user-1" };
		const firstScope = { serverUrl: " https://one.example.com/// ", userId: "user-1" };

		return Effect.gen(function* () {
			const service = yield* ClientStorage;
			yield* service.setLastWorkspace(firstScope, "media");
			yield* service.setLastWorkspace(secondUser, "fitness");
			yield* service.setLastWorkspace(secondServer, "books");

			expect(values.get('ryot:workspace:["https://one.example.com","user-1"]')).toBe("media");
			expect(
				yield* service.getLastWorkspace({ ...firstScope, serverUrl: "https://one.example.com" }),
			).toBe("media");
			expect(yield* service.getLastWorkspace(secondUser)).toBe("fitness");
			expect(yield* service.getLastWorkspace(secondServer)).toBe("books");
		}).pipe(Effect.provide(clientStorageLayer(storage)));
	});

	it.effect("returns null for missing or malformed last workspaces", () => {
		const scope = { serverUrl: "https://one.example.com", userId: "user-1" };
		const { storage, values } = makeStorage();

		return Effect.gen(function* () {
			const service = yield* ClientStorage;
			expect(yield* service.getLastWorkspace(scope)).toBeNull();
			yield* service.setLastWorkspace(scope, "not/a-slug");
			expect(values.has(lastWorkspaceKey(scope))).toBe(false);
			values.set(lastWorkspaceKey(scope), '{"slug":"media"}');
			expect(yield* service.getLastWorkspace(scope)).toBeNull();
		}).pipe(Effect.provide(clientStorageLayer(storage)));
	});

	it.effect("partitions session tokens by normalized server origin", () => {
		const { storage, values } = makeStorage();
		return Effect.gen(function* () {
			const service = yield* ClientStorage;
			yield* service.setSessionToken(" https://one.test/// ", "token-one");
			yield* service.setSessionToken("https://two.test", "token-two");

			expect(values.get(sessionTokenKey("https://one.test"))).toBe("token-one");
			expect(yield* service.getSessionToken("https://one.test/")).toBe("token-one");
			expect(yield* service.getSessionToken("https://two.test")).toBe("token-two");

			yield* service.clearSessionToken(" https://one.test/ ");
			expect(yield* service.getSessionToken("https://one.test")).toBeNull();
			expect(yield* service.getSessionToken("https://two.test")).toBe("token-two");
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
