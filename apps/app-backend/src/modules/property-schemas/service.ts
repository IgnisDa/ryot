import type { AppSchema } from "@ryot/ts-utils";
import { appPropertyPrimitiveTypes } from "@ryot/ts-utils";

type JsonObject = Record<string, unknown>;

type PropertySchemaLabels = {
	schemaLabel: string;
	propertiesLabel: string;
};

export const createPropertySchemaLabels = (propertiesLabel: string) => ({
	propertiesLabel,
	schemaLabel: `${propertiesLabel} schema`,
});

const isJsonObject = (value: unknown) => {
	return typeof value === "object" && value !== null && !Array.isArray(value);
};

const validateOptionalTrueFlag = (
	key: string,
	name: "required" | "nullable",
	value: unknown,
) => {
	if (value !== undefined && value !== true)
		throw new Error(`Property "${key}" must have ${name}=true when present`);
};

const validateAllowedKeys = (
	key: string,
	prop: JsonObject,
	allowedKeys: string[],
) => {
	for (const propKey of Object.keys(prop))
		if (!allowedKeys.includes(propKey))
			throw new Error(`Property "${key}" has unsupported key "${propKey}"`);
};

const validatePropertyDefinition = (key: string, property: unknown): void => {
	if (!isJsonObject(property))
		throw new Error(`Property "${key}" must be an object`);

	const prop = property as JsonObject;

	if (!prop.type || typeof prop.type !== "string")
		throw new Error(`Property "${key}" must have a type field`);

	const type = prop.type;
	validateOptionalTrueFlag(key, "required", prop.required);
	validateOptionalTrueFlag(key, "nullable", prop.nullable);

	if (
		!appPropertyPrimitiveTypes.includes(type as never) &&
		type !== "array" &&
		type !== "object"
	)
		throw new Error(`Property "${key}" has invalid type "${type}"`);

	if (appPropertyPrimitiveTypes.includes(type as never)) {
		validateAllowedKeys(key, prop, ["nullable", "required", "type"]);
		return;
	}

	if (type === "array") {
		validateAllowedKeys(key, prop, ["items", "nullable", "required", "type"]);
		if (!prop.items)
			throw new Error(
				`Property "${key}" with type "array" must have an items field`,
			);

		validatePropertyDefinition(`${key}[]`, prop.items);
	}

	if (type === "object") {
		validateAllowedKeys(key, prop, [
			"nullable",
			"properties",
			"required",
			"type",
		]);
		if (!isJsonObject(prop.properties))
			throw new Error(
				`Property "${key}" with type "object" must have a properties field`,
			);

		const nestedProps = prop.properties as JsonObject;
		for (const [nestedKey, nestedValue] of Object.entries(nestedProps))
			validatePropertyDefinition(`${key}.${nestedKey}`, nestedValue);
	}
};

export const parsePropertySchemaInput = (
	input: unknown,
	labels: PropertySchemaLabels,
): AppSchema => {
	if (!isJsonObject(input))
		throw new Error(`${labels.schemaLabel} must be a JSON object`);

	const parsedObject = input as JsonObject;

	if (Object.keys(parsedObject).length === 0)
		throw new Error(
			`${labels.propertiesLabel} must contain at least one property`,
		);

	for (const [key, value] of Object.entries(parsedObject))
		validatePropertyDefinition(key, value);

	return parsedObject as AppSchema;
};

export const parseLabeledPropertySchemaInput = (
	input: unknown,
	propertiesLabel: string,
) =>
	parsePropertySchemaInput(input, createPropertySchemaLabels(propertiesLabel));
