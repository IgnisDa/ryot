import { describe, expect, layer } from "@effect/vitest";
import { PLUGIN_STORAGE_VALUE_MAX_BYTES } from "@ryot-app/client-plugin-contract";
import type { PreparedClientPage } from "@ryot-app/contract/modules/client-pages/schemas";
import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { PluginStorage } from "#/modules/plugins/storage";
import { pluginStorageKey } from "#/persistence/storage";
import { FakeBrowserStorage, fakeClientStorageLayer } from "#/persistence/storage.test-layer";

const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const media = PluginSlug.make("media");
const fitness = PluginSlug.make("fitness");

const contributors: PreparedClientPage["identity"]["contributors"] = [
	{
		kind: "plugin",
		pluginSlug: media,
		pluginId: "plugin-1",
		sourceHash: "source-hash",
		installationId: "installation-1",
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
		pluginSlug: media,
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
						pluginSlug: media,
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
						pluginSlug: media,
					}),
				).toEqual({ outcome: "success", value: { order: "aired" } });
				yield* pluginStorageOutcome(scope, contributors, {
					key: "order",
					action: "remove",
					pluginSlug: media,
				});
				expect((yield* storage.values).size).toBe(0);
			});
		});
	});

	layer(pluginStorageLayer())((test) => {
		test.effect("rejects a slug that is not a plugin contributor of the frame", () => {
			return Effect.gen(function* () {
				const storage = yield* FakeBrowserStorage;
				expect(
					yield* pluginStorageOutcome(scope, contributors, {
						value: 1,
						key: "order",
						action: "set",
						pluginSlug: fitness,
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
						pluginSlug: media,
					}),
				).toEqual({ reason: "quota", outcome: "failure" });
			});
		});
	});
});
