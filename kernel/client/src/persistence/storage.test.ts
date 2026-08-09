import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import {
	ClientStorage,
	clientStorageLayer,
	lastWorkspaceKey,
	SERVER_SELECTION_KEY,
	savedViewLayoutKey,
	THEME_PREFERENCE_KEY,
	type BrowserStorage,
} from "#/persistence/storage";

const oneOrigin = decodeServerOrigin("https://one.example.com");
const twoOrigin = decodeServerOrigin("https://two.example.com/");

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
		return Effect.gen(function* () {
			const service = yield* ClientStorage;
			yield* service.setServerSelection(oneOrigin);
			yield* service.setServerSelection(twoOrigin);
			expect(yield* service.getServerSelection).toBe(twoOrigin);
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

	it.effect("partitions the last workspace by canonical server and user scope", () => {
		const { storage, values } = makeStorage();
		const secondUser = { serverUrl: oneOrigin, userId: "user-2" };
		const secondServer = { serverUrl: twoOrigin, userId: "user-1" };
		const firstScope = { serverUrl: oneOrigin, userId: "user-1" };

		return Effect.gen(function* () {
			const service = yield* ClientStorage;
			yield* service.setLastWorkspace(firstScope, "media");
			yield* service.setLastWorkspace(secondUser, "fitness");
			yield* service.setLastWorkspace(secondServer, "books");

			expect(values.get('ryot:workspace:["https://one.example.com","user-1"]')).toBe("media");
			expect(yield* service.getLastWorkspace(firstScope)).toBe("media");
			expect(yield* service.getLastWorkspace(secondUser)).toBe("fitness");
			expect(yield* service.getLastWorkspace(secondServer)).toBe("books");
		}).pipe(Effect.provide(clientStorageLayer(storage)));
	});

	it.effect("returns null for missing or malformed last workspaces", () => {
		const scope = { serverUrl: oneOrigin, userId: "user-1" };
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

	it.effect("partitions saved-view layouts by server, user, and slug", () => {
		const firstScope = { serverUrl: oneOrigin, userId: "user-1" };
		const secondUser = { serverUrl: oneOrigin, userId: "user-2" };
		const secondServer = { serverUrl: twoOrigin, userId: "user-1" };
		const { storage, values } = makeStorage();

		return Effect.gen(function* () {
			const service = yield* ClientStorage;
			yield* service.setSavedViewLayout(firstScope, "books", "grid");
			yield* service.setSavedViewLayout(firstScope, "movies", "list");
			yield* service.setSavedViewLayout(secondUser, "books", "table");
			yield* service.setSavedViewLayout(secondServer, "books", "list");

			expect(savedViewLayoutKey(firstScope, "books")).not.toBe(
				savedViewLayoutKey(firstScope, "movies"),
			);
			expect(savedViewLayoutKey(firstScope, "books")).not.toBe(
				savedViewLayoutKey(secondUser, "books"),
			);
			expect(savedViewLayoutKey(firstScope, "books")).not.toBe(
				savedViewLayoutKey(secondServer, "books"),
			);
			expect(values.get(savedViewLayoutKey(firstScope, "books"))).toBe("grid");
			expect(yield* service.getSavedViewLayout(firstScope, "movies")).toBe("list");
			expect(yield* service.getSavedViewLayout(secondUser, "books")).toBe("table");
			expect(yield* service.getSavedViewLayout(secondServer, "books")).toBe("list");
		}).pipe(Effect.provide(clientStorageLayer(storage)));
	});

	it.effect("defaults missing and invalid saved-view layouts to grid", () => {
		const scope = { serverUrl: oneOrigin, userId: "user-1" };
		const { storage, values } = makeStorage();

		return Effect.gen(function* () {
			const service = yield* ClientStorage;
			expect(yield* service.getSavedViewLayout(scope, "books")).toBe("grid");
			values.set(savedViewLayoutKey(scope, "books"), "masonry");
			expect(yield* service.getSavedViewLayout(scope, "books")).toBe("grid");
		}).pipe(Effect.provide(clientStorageLayer(storage)));
	});

	it.effect("roundtrips every valid saved-view layout", () => {
		const scope = { serverUrl: oneOrigin, userId: "user-1" };
		const { storage, values } = makeStorage();

		return Effect.gen(function* () {
			const service = yield* ClientStorage;
			for (const layout of ["grid", "list", "table"] as const) {
				yield* service.setSavedViewLayout(scope, "books", layout);
				expect(values.get(savedViewLayoutKey(scope, "books"))).toBe(layout);
				expect(yield* service.getSavedViewLayout(scope, "books")).toBe(layout);
			}
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
