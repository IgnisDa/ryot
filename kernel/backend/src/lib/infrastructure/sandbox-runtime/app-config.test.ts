import { pluginConfigEnvironmentKey } from "@ryot/contract/modules/plugins/plugin-config";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect } from "effect";
import { assert, describe, expect, it } from "vitest";

import { makeConfigProviderLayer } from "#lib/test-utils/effect";

import { getPluginConfig, getSystemConfig } from "./app-config";

const pluginSlug = "test-plugin";
const pluginConfigSchema = {
	unknownKeys: "strict",
	fields: {
		enabled: {
			type: "boolean",
			label: "Enabled",
			description: "Whether the plugin is enabled",
		},
		apiToken: {
			type: "string",
			label: "API token",
			description: "Token used by the plugin",
			validation: { required: true },
		},
		requestLimit: {
			type: "integer",
			label: "Request limit",
			description: "Maximum requests",
		},
	},
} satisfies AppSchema;

const runPluginConfig = (
	keys: ReadonlyArray<string>,
	values: Readonly<Record<string, string>>,
	requiredPluginConfigKeys: ReadonlyArray<string> = keys,
) => {
	const configValues = Object.fromEntries(
		Object.entries(values).map(([configKey, value]) => [
			pluginConfigEnvironmentKey(pluginSlug, configKey),
			value,
		]),
	);
	return Effect.runSync(
		getPluginConfig({
			keys,
			metadata: { requiredPluginConfigKeys },
			context: { kind: "environment", pluginSlug, configSchema: pluginConfigSchema },
		}).pipe(Effect.result, Effect.provide(makeConfigProviderLayer(configValues))),
	);
};

const runInstallationConfig = (
	keys: ReadonlyArray<string>,
	config: Readonly<Record<string, unknown>>,
	requiredPluginConfigKeys: ReadonlyArray<string> = keys,
) =>
	Effect.runSync(
		getPluginConfig({
			keys,
			metadata: { requiredPluginConfigKeys },
			context: { kind: "installation", config, configSchema: pluginConfigSchema },
		}).pipe(Effect.result, Effect.provide(makeConfigProviderLayer())),
	);

const runSystemConfig = (
	keys: ReadonlyArray<string>,
	requiredSystemConfigKeys: ReadonlyArray<string> = keys,
) =>
	Effect.runSync(
		getSystemConfig(keys, { requiredSystemConfigKeys }).pipe(
			Effect.result,
			Effect.provide(makeConfigProviderLayer()),
		),
	);

describe("getPluginConfig", () => {
	it("derives stable environment keys from the plugin slug and config key", () => {
		expect(pluginConfigEnvironmentKey("example-tools", "apiToken")).toBe(
			"RYOT_PLUGIN_EXAMPLE_TOOLS_API_TOKEN",
		);
	});

	it("reads and parses declared plugin config from the config provider", () => {
		expect(
			runPluginConfig(["requestLimit", "enabled", "requestLimit"], {
				apiToken: "secret",
				requestLimit: "12",
				enabled: "true",
			}),
		).toMatchObject({ _tag: "Success", success: { requestLimit: 12, enabled: true } });
	});

	it("returns an empty record without loading config", () => {
		expect(runPluginConfig([], {})).toMatchObject({
			_tag: "Success",
			success: {},
		});
	});

	it("rejects undeclared, unknown, and unconfigured plugin config", () => {
		expect(
			runPluginConfig(["apiToken", "requestLimit"], { apiToken: "secret" }, ["apiToken"]),
		).toMatchObject({
			_tag: "Failure",
			failure: expect.stringContaining("is not declared"),
		});
		expect(runPluginConfig(["missing"], { apiToken: "secret" })).toMatchObject({
			_tag: "Failure",
			failure: expect.stringContaining("does not exist"),
		});
		expect(runPluginConfig(["enabled"], { apiToken: "secret" })).toMatchObject({
			_tag: "Failure",
			failure: expect.stringContaining("is not configured"),
		});
	});
});

describe("getPluginConfig for an installation", () => {
	it("reads declared plugin config from the stored installation values", () => {
		expect(
			runInstallationConfig(["requestLimit", "enabled"], {
				enabled: true,
				requestLimit: 12,
				apiToken: "secret",
			}),
		).toMatchObject({ _tag: "Success", success: { requestLimit: 12, enabled: true } });
	});

	it("rejects undeclared and unknown installation config keys", () => {
		expect(
			runInstallationConfig(["apiToken", "requestLimit"], { apiToken: "secret" }, ["apiToken"]),
		).toMatchObject({ _tag: "Failure", failure: expect.stringContaining("is not declared") });
		expect(runInstallationConfig(["missing"], { apiToken: "secret" })).toMatchObject({
			_tag: "Failure",
			failure: expect.stringContaining("does not exist"),
		});
	});

	it("reports unconfigured installation keys without naming environment variables", () => {
		const result = runInstallationConfig(["enabled"], { apiToken: "secret" });
		expect(result).toMatchObject({
			_tag: "Failure",
			failure: expect.stringContaining("is not configured for this installation"),
		});
		assert(result._tag === "Failure");
		expect(result.failure).not.toContain("RYOT_PLUGIN");
	});
});

describe("getSystemConfig", () => {
	it("returns an allowlisted, declared system config value", () => {
		expect(runSystemConfig(["timezone", "timezone"])).toMatchObject({
			_tag: "Success",
			success: { timezone: "Etc/GMT" },
		});
	});

	it("returns an empty record without loading system config", () => {
		expect(runSystemConfig([])).toMatchObject({ _tag: "Success", success: {} });
	});

	it("rejects undeclared and non-plugin-readable system config", () => {
		expect(runSystemConfig(["timezone"], [])).toMatchObject({
			_tag: "Failure",
			failure: expect.stringContaining("is not declared"),
		});
		expect(runSystemConfig(["port"])).toMatchObject({
			_tag: "Failure",
			failure: expect.stringContaining("is not available to plugins"),
		});
	});
});
