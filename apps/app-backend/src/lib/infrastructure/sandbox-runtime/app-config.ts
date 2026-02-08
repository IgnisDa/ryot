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

export const getPluginConfigValue = Effect.fn("getPluginConfigValue")(function* (input: {
	key: string;
	metadata: unknown;
	pluginSlug: string;
	configSchema: AppSchema;
}) {
	if (!requiredKeys(input.metadata, "requiredPluginConfigKeys").includes(input.key)) {
		return yield* Effect.fail(`Plugin config key "${input.key}" is not declared by this script`);
	}
	if (!Object.hasOwn(input.configSchema.fields, input.key)) {
		return yield* Effect.fail(`Plugin config key "${input.key}" does not exist`);
	}

	const parsed = yield* resolvePluginConfig(input);
	const value = parsed[input.key];
	return value === undefined
		? yield* Effect.fail(
				`Plugin config key "${input.key}" is not configured; set ${pluginConfigEnvironmentKey(input.pluginSlug, input.key)}`,
			)
		: value;
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

export const getSystemConfigValue = Effect.fn("getSystemConfigValue")(function* (
	key: string,
	metadata: unknown,
) {
	if (!pluginReadableSystemConfigKeys.has(key)) {
		return yield* Effect.fail(`System config key "${key}" is not available to plugins`);
	}
	if (!requiredKeys(metadata, "requiredSystemConfigKeys").includes(key)) {
		return yield* Effect.fail(`System config key "${key}" is not declared by this script`);
	}
	const definition = appConfigDefinition.fields.timezone;
	if (definition.envKey === undefined) {
		return yield* Effect.fail(`System config key "${key}" is not configured`);
	}
	const loaded = yield* configFromAppSchema(
		{ fields: { [key]: definition.schema }, unknownKeys: "strict" },
		() => definition.envKey ?? "",
	);
	const loadedValue = loaded[key];
	const value = Option.isOption(loadedValue) ? Option.getOrUndefined(loadedValue) : loadedValue;
	return value ?? definition.schema.defaultValue;
});
