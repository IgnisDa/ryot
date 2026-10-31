import { describe, expect, it } from "@effect/vitest";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Effect } from "effect";

import { getPluginConfig } from "./access";

const pluginConfigSchema = {
	unknownKeys: "strict",
	fields: {
		region: { type: "string", label: "Region", description: "Region", defaultValue: "local" },
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

describe("getPluginConfig", () => {
	it.effect("omits unavailable optional reads and retains false and zero", () =>
		Effect.gen(function* () {
			expect(
				yield* getPluginConfig({
					access: { optional: ["requestLimit", "enabled"] },
					metadata: { optionalPluginConfigKeys: ["requestLimit", "enabled"] },
					context: { config: { enabled: false }, configSchema: pluginConfigSchema },
				}),
			).toEqual({ enabled: false });
			expect(
				yield* getPluginConfig({
					access: { required: ["requestLimit", "enabled", "requestLimit"] },
					metadata: { requiredPluginConfigKeys: ["requestLimit", "enabled"] },
					context: {
						configSchema: pluginConfigSchema,
						config: { apiToken: 42, enabled: false, requestLimit: 0 },
					},
				}),
			).toEqual({ enabled: false, requestLimit: 0 });
		}),
	);
	it.effect("permits optional reads of required schema fields and validates selected values", () =>
		Effect.gen(function* () {
			const context = { config: {}, configSchema: pluginConfigSchema };
			const metadata = { optionalPluginConfigKeys: ["apiToken"] };
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
	it.effect("applies defaults only to declared selected keys", () =>
		Effect.gen(function* () {
			expect(
				yield* getPluginConfig({
					access: { required: ["region"] },
					metadata: { requiredPluginConfigKeys: ["region"] },
					context: { config: {}, configSchema: pluginConfigSchema },
				}),
			).toEqual({ region: "local" });
		}),
	);
	it.effect("denies undeclared, unknown, and promoted required reads", () =>
		Effect.gen(function* () {
			const context = { config: { apiToken: "secret" }, configSchema: pluginConfigSchema };
			expect(
				yield* getPluginConfig({ context, metadata: {}, access: { optional: ["enabled"] } }).pipe(
					Effect.flip,
				),
			).toBe('Plugin config key "enabled" is not declared by this script');
			expect(
				yield* getPluginConfig({
					context,
					access: { required: ["enabled"] },
					metadata: { optionalPluginConfigKeys: ["enabled"] },
				}).pipe(Effect.flip),
			).toBe('Plugin config key "enabled" is not a required read by this script');
			expect(
				yield* getPluginConfig({
					context,
					access: { required: ["missing"] },
					metadata: { requiredPluginConfigKeys: ["missing"] },
				}).pipe(Effect.flip),
			).toBe('Plugin config key "missing" does not exist');
		}),
	);
	it.effect("returns an empty record without validating unrelated config", () =>
		Effect.gen(function* () {
			expect(
				yield* getPluginConfig({
					access: {},
					metadata: {},
					context: { config: { enabled: "invalid" }, configSchema: pluginConfigSchema },
				}),
			).toEqual({});
		}),
	);
	it.effect("reports missing required values for the pinned execution", () =>
		Effect.gen(function* () {
			expect(
				yield* getPluginConfig({
					access: { required: ["apiToken"] },
					metadata: { requiredPluginConfigKeys: ["apiToken"] },
					context: { config: {}, configSchema: pluginConfigSchema },
				}).pipe(Effect.flip),
			).toEqual({
				data: { keys: ["apiToken"], code: "missing-required-config" },
				message: 'Plugin config key "apiToken" is not configured for this execution',
			});
		}),
	);
});
