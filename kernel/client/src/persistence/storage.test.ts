import { describe, expect, it } from "@effect/vitest";
import { SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import {
	ClientStorage,
	clientStorageLayer,
	lastWorkspaceKey,
	rememberedProviderKey,
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
	return { values, storage };
};

describe("browser persistence", () => {
	it.effect("changes and clears only the server selection", () => {
		const { values, storage } = makeStorage([
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
		const { values, storage } = makeStorage();
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
		const { values, storage } = makeStorage();
		const secondUser = { userId: "user-2", serverUrl: oneOrigin };
		const secondServer = { userId: "user-1", serverUrl: twoOrigin };
		const firstScope = { userId: "user-1", serverUrl: oneOrigin };

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
		const scope = { userId: "user-1", serverUrl: oneOrigin };
		const { values, storage } = makeStorage();

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
		const firstScope = { userId: "user-1", serverUrl: oneOrigin };
		const secondUser = { userId: "user-2", serverUrl: oneOrigin };
		const secondServer = { userId: "user-1", serverUrl: twoOrigin };
		const { values, storage } = makeStorage();

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
		const scope = { userId: "user-1", serverUrl: oneOrigin };
		const { values, storage } = makeStorage();

		return Effect.gen(function* () {
			const service = yield* ClientStorage;
			expect(yield* service.getSavedViewLayout(scope, "books")).toBe("grid");
			values.set(savedViewLayoutKey(scope, "books"), "masonry");
			expect(yield* service.getSavedViewLayout(scope, "books")).toBe("grid");
		}).pipe(Effect.provide(clientStorageLayer(storage)));
	});

	it.effect("roundtrips every valid saved-view layout", () => {
		const scope = { userId: "user-1", serverUrl: oneOrigin };
		const { values, storage } = makeStorage();

		return Effect.gen(function* () {
			const service = yield* ClientStorage;
			for (const layout of ["grid", "list", "table"] as const) {
				yield* service.setSavedViewLayout(scope, "books", layout);
				expect(values.get(savedViewLayoutKey(scope, "books"))).toBe(layout);
				expect(yield* service.getSavedViewLayout(scope, "books")).toBe(layout);
			}
		}).pipe(Effect.provide(clientStorageLayer(storage)));
	});

	it.effect("partitions the remembered provider by server, user, and entity schema", () => {
		const firstScope = { userId: "user-1", serverUrl: oneOrigin };
		const secondUser = { userId: "user-2", serverUrl: oneOrigin };
		const secondServer = { userId: "user-1", serverUrl: twoOrigin };
		const { values, storage } = makeStorage();

		return Effect.gen(function* () {
			const service = yield* ClientStorage;
			yield* service.setRememberedProvider(
				firstScope,
				"book",
				SandboxProviderId.make("provider-1"),
			);
			yield* service.setRememberedProvider(
				firstScope,
				"movie",
				SandboxProviderId.make("provider-2"),
			);
			yield* service.setRememberedProvider(
				secondUser,
				"book",
				SandboxProviderId.make("provider-3"),
			);
			yield* service.setRememberedProvider(
				secondServer,
				"book",
				SandboxProviderId.make("provider-4"),
			);

			expect(rememberedProviderKey(firstScope, "book")).not.toBe(
				rememberedProviderKey(firstScope, "movie"),
			);
			expect(rememberedProviderKey(firstScope, "book")).not.toBe(
				rememberedProviderKey(secondUser, "book"),
			);
			expect(rememberedProviderKey(firstScope, "book")).not.toBe(
				rememberedProviderKey(secondServer, "book"),
			);
			expect(values.get(rememberedProviderKey(firstScope, "book"))).toBe("provider-1");
			expect(yield* service.getRememberedProvider(firstScope, "movie")).toBe("provider-2");
			expect(yield* service.getRememberedProvider(secondUser, "book")).toBe("provider-3");
			expect(yield* service.getRememberedProvider(secondServer, "book")).toBe("provider-4");
		}).pipe(Effect.provide(clientStorageLayer(storage)));
	});

	it.effect("returns null when no provider is remembered for the entity schema", () => {
		const scope = { userId: "user-1", serverUrl: oneOrigin };
		const { storage } = makeStorage();

		return Effect.gen(function* () {
			const service = yield* ClientStorage;
			expect(yield* service.getRememberedProvider(scope, "book")).toBeNull();
			yield* service.setRememberedProvider(scope, "book", SandboxProviderId.make("provider-1"));
			expect(yield* service.getRememberedProvider(scope, "movie")).toBeNull();
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
