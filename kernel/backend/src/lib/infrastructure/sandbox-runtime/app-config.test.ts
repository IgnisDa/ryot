import { assert, describe, expect, it, layer } from "@effect/vitest";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Effect } from "effect";

import { makeConfigProviderLayer } from "#lib/test-utils/effect";

import { getPluginConfig, getSystemConfig } from "./app-config";

const pluginSlug = "test-plugin";
const pluginConfigSchema = {
	unknownKeys: "strict",
	fields: {
		requestLimit: { type: "integer", label: "Request limit", description: "Maximum requests" },
		enabled: { type: "boolean", label: "Enabled", description: "Whether the plugin is enabled" },
		apiToken: {
			type: "string",
			label: "API token",
			validation: { required: true },
			description: "Token used by the plugin",
		},
	},
} satisfies AppSchema;

const pluginEnvironmentLayer = (values: Readonly<Record<string, string>>) =>
	makeConfigProviderLayer(
		Object.fromEntries(
			Object.entries(values).map(([configKey, value]) => [
				pluginConfigEnvironmentKey(pluginSlug, configKey),
				value,
			]),
		),
	);

const runPluginConfig = (
	keys: ReadonlyArray<string>,
	requiredPluginConfigKeys: ReadonlyArray<string> = keys,
) =>
	getPluginConfig({
		keys,
		metadata: { requiredPluginConfigKeys },
		context: { pluginSlug, kind: "environment", configSchema: pluginConfigSchema },
	}).pipe(Effect.result);

const runInstallationConfig = (
	keys: ReadonlyArray<string>,
	config: Readonly<Record<string, unknown>>,
	requiredPluginConfigKeys: ReadonlyArray<string> = keys,
) =>
	getPluginConfig({
		keys,
		metadata: { requiredPluginConfigKeys },
		context: { config, kind: "installation", configSchema: pluginConfigSchema },
	}).pipe(Effect.result);

const runSystemConfig = (
	keys: ReadonlyArray<string>,
	requiredSystemConfigKeys: ReadonlyArray<string> = keys,
) => getSystemConfig(keys, { requiredSystemConfigKeys }).pipe(Effect.result);

describe("getPluginConfig", () => {
	it("derives stable environment keys from the plugin slug and config key", () => {
		expect(pluginConfigEnvironmentKey("example-tools", "apiToken")).toBe(
			"RYOT_PLUGIN_EXAMPLE_TOOLS_API_TOKEN",
		);
	});

	layer(pluginEnvironmentLayer({ enabled: "true", apiToken: "secret", requestLimit: "12" }))(
		(test) => {
			test.effect("reads and parses declared plugin config from the config provider", () =>
				Effect.gen(function* () {
					expect(yield* runPluginConfig(["requestLimit", "enabled", "requestLimit"])).toMatchObject(
						{ _tag: "Success", success: { enabled: true, requestLimit: 12 } },
					);
				}),
			);
		},
	);

	layer(pluginEnvironmentLayer({}))((test) => {
		test.effect("returns an empty record without loading config", () =>
			Effect.gen(function* () {
				expect(yield* runPluginConfig([])).toMatchObject({ success: {}, _tag: "Success" });
			}),
		);
	});

	layer(pluginEnvironmentLayer({ apiToken: "secret" }))((test) => {
		test.effect("rejects undeclared, unknown, and unconfigured plugin config", () =>
			Effect.gen(function* () {
				expect(yield* runPluginConfig(["apiToken", "requestLimit"], ["apiToken"])).toMatchObject({
					_tag: "Failure",
					failure: expect.stringContaining("is not declared"),
				});
				expect(yield* runPluginConfig(["missing"])).toMatchObject({
					_tag: "Failure",
					failure: expect.stringContaining("does not exist"),
				});
				expect(yield* runPluginConfig(["enabled"])).toMatchObject({
					_tag: "Failure",
					failure: expect.stringContaining("is not configured"),
				});
			}),
		);
	});
});

describe("getPluginConfig for an installation", () => {
	layer(makeConfigProviderLayer())((test) => {
		test.effect("reads declared plugin config from the stored installation values", () =>
			Effect.gen(function* () {
				expect(
					yield* runInstallationConfig(["requestLimit", "enabled"], {
						enabled: true,
						requestLimit: 12,
						apiToken: "secret",
					}),
				).toMatchObject({ _tag: "Success", success: { enabled: true, requestLimit: 12 } });
			}),
		);

		test.effect("rejects undeclared and unknown installation config keys", () =>
			Effect.gen(function* () {
				expect(
					yield* runInstallationConfig(["apiToken", "requestLimit"], { apiToken: "secret" }, [
						"apiToken",
					]),
				).toMatchObject({ _tag: "Failure", failure: expect.stringContaining("is not declared") });
				expect(yield* runInstallationConfig(["missing"], { apiToken: "secret" })).toMatchObject({
					_tag: "Failure",
					failure: expect.stringContaining("does not exist"),
				});
			}),
		);

		test.effect("reports unconfigured installation keys without naming environment variables", () =>
			Effect.gen(function* () {
				const result = yield* runInstallationConfig(["enabled"], { apiToken: "secret" });
				expect(result).toMatchObject({
					_tag: "Failure",
					failure: expect.stringContaining("is not configured for this installation"),
				});
				assert(result._tag === "Failure");
				expect(result.failure).not.toContain("RYOT_PLUGIN");
			}),
		);
	});
});

describe("getSystemConfig", () => {
	layer(makeConfigProviderLayer())((test) => {
		test.effect("returns an allowlisted, declared system config value", () =>
			Effect.gen(function* () {
				expect(yield* runSystemConfig(["timezone", "timezone"])).toMatchObject({
					_tag: "Success",
					success: { timezone: "Etc/GMT" },
				});
			}),
		);

		test.effect("returns an empty record without loading system config", () =>
			Effect.gen(function* () {
				expect(yield* runSystemConfig([])).toMatchObject({ success: {}, _tag: "Success" });
			}),
		);

		test.effect("rejects undeclared and non-plugin-readable system config", () =>
			Effect.gen(function* () {
				expect(yield* runSystemConfig(["timezone"], [])).toMatchObject({
					_tag: "Failure",
					failure: expect.stringContaining("is not declared"),
				});
				expect(yield* runSystemConfig(["port"])).toMatchObject({
					_tag: "Failure",
					failure: expect.stringContaining("is not available to plugins"),
				});
			}),
		);
	});
});
