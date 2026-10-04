import { describe, expect, layer } from "@effect/vitest";
import type { PreparedClientPage } from "@ryot-app/contract/modules/client-pages/schemas";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { PLUGIN_STORAGE_VALUE_MAX_BYTES } from "@ryot-app/plugin-client-contract";
import { Effect, Layer } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { PluginStorage } from "#/modules/pages/bridge/storage";
import { pluginStorageKey } from "#/persistence/storage";
import { FakeBrowserStorage, fakeClientStorageLayer } from "#/persistence/storage.test-layer";

const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const media = PluginId.make("plugin-1");
const fitness = PluginId.make("plugin-2");

const contributors: PreparedClientPage["identity"]["contributors"] = [
	{
		kind: "plugin",
		pluginId: media,
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
		pluginId: media,
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
						pluginId: media,
						value: { order: "aired" },
					}),
				).toEqual({ value: null, outcome: "success" });
				expect((yield* storage.values).get(pluginStorageKey(scope, media, "order"))).toBe(
					'{"order":"aired"}',
				);
				expect(
					yield* pluginStorageOutcome(scope, contributors, {
						key: "order",
						action: "get",
						pluginId: media,
					}),
				).toEqual({ outcome: "success", value: { order: "aired" } });
				yield* pluginStorageOutcome(scope, contributors, {
					key: "order",
					pluginId: media,
					action: "remove",
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
							pluginId: fitness,
							revisionId: "revision-1",
							contentHash: "same-source-name",
							installationId: "installation-2",
							packageId: PluginPackageId.make("ryot/fitness"),
						},
					];
					yield* pluginStorageOutcome(scope, composed, {
						key: "same",
						action: "set",
						value: "left",
						pluginId: media,
					});
					yield* pluginStorageOutcome(scope, composed, {
						key: "same",
						action: "set",
						value: "right",
						pluginId: fitness,
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
							pluginId: media,
						}),
					).toEqual({ value: "left", outcome: "success" });
					expect(
						yield* pluginStorageOutcome(scope, upgraded, {
							key: "same",
							action: "get",
							pluginId: fitness,
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
						pluginId: fitness,
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
			setItem: () => {
				throw new DOMException("full", "QuotaExceededError");
			},
		}),
	)((test) => {
		test.effect("reports a rejected browser write as quota", () => {
			return Effect.gen(function* () {
				expect(
					yield* pluginStorageOutcome(scope, contributors, {
						value: 1,
						key: "order",
						action: "set",
						pluginId: media,
					}),
				).toEqual({ reason: "quota", outcome: "failure" });
			});
		});
	});
});
