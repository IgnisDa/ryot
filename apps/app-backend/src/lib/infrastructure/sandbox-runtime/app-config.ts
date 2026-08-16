import { configFromAppSchema } from "@ryot/config";
import { pluginConfigEnvironmentKey } from "@ryot/contract/modules/plugins/plugin-config";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { Effect, Match, Option } from "effect";

import { parseAppSchemaProperties } from "../../property-schema/property-schema-runtime";
import { appConfigDefinition } from "../config/definition";

const pluginReadableSystemConfigKeys = new Set(["timezone"]);

const requiredKeys = (metadata: unknown, name: string): ReadonlyArray<string> =>
	isObjectRecord(metadata) && Array.isArray(metadata[name])
		? metadata[name].filter((value): value is string => typeof value === "string")
		: [];

const pluginConfigPropertyEntry = ([key, value]: [string, unknown]) => {
	if (!Option.isOption(value)) {
		return [[key, value]] as const;
	}
	return Option.isSome(value) ? ([[key, value.value]] as const) : [];
};

const resolvePluginConfig = Effect.fn("resolvePluginConfig")(function* (input: {
	pluginSlug: string;
	configSchema: AppSchema;
}) {
	const loaded = yield* configFromAppSchema(input.configSchema, ([key]) =>
		pluginConfigEnvironmentKey(input.pluginSlug, key ?? ""),
	);
	const properties = Object.fromEntries(Object.entries(loaded).flatMap(pluginConfigPropertyEntry));
	return yield* parseAppSchemaProperties({
		kind: `Plugin ${input.pluginSlug} config`,
		properties,
		propertiesSchema: input.configSchema,
	});
});

export type PluginConfigContext =
	| { readonly kind: "environment"; readonly pluginSlug: string; readonly configSchema: AppSchema }
	| {
			readonly kind: "installation";
			readonly configSchema: AppSchema;
			readonly config: Readonly<Record<string, unknown>>;
	  };

const resolveContextConfig = (context: PluginConfigContext) =>
	Match.value(context).pipe(
		Match.when({ kind: "environment" }, resolvePluginConfig),
		Match.when({ kind: "installation" }, (installation) =>
			parseAppSchemaProperties({
				properties: installation.config,
				kind: "Plugin installation config",
				propertiesSchema: installation.configSchema,
			}),
		),
		Match.exhaustive,
	);

const unconfiguredMessage = (context: PluginConfigContext, key: string) =>
	context.kind === "environment"
		? `Plugin config key "${key}" is not configured; set ${pluginConfigEnvironmentKey(context.pluginSlug, key)}`
		: `Plugin config key "${key}" is not configured for this installation`;

export const getPluginConfig = Effect.fn("getPluginConfig")(function* (input: {
	metadata: unknown;
	keys: ReadonlyArray<string>;
	context: PluginConfigContext;
}) {
	const keys = [...new Set(input.keys)];
	const declaredKeys = new Set(requiredKeys(input.metadata, "requiredPluginConfigKeys"));
	for (const key of keys) {
		if (!declaredKeys.has(key)) {
			return yield* Effect.fail(`Plugin config key "${key}" is not declared by this script`);
		}
		if (!Object.hasOwn(input.context.configSchema.fields, key)) {
			return yield* Effect.fail(`Plugin config key "${key}" does not exist`);
		}
	}

	if (keys.length === 0) {
		return {};
	}

	const parsed = yield* resolveContextConfig(input.context);
	const values: Record<string, unknown> = {};
	for (const key of keys) {
		const value = parsed[key];
		if (value === undefined) {
			return yield* Effect.fail(unconfiguredMessage(input.context, key));
		}
		values[key] = value;
	}
	return values;
});

export const isPluginConfigKeyConfigured = Effect.fn("isPluginConfigKeyConfigured")(
	function* (input: { key: string; context: PluginConfigContext }) {
		if (!Object.hasOwn(input.context.configSchema.fields, input.key)) {
			return false;
		}
		const result = yield* Effect.result(resolveContextConfig(input.context));
		return result._tag === "Success" && result.success[input.key] !== undefined;
	},
);

export const getSystemConfig = Effect.fn("getSystemConfig")(function* (
	keys: ReadonlyArray<string>,
	metadata: unknown,
) {
	const uniqueKeys = [...new Set(keys)];
	const declaredKeys = new Set(requiredKeys(metadata, "requiredSystemConfigKeys"));
	for (const key of uniqueKeys) {
		if (!pluginReadableSystemConfigKeys.has(key)) {
			return yield* Effect.fail(`System config key "${key}" is not available to plugins`);
		}
		if (!declaredKeys.has(key)) {
			return yield* Effect.fail(`System config key "${key}" is not declared by this script`);
		}
	}

	if (uniqueKeys.length === 0) {
		return {};
	}

	const definition = appConfigDefinition.fields.timezone;
	const loaded = yield* configFromAppSchema(
		{ fields: { timezone: definition.schema }, unknownKeys: "strict" },
		() => definition.envKey ?? "",
	);
	const values: Record<string, unknown> = {};
	for (const key of uniqueKeys) {
		if (definition.envKey === undefined) {
			return yield* Effect.fail(`System config key "${key}" is not configured`);
		}
		const loadedValue = loaded[key];
		const value = Option.isOption(loadedValue) ? Option.getOrUndefined(loadedValue) : loadedValue;
		values[key] = value ?? definition.schema.defaultValue;
	}
	return values;
});
