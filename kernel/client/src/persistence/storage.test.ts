import { describe, expect, layer } from "@effect/vitest";
import { PluginId, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import {
	ClientStorage,
	clientStorageLayer,
	PluginStorageAccessError,
	pluginStorageKey,
	PluginStorageQuotaError,
	rememberedProviderKey,
	savedViewLayoutKey,
	SERVER_SELECTION_KEY,
	THEME_PREFERENCE_KEY,
} from "#/persistence/storage";
import { FakeBrowserStorage, fakeClientStorageLayer } from "#/persistence/storage.test-layer";

const oneOrigin = decodeServerOrigin("https://one.example.com");
const twoOrigin = decodeServerOrigin("https://two.example.com/");

describe("browser persistence", () => {
	layer(
		fakeClientStorageLayer({
			entries: [
				["unrelated", "keep"],
				[THEME_PREFERENCE_KEY, "dark"],
				["ryot:other-setting", "keep-too"],
			],
		}),
	)((test) => {
		test.effect("changes and clears only the server selection", () => {
			return Effect.gen(function* () {
				const service = yield* ClientStorage;
				const storage = yield* FakeBrowserStorage;
				yield* service.setServerSelection(oneOrigin);
				yield* service.setServerSelection(twoOrigin);
				expect(yield* service.getServerSelection).toBe(twoOrigin);
				yield* service.clearServerSelection;

				expect((yield* storage.values).has(SERVER_SELECTION_KEY)).toBe(false);
				expect(Object.fromEntries(yield* storage.values)).toEqual({
					unrelated: "keep",
					[THEME_PREFERENCE_KEY]: "dark",
					"ryot:other-setting": "keep-too",
				});
			});
		});
	});

	layer(fakeClientStorageLayer())((test) => {
		test.effect("persists valid themes and defaults invalid values to system", () => {
			return Effect.gen(function* () {
				const service = yield* ClientStorage;
				const storage = yield* FakeBrowserStorage;
				yield* service.setThemePreference("light");
				expect((yield* storage.values).get(THEME_PREFERENCE_KEY)).toBe("light");
				expect(yield* service.getThemePreference).toBe("light");
				yield* storage.seed(THEME_PREFERENCE_KEY, "sepia");
				expect(yield* service.getThemePreference).toBe("system");
			});
		});
	});

	layer(fakeClientStorageLayer())((test) => {
		test.effect("partitions the last workspace by canonical server and user scope", () => {
			const secondUser = { userId: "user-2", serverUrl: oneOrigin };
			const secondServer = { userId: "user-1", serverUrl: twoOrigin };
			const firstScope = { userId: "user-1", serverUrl: oneOrigin };

			return Effect.gen(function* () {
				const service = yield* ClientStorage;
				const storage = yield* FakeBrowserStorage;
				yield* service.setLastWorkspace(firstScope, PluginId.make("fixture"));
				yield* service.setLastWorkspace(secondUser, PluginId.make("other"));
				yield* service.setLastWorkspace(secondServer, PluginId.make("items"));

				expect(
					(yield* storage.values).get('ryot:workspace:["https://one.example.com","user-1"]'),
				).toBe("fixture");
				expect(yield* service.getLastWorkspace(firstScope)).toBe("fixture");
				expect(yield* service.getLastWorkspace(secondUser)).toBe("other");
				expect(yield* service.getLastWorkspace(secondServer)).toBe("items");
			});
		});
	});

	layer(fakeClientStorageLayer())((test) => {
		test.effect("returns null for a missing last workspace", () => {
			const scope = { userId: "user-1", serverUrl: oneOrigin };

			return Effect.gen(function* () {
				const service = yield* ClientStorage;
				expect(yield* service.getLastWorkspace(scope)).toBeNull();
			});
		});
	});

	layer(fakeClientStorageLayer())((test) => {
		test.effect("partitions saved-view layouts by server, user, and slug", () => {
			const firstScope = { userId: "user-1", serverUrl: oneOrigin };
			const secondUser = { userId: "user-2", serverUrl: oneOrigin };
			const secondServer = { userId: "user-1", serverUrl: twoOrigin };

			return Effect.gen(function* () {
				const service = yield* ClientStorage;
				const storage = yield* FakeBrowserStorage;
				yield* service.setSavedViewLayout(firstScope, "items", "grid");
				yield* service.setSavedViewLayout(firstScope, "records", "list");
				yield* service.setSavedViewLayout(secondUser, "items", "table");
				yield* service.setSavedViewLayout(secondServer, "items", "list");

				expect(savedViewLayoutKey(firstScope, "items")).not.toBe(
					savedViewLayoutKey(firstScope, "records"),
				);
				expect(savedViewLayoutKey(firstScope, "items")).not.toBe(
					savedViewLayoutKey(secondUser, "items"),
				);
				expect(savedViewLayoutKey(firstScope, "items")).not.toBe(
					savedViewLayoutKey(secondServer, "items"),
				);
				expect((yield* storage.values).get(savedViewLayoutKey(firstScope, "items"))).toBe("grid");
				expect(yield* service.getSavedViewLayout(firstScope, "records")).toBe("list");
				expect(yield* service.getSavedViewLayout(secondUser, "items")).toBe("table");
				expect(yield* service.getSavedViewLayout(secondServer, "items")).toBe("list");
			});
		});
	});

	layer(fakeClientStorageLayer())((test) => {
		test.effect("defaults missing and invalid saved-view layouts to grid", () => {
			const scope = { userId: "user-1", serverUrl: oneOrigin };

			return Effect.gen(function* () {
				const service = yield* ClientStorage;
				const storage = yield* FakeBrowserStorage;
				expect(yield* service.getSavedViewLayout(scope, "items")).toBe("grid");
				yield* storage.seed(savedViewLayoutKey(scope, "items"), "masonry");
				expect(yield* service.getSavedViewLayout(scope, "items")).toBe("grid");
			});
		});
	});

	layer(fakeClientStorageLayer())((test) => {
		test.effect("roundtrips every valid saved-view layout", () => {
			const scope = { userId: "user-1", serverUrl: oneOrigin };

			return Effect.gen(function* () {
				const service = yield* ClientStorage;
				const storage = yield* FakeBrowserStorage;
				for (const layout of ["grid", "list", "table"] as const) {
					yield* service.setSavedViewLayout(scope, "items", layout);
					expect((yield* storage.values).get(savedViewLayoutKey(scope, "items"))).toBe(layout);
					expect(yield* service.getSavedViewLayout(scope, "items")).toBe(layout);
				}
			});
		});
	});

	layer(fakeClientStorageLayer())((test) => {
		test.effect("partitions the remembered provider by server, user, and entity schema", () => {
			const firstScope = { userId: "user-1", serverUrl: oneOrigin };
			const secondUser = { userId: "user-2", serverUrl: oneOrigin };
			const secondServer = { userId: "user-1", serverUrl: twoOrigin };

			return Effect.gen(function* () {
				const service = yield* ClientStorage;
				const storage = yield* FakeBrowserStorage;
				yield* service.setRememberedProvider(
					firstScope,
					"item",
					SandboxProviderId.make("provider-1"),
				);
				yield* service.setRememberedProvider(
					firstScope,
					"entry",
					SandboxProviderId.make("provider-2"),
				);
				yield* service.setRememberedProvider(
					secondUser,
					"item",
					SandboxProviderId.make("provider-3"),
				);
				yield* service.setRememberedProvider(
					secondServer,
					"item",
					SandboxProviderId.make("provider-4"),
				);

				expect(rememberedProviderKey(firstScope, "item")).not.toBe(
					rememberedProviderKey(firstScope, "entry"),
				);
				expect(rememberedProviderKey(firstScope, "item")).not.toBe(
					rememberedProviderKey(secondUser, "item"),
				);
				expect(rememberedProviderKey(firstScope, "item")).not.toBe(
					rememberedProviderKey(secondServer, "item"),
				);
				expect((yield* storage.values).get(rememberedProviderKey(firstScope, "item"))).toBe(
					"provider-1",
				);
				expect(yield* service.getRememberedProvider(firstScope, "entry")).toBe("provider-2");
				expect(yield* service.getRememberedProvider(secondUser, "item")).toBe("provider-3");
				expect(yield* service.getRememberedProvider(secondServer, "item")).toBe("provider-4");
			});
		});
	});

	layer(fakeClientStorageLayer())((test) => {
		test.effect("returns null when no provider is remembered for the entity schema", () => {
			const scope = { userId: "user-1", serverUrl: oneOrigin };

			return Effect.gen(function* () {
				const service = yield* ClientStorage;
				expect(yield* service.getRememberedProvider(scope, "item")).toBeNull();
				yield* service.setRememberedProvider(scope, "item", SandboxProviderId.make("provider-1"));
				expect(yield* service.getRememberedProvider(scope, "entry")).toBeNull();
			});
		});
	});

	layer(fakeClientStorageLayer())((test) => {
		test.effect("partitions plugin values by server, user, plugin, and key", () => {
			const firstScope = { userId: "user-1", serverUrl: oneOrigin };
			const secondUser = { userId: "user-2", serverUrl: oneOrigin };
			const secondServer = { userId: "user-1", serverUrl: twoOrigin };
			const fixture = PluginId.make("fixture");
			const other = PluginId.make("other");

			return Effect.gen(function* () {
				const service = yield* ClientStorage;
				const storage = yield* FakeBrowserStorage;
				yield* service.setPluginValue(firstScope, fixture, "order", { order: "aired" });
				yield* service.setPluginValue(firstScope, fixture, "other", 1);
				yield* service.setPluginValue(firstScope, other, "order", 2);
				yield* service.setPluginValue(secondUser, fixture, "order", 3);
				yield* service.setPluginValue(secondServer, fixture, "order", 4);

				expect(
					(yield* storage.values).get(
						'ryot:plugin-storage:["https://one.example.com","user-1","fixture","order"]',
					),
				).toBe('{"order":"aired"}');
				expect(yield* service.getPluginValue(firstScope, fixture, "order")).toEqual({
					order: "aired",
				});
				expect(yield* service.getPluginValue(firstScope, fixture, "other")).toBe(1);
				expect(yield* service.getPluginValue(firstScope, other, "order")).toBe(2);
				expect(yield* service.getPluginValue(secondUser, fixture, "order")).toBe(3);
				expect(yield* service.getPluginValue(secondServer, fixture, "order")).toBe(4);

				yield* service.removePluginValue(firstScope, fixture, "order");
				expect(yield* service.getPluginValue(firstScope, fixture, "order")).toBeNull();
				expect(yield* service.getPluginValue(firstScope, fixture, "other")).toBe(1);
			});
		});
	});

	layer(fakeClientStorageLayer())((test) => {
		test.effect(
			"returns null for missing values and rejects malformed data without deleting it",
			() => {
				const scope = { userId: "user-1", serverUrl: oneOrigin };
				const fixture = PluginId.make("fixture");

				return Effect.gen(function* () {
					const service = yield* ClientStorage;
					const storage = yield* FakeBrowserStorage;
					expect(yield* service.getPluginValue(scope, fixture, "order")).toBeNull();
					yield* storage.seed(pluginStorageKey(scope, fixture, "order"), "{not json");
					const error = yield* Effect.flip(service.getPluginValue(scope, fixture, "order"));
					expect(error).toBeInstanceOf(PluginStorageAccessError);
					expect((yield* storage.values).get(pluginStorageKey(scope, fixture, "order"))).toBe(
						"{not json",
					);
				});
			},
		);
	});

	layer(
		fakeClientStorageLayer({
			getItem: () => {
				throw new Error("blocked read");
			},
			removeItem: () => {
				throw new Error("blocked remove");
			},
		}),
	)((test) => {
		test.effect("reports plugin read and remove access errors", () => {
			const scope = { userId: "user-1", serverUrl: oneOrigin };
			const fixture = PluginId.make("fixture");

			return Effect.gen(function* () {
				const service = yield* ClientStorage;
				const readError = yield* Effect.flip(service.getPluginValue(scope, fixture, "order"));
				const removeError = yield* Effect.flip(service.removePluginValue(scope, fixture, "order"));
				expect(readError).toBeInstanceOf(PluginStorageAccessError);
				expect(removeError).toBeInstanceOf(PluginStorageAccessError);
			});
		});
	});

	layer(clientStorageLayer(undefined))((test) => {
		test.effect("rejects plugin writes when browser storage is unavailable", () =>
			Effect.gen(function* () {
				const service = yield* ClientStorage;
				const error = yield* Effect.flip(
					service.setPluginValue(
						{ userId: "user-1", serverUrl: oneOrigin },
						PluginId.make("fixture"),
						"order",
						1,
					),
				);
				expect(error).toBeInstanceOf(PluginStorageAccessError);
			}),
		);
	});

	layer(
		fakeClientStorageLayer({
			setItem: () => {
				throw new DOMException("full", "QuotaExceededError");
			},
			entries: [
				[
					pluginStorageKey(
						{ userId: "user-1", serverUrl: oneOrigin },
						PluginId.make("fixture"),
						"order",
					),
					'"existing"',
				],
			],
		}),
	)((test) => {
		test.effect("surfaces a rejected plugin value write as a quota failure", () => {
			const scope = { userId: "user-1", serverUrl: oneOrigin };

			return Effect.gen(function* () {
				const service = yield* ClientStorage;
				const error = yield* Effect.flip(
					service.setPluginValue(scope, PluginId.make("fixture"), "order", 1),
				);
				expect(error).toBeInstanceOf(PluginStorageQuotaError);
				expect(yield* service.getPluginValue(scope, PluginId.make("fixture"), "order")).toBe(
					"existing",
				);
			});
		});
	});

	layer(fakeClientStorageLayer({ entries: [[SERVER_SELECTION_KEY, "javascript:alert(1)"]] }))(
		(test) => {
			test.effect("ignores a malformed persisted server selection", () => {
				return Effect.gen(function* () {
					const service = yield* ClientStorage;
					expect(yield* service.getServerSelection).toBeNull();
				});
			});
		},
	);
});
