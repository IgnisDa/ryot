import { describe, expect, it } from "@effect/vitest";
import { PLUGIN_STORAGE_VALUE_MAX_BYTES } from "@ryot-app/client-plugin-contract";
import type { PreparedClientPage } from "@ryot-app/contract/modules/client-pages/schemas";
import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { pluginStorageOutcome } from "#/modules/plugins/storage";
import { clientStorageLayer, pluginStorageKey, type BrowserStorage } from "#/persistence/storage";

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

const setOrder = (value: string) =>
	pluginStorageOutcome(scope, contributors, {
		value,
		key: "order",
		action: "set",
		pluginSlug: media,
	});

const makeStorage = (setItem?: BrowserStorage["setItem"]) => {
	const values = new Map<string, string>();
	const storage: BrowserStorage = {
		removeItem: (key) => values.delete(key),
		getItem: (key) => values.get(key) ?? null,
		setItem: setItem ?? ((key, value) => values.set(key, value)),
	};
	return { values, layer: clientStorageLayer(storage) };
};

describe("plugin storage outcome", () => {
	it.effect("stores, reads, and removes a value for a plugin contributing to the frame", () => {
		const { layer, values } = makeStorage();
		return Effect.gen(function* () {
			expect(
				yield* pluginStorageOutcome(scope, contributors, {
					key: "order",
					action: "set",
					pluginSlug: media,
					value: { order: "aired" },
				}),
			).toEqual({ value: null, outcome: "success" });
			expect(values.get(pluginStorageKey(scope, media, "order"))).toBe('{"order":"aired"}');
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
			expect(values.size).toBe(0);
		}).pipe(Effect.provide(layer));
	});

	it.effect("rejects a slug that is not a plugin contributor of the frame", () => {
		const { layer, values } = makeStorage();
		return Effect.gen(function* () {
			expect(
				yield* pluginStorageOutcome(scope, contributors, {
					value: 1,
					key: "order",
					action: "set",
					pluginSlug: fitness,
				}),
			).toEqual({ outcome: "failure", reason: "invalid-request" });
			expect(values.size).toBe(0);
		}).pipe(Effect.provide(layer));
	});

	it.effect("rejects a value whose serialized JSON exceeds the byte limit", () => {
		const { layer, values } = makeStorage();
		return Effect.gen(function* () {
			// Two quote bytes plus two bytes per "é".
			expect(yield* setOrder("é".repeat((PLUGIN_STORAGE_VALUE_MAX_BYTES - 2) / 2))).toEqual({
				value: null,
				outcome: "success",
			});
			expect(yield* setOrder("é".repeat((PLUGIN_STORAGE_VALUE_MAX_BYTES - 2) / 2 + 1))).toEqual({
				outcome: "failure",
				reason: "invalid-request",
			});
			expect(values.size).toBe(1);
		}).pipe(Effect.provide(layer));
	});

	it.effect("reports a rejected browser write as quota", () => {
		const { layer } = makeStorage(() => {
			throw new DOMException("full", "QuotaExceededError");
		});
		return Effect.gen(function* () {
			expect(
				yield* pluginStorageOutcome(scope, contributors, {
					value: 1,
					key: "order",
					action: "set",
					pluginSlug: media,
				}),
			).toEqual({ reason: "quota", outcome: "failure" });
		}).pipe(Effect.provide(layer));
	});
});
