import { isJsonValue } from "@ryot-app/contract/schema/json";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const collectSecretPaths = (
	definition: AppPropertyDefinition,
	value: unknown,
	path: ReadonlyArray<string>,
	paths: Array<ReadonlyArray<string>>,
) => {
	if (definition.secret === true) {
		paths.push(path);
		return;
	}
	if (definition.type === "object" && isRecord(value)) {
		for (const [key, child] of Object.entries(definition.properties)) {
			collectSecretPaths(child, value[key], [...path, key], paths);
		}
	} else if (definition.type === "array" && Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			collectSecretPaths(definition.items, item, [...path, String(index)], paths);
		}
	}
};

export const concretePluginConfigSecretPaths = (
	schema: AppSchema,
	values: Readonly<Record<string, unknown>>,
) => {
	const paths: Array<ReadonlyArray<string>> = [];
	for (const [key, definition] of Object.entries(schema.fields)) {
		collectSecretPaths(definition, values[key], [key], paths);
	}
	return paths;
};

const sanitizeValue = (
	definition: AppPropertyDefinition,
	value: unknown,
	path: string,
	secrets: Set<string>,
): unknown => {
	if (definition.secret === true) {
		if (value !== null && value !== undefined) {
			secrets.add(path);
		}
		return undefined;
	}
	if (
		definition.type === "object" &&
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value)
	) {
		return sanitize(
			definition.properties,
			Object.fromEntries(Object.entries(value)),
			path,
			secrets,
		);
	}
	if (definition.type === "array" && Array.isArray(value)) {
		return value.flatMap((item) => {
			const result = sanitizeValue(definition.items, item, `${path}[]`, secrets);
			return result === undefined ? [] : [result];
		});
	}
	return value;
};

const sanitize = (
	fields: AppSchema["fields"],
	values: Readonly<Record<string, unknown>>,
	prefix: string,
	secrets: Set<string>,
) => {
	const result = { ...values };
	for (const [key, definition] of Object.entries(fields)) {
		if (!Object.hasOwn(values, key)) {
			continue;
		}
		const value = sanitizeValue(
			definition,
			values[key],
			prefix ? `${prefix}.${key}` : key,
			secrets,
		);
		if (value === undefined) {
			Reflect.deleteProperty(result, key);
		} else {
			result[key] = value;
		}
	}
	return result;
};

const sanitizeDefinition = (definition: AppPropertyDefinition): AppPropertyDefinition => {
	if (definition.type === "object") {
		const { defaultValue, properties: _properties, ...rest } = definition;
		const properties = Object.fromEntries(
			Object.entries(definition.properties).map(([key, value]) => [key, sanitizeDefinition(value)]),
		);
		return definition.secret === true || defaultValue === undefined
			? { ...rest, properties }
			: {
					...rest,
					properties,
					defaultValue: sanitize(definition.properties, defaultValue, "", new Set()),
				};
	}
	if (definition.type === "array") {
		const { defaultValue, items: _items, ...rest } = definition;
		const items = sanitizeDefinition(definition.items);
		if (definition.secret === true || defaultValue === undefined) {
			return { ...rest, items };
		}
		const sanitizedDefault = defaultValue.flatMap((item) => {
			const value = sanitizeValue(definition.items, item, "", new Set());
			return value === undefined ? [] : [value];
		});
		return { ...rest, items, defaultValue: sanitizedDefault };
	}
	if (definition.secret === true) {
		const { defaultValue: _defaultValue, ...rest } = definition;
		return rest;
	}
	return definition;
};

export const redactPluginConfig = (
	schema: AppSchema,
	values: Readonly<Record<string, unknown>>,
	retainedSchema?: AppSchema,
) => {
	const secrets = new Set<string>();
	const current = sanitize(schema.fields, values, "", secrets);
	const config = retainedSchema ? sanitize(retainedSchema.fields, current, "", secrets) : current;
	if (!isJsonValue(config)) {
		throw new Error("Plugin configuration is not JSON-compatible");
	}
	return {
		config,
		configuredSecrets: [...secrets].sort(),
		configSchema: {
			...schema,
			fields: Object.fromEntries(
				Object.entries(schema.fields).map(([key, definition]) => [
					key,
					sanitizeDefinition(definition),
				]),
			),
		},
	};
};
