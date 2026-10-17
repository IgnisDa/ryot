import type { SandboxBoundaryReason } from "@ryot-app/contract/modules/scripts/boundary-reason";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Effect } from "effect";

import { parseAppSchemaProperties } from "#modules/definitions/properties/runtime";

const requiredKeys = (metadata: unknown, name: string): ReadonlyArray<string> =>
	isObjectRecord(metadata) && Array.isArray(metadata[name])
		? metadata[name].filter((value): value is string => typeof value === "string")
		: [];

type PluginConfigContext = {
	readonly configSchema: AppSchema;
	readonly config: Readonly<Record<string, unknown>>;
};

export const resolveContextConfig = (context: PluginConfigContext, keys: ReadonlyArray<string>) =>
	parseAppSchemaProperties({
		kind: "Plugin config",
		properties: Object.fromEntries(
			Object.entries(context.config).filter(([key]) => keys.includes(key)),
		),
		propertiesSchema: {
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
	});

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
				return yield* Effect.fail({
					message: `Plugin config key "${key}" is not configured for this execution`,
					data: { keys: [key], code: "missing-required-config" } satisfies SandboxBoundaryReason,
				});
			}
			continue;
		}
		values[key] = value;
	}
	return values;
});
