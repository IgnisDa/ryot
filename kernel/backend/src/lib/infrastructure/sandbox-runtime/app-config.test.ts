import { assert, describe, expect, it, layer } from "@effect/vitest";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Effect } from "effect";

import { makeConfigProviderLayer } from "#lib/test-utils/effect";

import { getPluginConfig } from "./app-config";

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
		access: { required: keys },
		metadata: { requiredPluginConfigKeys },
		context: { pluginSlug, kind: "environment", configSchema: pluginConfigSchema },
	}).pipe(Effect.result);

const runInstallationConfig = (
	keys: ReadonlyArray<string>,
	config: Readonly<Record<string, unknown>>,
	requiredPluginConfigKeys: ReadonlyArray<string> = keys,
) =>
	getPluginConfig({
		access: { required: keys },
		metadata: { requiredPluginConfigKeys },
		context: { config, kind: "installation", configSchema: pluginConfigSchema },
	}).pipe(Effect.result);

describe("getPluginConfig", () => {
	it.effect("omits unavailable optional reads and retains false and zero", () =>
		Effect.gen(function* () {
			const values = yield* getPluginConfig({
				access: { optional: ["requestLimit", "enabled"] },
				metadata: {
					requiredPluginConfigKeys: [],
					optionalPluginConfigKeys: ["requestLimit", "enabled"],
				},
				context: {
					kind: "installation",
					config: { enabled: false },
					configSchema: pluginConfigSchema,
				},
			});
			expect(values).toEqual({ enabled: false });
			expect(
				yield* getPluginConfig({
					access: { required: ["requestLimit", "enabled"] },
					metadata: {
						optionalPluginConfigKeys: [],
						requiredPluginConfigKeys: ["requestLimit", "enabled"],
					},
					context: {
						kind: "installation",
						configSchema: pluginConfigSchema,
						config: { enabled: false, requestLimit: 0 },
					},
				}),
			).toEqual({ enabled: false, requestLimit: 0 });
		}),
	);
	it.effect("permits optional reads of required schema fields and validates selected values", () =>
		Effect.gen(function* () {
			const context = {
				config: {},
				kind: "installation" as const,
				configSchema: pluginConfigSchema,
			};
			const metadata = { requiredPluginConfigKeys: [], optionalPluginConfigKeys: ["apiToken"] };
			expect(
				yield* getPluginConfig({ context, metadata, access: { optional: ["apiToken"] } }),
			).toEqual({});
			expect(
				yield* getPluginConfig({
					metadata,
					access: { optional: ["apiToken"] },
					context: { ...context, config: { apiToken: 42 } },
				}).pipe(Effect.result),
			).toMatchObject({ _tag: "Failure" });
		}),
	);
	layer(pluginEnvironmentLayer({ enabled: "false", requestLimit: "0" }))((test) => {
		test.effect("loads selected environment keys without unrelated required fields", () =>
			Effect.gen(function* () {
				expect(yield* runPluginConfig(["enabled", "requestLimit"])).toMatchObject({
					_tag: "Success",
					success: { enabled: false, requestLimit: 0 },
				});
				expect(
					yield* getPluginConfig({
						access: { optional: ["apiToken"] },
						context: { pluginSlug, kind: "environment", configSchema: pluginConfigSchema },
						metadata: { requiredPluginConfigKeys: [], optionalPluginConfigKeys: ["apiToken"] },
					}),
				).toEqual({});
			}),
		);
	});
	it.effect("denies optional access outside generated keys and required promotion", () =>
		Effect.gen(function* () {
			const context = {
				kind: "installation" as const,
				config: { apiToken: "secret" },
				configSchema: pluginConfigSchema,
			};
			expect(
				yield* getPluginConfig({
					context,
					access: { optional: ["enabled"] },
					metadata: { requiredPluginConfigKeys: [], optionalPluginConfigKeys: [] },
				}).pipe(Effect.flip),
			).toBe('Plugin config key "enabled" is not declared by this script');
			expect(
				yield* getPluginConfig({
					context,
					access: { required: ["enabled"] },
					metadata: { requiredPluginConfigKeys: [], optionalPluginConfigKeys: ["enabled"] },
				}).pipe(Effect.flip),
			).toBe('Plugin config key "enabled" is not a required read by this script');
		}),
	);
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
					failure: {
						message: expect.stringContaining("is not configured"),
						data: { keys: ["enabled"], code: "missing-required-config" },
					},
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
					failure: {
						data: { keys: ["enabled"], code: "missing-required-config" },
						message: expect.stringContaining("is not configured for this installation"),
					},
				});
				assert(result._tag === "Failure");
				assert(typeof result.failure !== "string");
				expect(result.failure.message).not.toContain("RYOT_PLUGIN");
			}),
		);
	});
});
