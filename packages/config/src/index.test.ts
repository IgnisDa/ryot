import type { AppSchema } from "@ryot/contract/schema/property-schema";
import type { Config } from "effect";
import { ConfigProvider, Effect, Option, Redacted } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
	booleanField,
	configFromAppSchema,
	defineConfig,
	definePluginConfig,
	enumField,
	group,
	integerField,
	pluginConfigEnvironmentKey,
	renderConfigReference,
	stringField,
} from "./index";

const load = <A>(config: Config.Config<A>, values: Record<string, string>) =>
	Effect.runSync(
		config.pipe(
			Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(values)),
		),
	);

describe("config definitions", () => {
	it("infers and loads defaults, options, redacted secrets, enums, and nested groups", () => {
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
						options: ["safe", "fast"],
						description: "Server mode",
					}),
					enabled: booleanField({
						label: "Enabled",
						envKey: "ENABLED",
						description: "Enable server",
					}),
				},
			),
		});

		const value = load(definition.config, { TOKEN: "secret", MODE: "safe" });
		expectTypeOf(value.port).toEqualTypeOf<number>();
		expectTypeOf(value.server.token).toEqualTypeOf<Redacted.Redacted>();
		expectTypeOf(value.server.mode).toEqualTypeOf<Option.Option<"safe" | "fast">>();
		expect(value.port).toBe(8000);
		expect(Redacted.value(value.server.token)).toBe("secret");
		expect(value.server.mode).toEqual(Option.some("safe"));
		expect(value.server.enabled).toEqual(Option.none());
		expect(definition.schema.fields.server).toMatchObject({
			type: "object",
			properties: { token: { type: "string", secret: true } },
		});
	});

	it("derives plugin environment names without field overrides", () => {
		const definition = definePluginConfig("media-tracker", {
			apiToken: stringField({
				label: "API token",
				description: "Plugin token",
				validation: { required: true },
			}),
		});
		expect(pluginConfigEnvironmentKey("media-tracker", "apiToken")).toBe(
			"RYOT_PLUGIN_MEDIA_TRACKER_API_TOKEN",
		);
		expect(load(definition.config, { RYOT_PLUGIN_MEDIA_TRACKER_API_TOKEN: "token" })).toEqual({
			apiToken: "token",
		});
	});

	it("loads a runtime AppSchema with a caller-owned environment resolver", () => {
		const schema = {
			unknownKeys: "strict",
			fields: {
				retries: { type: "integer", defaultValue: 2, label: "Retries", description: "Retry count" },
				provider: {
					type: "enum",
					label: "Provider",
					options: ["local", "remote"],
					description: "Provider name",
					validation: { required: true },
				},
			},
		} satisfies AppSchema;
		const config = configFromAppSchema(schema, (path) => `PLUGIN_${path.join("_").toUpperCase()}`);
		expect(load(config, { PLUGIN_PROVIDER: "remote" })).toEqual({
			retries: 2,
			provider: "remote",
		});
	});

	it("reports the environment key and allowed values for invalid enums", () => {
		const definition = defineConfig({
			mode: enumField({
				label: "Mode",
				envKey: "MODE",
				options: ["safe", "fast"],
				description: "Server mode",
				validation: { required: true },
			}),
		});

		expect(() => load(definition.config, { MODE: "unsafe" })).toThrow(
			"MODE must be one of: safe, fast",
		);
	});
});

describe("config reference", () => {
	it("renders nested core and plugin metadata while omitting hidden fields", () => {
		const core = defineConfig({
			timezone: stringField({
				envKey: "TZ",
				label: "Timezone",
				defaultValue: "Etc/GMT",
				description: "Application timezone",
			}),
			server: group(
				{ label: "Server", description: "Server settings" },
				{
					hidden: stringField({
						hidden: true,
						label: "Hidden",
						envKey: "HIDDEN",
						description: "Internal value",
					}),
				},
			),
		});
		const plugin = definePluginConfig("media", {
			token: stringField({
				secret: true,
				label: "Token",
				defaultValue: "token",
				description: "Plugin token",
			}),
		});
		const markdown = renderConfigReference(core, [
			{ name: "Media", slug: "media", schema: plugin },
		]);

		expect(markdown).toContain("# App Backend Configuration Reference");
		expect(markdown).toContain("### Server settings");
		expect(markdown).toContain(
			"| `timezone` | `TZ` | Application timezone | No | No | `Etc/GMT` |",
		);
		expect(markdown).toContain(
			"| `media.token` | `RYOT_PLUGIN_MEDIA_TOKEN` | Token | Plugin token | No | Yes | `token` |",
		);
		expect(markdown).not.toContain("HIDDEN");
	});
});
