import { describe, expect, it } from "@effect/vitest";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import type { Config } from "effect";
import { ConfigProvider, Effect, Option, Redacted } from "effect";
import { expectTypeOf } from "vitest";

import {
	booleanField,
	configFromAppSchema,
	defineConfig,
	definePluginConfig,
	enumField,
	group,
	integerField,
	stringField,
} from "./index";

const packageId = PluginPackageId.make("ryot/subject");

const load = <A>(config: Config.Config<A>, values: Record<string, string>) =>
	config.pipe(
		Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(values)),
	);

describe("config definitions", () => {
	it.effect("infers and loads defaults, options, redacted secrets, enums, and nested groups", () =>
		Effect.gen(function* () {
			const definition = defineConfig({
				port: integerField({
					label: "Port",
					envKey: "PORT",
					defaultValue: 8000,
					description: "Server port",
				}),
				server: group(
					{ label: "Server", description: "Server settings" },
					{
						enabled: booleanField({
							label: "Enabled",
							envKey: "ENABLED",
							description: "Enable server",
						}),
						token: stringField({
							secret: true,
							label: "Token",
							envKey: "TOKEN",
							description: "Server token",
							validation: { required: true },
						}),
						mode: enumField({
							label: "Mode",
							envKey: "MODE",
							description: "Server mode",
							choices: { kind: "static", values: [{ value: "safe" }, { value: "fast" }] },
						}),
					},
				),
			});

			const value = yield* load(definition.config, { MODE: "safe", TOKEN: "secret" });
			expectTypeOf(value.port).toEqualTypeOf<number>();
			expectTypeOf(value.server.token).toEqualTypeOf<Redacted.Redacted>();
			expectTypeOf(value.server.mode).toEqualTypeOf<Option.Option<"safe" | "fast">>();
			expect(value.port).toBe(8000);
			expect(Redacted.value(value.server.token)).toBe("secret");
			expect(value.server.mode).toEqual(Option.some("safe"));
			expect(value.server.enabled).toEqual(Option.none());
			expect(definition.schema.fields.server).toMatchObject({
				type: "object",
				properties: { token: { secret: true, type: "string" } },
			});
		}),
	);

	it.effect("derives plugin environment names without field overrides", () =>
		Effect.gen(function* () {
			const definition = definePluginConfig(packageId, {
				apiToken: stringField({
					label: "API token",
					description: "Plugin token",
					validation: { required: true },
				}),
			});
			expect(pluginConfigEnvironmentKey(packageId, "apiToken")).toBe(
				"RYOT_PLUGIN__RYOT__SUBJECT__API_TOKEN",
			);
			expect(
				yield* load(definition.config, { RYOT_PLUGIN__RYOT__SUBJECT__API_TOKEN: "token" }),
			).toEqual({ apiToken: "token" });
		}),
	);

	it.effect("loads a runtime AppSchema with a caller-owned environment resolver", () =>
		Effect.gen(function* () {
			const schema = {
				unknownKeys: "strict",
				fields: {
					retries: {
						type: "integer",
						defaultValue: 2,
						label: "Retries",
						description: "Retry count",
					},
					provider: {
						type: "enum",
						label: "Provider",
						description: "Provider name",
						validation: { required: true },
						choices: { kind: "static", values: [{ value: "local" }, { value: "remote" }] },
					},
				},
			} satisfies AppSchema;
			const config = configFromAppSchema(
				schema,
				(path) => `PLUGIN_${path.join("_").toUpperCase()}`,
			);
			expect(yield* load(config, { PLUGIN_PROVIDER: "remote" })).toEqual({
				retries: 2,
				provider: "remote",
			});
		}),
	);

	it.effect("loads equal local config keys independently for different packages", () =>
		Effect.gen(function* () {
			const otherPackageId = PluginPackageId.make("ryot/fixture");
			const fields = {
				apiToken: stringField({
					label: "Token",
					description: "Provider token",
					validation: { required: true },
				}),
			};
			const values = {
				RYOT_PLUGIN__RYOT__SUBJECT__API_TOKEN: "first",
				RYOT_PLUGIN__RYOT__FIXTURE__API_TOKEN: "second",
			};
			expect(yield* load(definePluginConfig(packageId, fields).config, values)).toEqual({
				apiToken: "first",
			});
			expect(yield* load(definePluginConfig(otherPackageId, fields).config, values)).toEqual({
				apiToken: "second",
			});
		}),
	);

	it.effect("reports the environment key and allowed values for invalid enums", () =>
		Effect.gen(function* () {
			const definition = defineConfig({
				mode: enumField({
					label: "Mode",
					envKey: "MODE",
					description: "Server mode",
					validation: { required: true },
					choices: { kind: "static", values: [{ value: "safe" }, { value: "fast" }] },
				}),
			});

			const error = yield* Effect.flip(load(definition.config, { MODE: "unsafe" }));
			expect(error.message).toContain("MODE must be one of: safe, fast");
		}),
	);
});
