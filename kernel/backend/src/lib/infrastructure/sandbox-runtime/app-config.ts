import { configFromAppSchema } from "@ryot-app/config";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Effect, Match, Option } from "effect";

import { parseAppSchemaProperties } from "../../property-schema/property-schema-runtime";

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
		properties,
		propertiesSchema: input.configSchema,
		kind: `Plugin ${input.pluginSlug} config`,
	});
});

export type PluginConfigContext =
	| { readonly kind: "environment"; readonly pluginSlug: string; readonly configSchema: AppSchema }
	| {
			readonly kind: "installation";
			readonly configSchema: AppSchema;
			readonly config: Readonly<Record<string, unknown>>;
	  };

export const resolveContextConfig = (
	context: PluginConfigContext,
	keys?: ReadonlyArray<string>,
) => {
	const selected =
		keys === undefined
			? context
			: {
					...context,
					configSchema: {
						unknownKeys: "strict" as const,
						fields: Object.fromEntries(
							Object.entries(context.configSchema.fields)
								.filter(([key]) => keys.includes(key))
								.map(([key, property]) => [
									key,
									{ ...property, validation: { ...property.validation, required: undefined } },
								]),
						),
					},
					...(context.kind === "installation"
						? {
								config: Object.fromEntries(
									Object.entries(context.config).filter(([key]) => keys.includes(key)),
								),
							}
						: {}),
				};
	return Match.value(selected).pipe(
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
};

const unconfiguredMessage = (context: PluginConfigContext, key: string) =>
	context.kind === "environment"
		? `Plugin config key "${key}" is not configured; set ${pluginConfigEnvironmentKey(context.pluginSlug, key)}`
		: `Plugin config key "${key}" is not configured for this installation`;

export const getPluginConfig = Effect.fn("getPluginConfig")(function* (input: {
	metadata: unknown;
	access: { readonly required?: ReadonlyArray<string>; readonly optional?: ReadonlyArray<string> };
	context: PluginConfigContext;
}) {
	const required = new Set(input.access.required ?? []);
	const keys = [...new Set([...required, ...(input.access.optional ?? [])])];
	const declaredRequired = new Set(requiredKeys(input.metadata, "requiredPluginConfigKeys"));
	const declaredKeys = new Set([
		...declaredRequired,
		...requiredKeys(input.metadata, "optionalPluginConfigKeys"),
	]);
	for (const key of keys) {
		if (!declaredKeys.has(key)) {
			return yield* Effect.fail(`Plugin config key "${key}" is not declared by this script`);
		}
		if (required.has(key) && !declaredRequired.has(key)) {
			return yield* Effect.fail(`Plugin config key "${key}" is not a required read by this script`);
		}
		if (!Object.hasOwn(input.context.configSchema.fields, key)) {
			return yield* Effect.fail(`Plugin config key "${key}" does not exist`);
		}
	}

	if (keys.length === 0) {
		return {};
	}

	const parsed = yield* resolveContextConfig(input.context, keys);
	const values: Record<string, unknown> = {};
	for (const key of keys) {
		const value = parsed[key];
		if (value === undefined) {
			if (required.has(key)) {
				return yield* Effect.fail(unconfiguredMessage(input.context, key));
			}
			continue;
		}
		values[key] = value;
	}
	return values;
});
