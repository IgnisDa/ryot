import { describe, expect, layer } from "@effect/vitest";
import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { PLUGIN_STORAGE_VALUE_MAX_BYTES } from "@ryot-app/plugin-client-contract";
import { Effect, Layer } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { PluginStorage } from "#/modules/pages/bridge/storage";
import { clientStorageLayer, pluginStorageKey } from "#/persistence/storage";
import { FakeBrowserStorage, fakeClientStorageLayer } from "#/persistence/storage.test-layer";

const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const fixture = PluginId.make("plugin-1");
const other = PluginId.make("plugin-2");

const contributors: PreparedClientPage["identity"]["contributors"] = [
	{
		kind: "plugin",
		pluginId: fixture,
		revisionId: "revision-1",
		contentHash: "source-hash",
		installationId: "installation-1",
		packageId: PluginPackageId.make("test/fixture"),
	},
	{ name: "table", kind: "kernel-renderer", sourceHash: "source-hash" },
];

const pluginStorageOutcome = (...args: Parameters<PluginStorage["Service"]["outcome"]>) =>
	Effect.flatMap(PluginStorage, (storage) => storage.outcome(...args));

const pluginStorageLayer = (...args: Parameters<typeof fakeClientStorageLayer>) =>
	PluginStorage.layer.pipe(Layer.provideMerge(fakeClientStorageLayer(...args)));

const setOrder = (value: string) =>
	pluginStorageOutcome(scope, contributors, {
		value,
		key: "order",
		action: "set",
		pluginId: fixture,
	});

