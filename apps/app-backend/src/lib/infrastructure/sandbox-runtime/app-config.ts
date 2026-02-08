import { configFromAppSchema, pluginConfigEnvironmentKey } from "@ryot/config";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { Effect, Option } from "effect";

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

export const getPluginConfig = Effect.fn("getPluginConfig")(function* (input: {
	keys: ReadonlyArray<string>;
	metadata: unknown;
	pluginSlug: string;
	configSchema: AppSchema;
}) {
	const keys = [...new Set(input.keys)];
	const declaredKeys = new Set(requiredKeys(input.metadata, "requiredPluginConfigKeys"));
	for (const key of keys) {
		if (!declaredKeys.has(key)) {
			return yield* Effect.fail(`Plugin config key "${key}" is not declared by this script`);
		}
		if (!Object.hasOwn(input.configSchema.fields, key)) {
			return yield* Effect.fail(`Plugin config key "${key}" does not exist`);
		}
	}

	if (keys.length === 0) {
		return {};
	}

	const parsed = yield* resolvePluginConfig(input);
	const values: Record<string, unknown> = {};
	for (const key of keys) {
		const value = parsed[key];
		if (value === undefined) {
			return yield* Effect.fail(
				`Plugin config key "${key}" is not configured; set ${pluginConfigEnvironmentKey(input.pluginSlug, key)}`,
			);
		}
		values[key] = value;
	}
	return values;
});

export const isPluginConfigKeyConfigured = Effect.fn("isPluginConfigKeyConfigured")(
	function* (input: { key: string; pluginSlug: string; configSchema: AppSchema }) {
		if (!Object.hasOwn(input.configSchema.fields, input.key)) {
			return false;
		}
		const result = yield* Effect.result(resolvePluginConfig(input));
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
