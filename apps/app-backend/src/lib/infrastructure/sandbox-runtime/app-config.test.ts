import { pluginConfigEnvironmentKey } from "@ryot/config";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { ConfigProvider, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { getPluginConfigValue, getSystemConfigValue } from "./app-config";

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
	key: string,
	values: Readonly<Record<string, string>>,
	requiredPluginConfigKeys: ReadonlyArray<string> = [key],
) => {
	const configProvider = ConfigProvider.fromMap(
		new Map(
			Object.entries(values).map(([configKey, value]) => [
				pluginConfigEnvironmentKey(pluginSlug, configKey),
				value,
			]),
		),
	);
	return Effect.runSync(
		getPluginConfigValue({
			key,
			pluginSlug,
			configSchema: pluginConfigSchema,
			metadata: { requiredPluginConfigKeys },
		}).pipe(Effect.either, Effect.provide(Layer.setConfigProvider(configProvider))),
	);
};

const runSystemConfig = (key: string, requiredSystemConfigKeys: ReadonlyArray<string> = [key]) =>
	Effect.runSync(getSystemConfigValue(key, { requiredSystemConfigKeys }).pipe(Effect.either));

describe("getPluginConfigValue", () => {
	it("derives stable environment keys from the plugin slug and config key", () => {
		expect(pluginConfigEnvironmentKey("media-tools", "apiToken")).toBe(
			"RYOT_PLUGIN_MEDIA_TOOLS_API_TOKEN",
		);
	});

	it("reads and parses declared plugin config from the config provider", () => {
		expect(
			runPluginConfig("requestLimit", { apiToken: "secret", requestLimit: "12" }),
		).toMatchObject({ _tag: "Right", right: 12 });
		expect(runPluginConfig("enabled", { apiToken: "secret", enabled: "true" })).toMatchObject({
			_tag: "Right",
			right: true,
		});
	});

	it("rejects undeclared, unknown, and unconfigured plugin config", () => {
		expect(runPluginConfig("apiToken", { apiToken: "secret" }, [])).toMatchObject({
			_tag: "Left",
			left: expect.stringContaining("is not declared"),
		});
		expect(runPluginConfig("missing", { apiToken: "secret" })).toMatchObject({
			_tag: "Left",
			left: expect.stringContaining("does not exist"),
		});
		expect(runPluginConfig("enabled", { apiToken: "secret" })).toMatchObject({
			_tag: "Left",
			left: expect.stringContaining("is not configured"),
		});
	});
});

describe("getSystemConfigValue", () => {
	it("returns an allowlisted, declared system config value", () => {
		expect(runSystemConfig("timezone")).toMatchObject({ _tag: "Right", right: "Etc/GMT" });
	});

	it("rejects undeclared and non-plugin-readable system config", () => {
		expect(runSystemConfig("timezone", [])).toMatchObject({
			_tag: "Left",
			left: expect.stringContaining("is not declared"),
		});
		expect(runSystemConfig("port")).toMatchObject({
			_tag: "Left",
			left: expect.stringContaining("is not available to plugins"),
		});
	});
});