describe("plugin storage outcome", () => {
	layer(pluginStorageLayer())((test) => {
		test.effect("stores, reads, and removes a value for a plugin contributing to the frame", () => {
			return Effect.gen(function* () {
				const storage = yield* FakeBrowserStorage;
				expect(
					yield* pluginStorageOutcome(scope, contributors, {
						key: "order",
						action: "set",
						pluginId: fixture,
						value: { order: "aired" },
					}),
				).toEqual({ value: null, outcome: "success" });
				expect((yield* storage.values).get(pluginStorageKey(scope, fixture, "order"))).toBe(
					'{"order":"aired"}',
				);
				expect(
					yield* pluginStorageOutcome(scope, contributors, {
						key: "order",
						action: "get",
						pluginId: fixture,
					}),
				).toEqual({ outcome: "success", value: { order: "aired" } });
				yield* pluginStorageOutcome(scope, contributors, {
					key: "order",
					action: "remove",
					pluginId: fixture,
				});
				expect((yield* storage.values).size).toBe(0);
			});
		});
		test.effect(
			"isolates equal authored keys by local owner and preserves them across revisions",
			() =>
				Effect.gen(function* () {
					const composed: PreparedClientPage["identity"]["contributors"] = [
						...contributors,
						{
							kind: "plugin",
							pluginId: other,
							revisionId: "revision-1",
							contentHash: "same-source-name",
							installationId: "installation-2",
							packageId: PluginPackageId.make("ryot/other"),
						},
					];
					yield* pluginStorageOutcome(scope, composed, {
						key: "same",
						action: "set",
						value: "left",
						pluginId: fixture,
					});
					yield* pluginStorageOutcome(scope, composed, {
						key: "same",
						action: "set",
						value: "right",
						pluginId: other,
					});
					const upgraded = Array.from(composed, (contributor) =>
						contributor.kind === "plugin"
							? { ...contributor, revisionId: "revision-2", contentHash: "new-source" }
							: contributor,
					);
					expect(
						yield* pluginStorageOutcome(scope, upgraded, {
							key: "same",
							action: "get",
							pluginId: fixture,
						}),
					).toEqual({ value: "left", outcome: "success" });
					expect(
						yield* pluginStorageOutcome(scope, upgraded, {
							key: "same",
							action: "get",
							pluginId: other,
						}),
					).toEqual({ value: "right", outcome: "success" });
				}),
		);
	});

	layer(pluginStorageLayer())((test) => {
		test.effect("rejects a local owner absent from the frame's contributors", () => {
			return Effect.gen(function* () {
				const storage = yield* FakeBrowserStorage;
				expect(
					yield* pluginStorageOutcome(scope, contributors, {
						value: 1,
						key: "order",
						action: "set",
						pluginId: other,
					}),
				).toEqual({ outcome: "failure", reason: "invalid-request" });
				expect((yield* storage.values).size).toBe(0);
			});
		});
	});

	layer(pluginStorageLayer())((test) => {
		test.effect("rejects a value whose serialized JSON exceeds the byte limit", () => {
			return Effect.gen(function* () {
				const storage = yield* FakeBrowserStorage;
				expect(PLUGIN_STORAGE_VALUE_MAX_BYTES).toBe(65536);
				// Two quote bytes plus two bytes per "é".
				expect(yield* setOrder("é".repeat((PLUGIN_STORAGE_VALUE_MAX_BYTES - 2) / 2))).toEqual({
					value: null,
					outcome: "success",
				});
				expect(yield* setOrder("é".repeat((PLUGIN_STORAGE_VALUE_MAX_BYTES - 2) / 2 + 1))).toEqual({
					outcome: "failure",
					reason: "invalid-request",
				});
				expect((yield* storage.values).size).toBe(1);
			});
		});
	});

	layer(
		pluginStorageLayer({
			entries: [[pluginStorageKey(scope, fixture, "order"), '"existing"']],
			setItem: () => {
				throw new DOMException("full", "QuotaExceededError");
			},
		}),
	)((test) => {
		test.effect("reports a rejected browser write as quota", () => {
			return Effect.gen(function* () {
				const storage = yield* FakeBrowserStorage;
				expect(
					yield* pluginStorageOutcome(scope, contributors, {
						value: 1,
						key: "order",
						action: "set",
						pluginId: fixture,
					}),
				).toEqual({ reason: "quota", outcome: "failure" });
				expect((yield* storage.values).get(pluginStorageKey(scope, fixture, "order"))).toBe(
					'"existing"',
				);
			});
		});
	});

	layer(
		pluginStorageLayer({
			getItem: () => {
				throw new Error("blocked read");
			},
			removeItem: () => {
				throw new Error("blocked remove");
			},
		}),
	)((test) => {
		test.effect("reports failed reads and removes as transport errors", () =>
			Effect.gen(function* () {
				for (const action of ["get", "remove"] as const) {
					expect(
						yield* pluginStorageOutcome(scope, contributors, {
							action,
							key: "order",
							pluginId: fixture,
						}),
					).toEqual({ outcome: "failure", reason: "transport" });
				}
			}),
		);
	});

	layer(
		pluginStorageLayer({
			setItem: () => {
				throw new Error("storage access denied");
			},
		}),
	)((test) => {
		test.effect("reports non-quota write failures as transport errors", () =>
			Effect.gen(function* () {
				expect(
					yield* pluginStorageOutcome(scope, contributors, {
						value: 1,
						key: "order",
						action: "set",
						pluginId: fixture,
					}),
				).toEqual({ outcome: "failure", reason: "transport" });
			}),
		);
	});

	layer(
		pluginStorageLayer({ entries: [[pluginStorageKey(scope, fixture, "order"), "{not json"]] }),
	)((test) => {
		test.effect("reports malformed stored values as transport without deleting them", () =>
			Effect.gen(function* () {
				const storage = yield* FakeBrowserStorage;
				expect(
					yield* pluginStorageOutcome(scope, contributors, {
						key: "order",
						action: "get",
						pluginId: fixture,
					}),
				).toEqual({ outcome: "failure", reason: "transport" });
				expect((yield* storage.values).get(pluginStorageKey(scope, fixture, "order"))).toBe(
					"{not json",
				);
			}),
		);
	});

	layer(PluginStorage.layer.pipe(Layer.provideMerge(clientStorageLayer(undefined))))((test) => {
		test.effect("reports unavailable browser storage instead of successful persistence", () =>
			Effect.gen(function* () {
				expect(
					yield* pluginStorageOutcome(scope, contributors, {
						value: 1,
						key: "order",
						action: "set",
						pluginId: fixture,
					}),
				).toEqual({ outcome: "failure", reason: "transport" });
			}),
		);
	});
});
