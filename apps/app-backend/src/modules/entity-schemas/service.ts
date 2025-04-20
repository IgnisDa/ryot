import type { AppSchema } from "@ryot/ts-utils";
import { appPropertyPrimitiveTypes } from "@ryot/ts-utils";
import { resolveRequiredSlug, resolveRequiredString } from "~/lib/slug";

type JsonObject = Record<string, unknown>;

/**
 * Entity schema properties are stored as an AppSchema (flat properties map).
 */
export type EntitySchemaPropertiesShape = AppSchema;

const isJsonObject = (value: unknown) => {
	return typeof value === "object" && value !== null && !Array.isArray(value);
};

const validatePropertyDefinition = (key: string, property: unknown): void => {
	if (!isJsonObject(property))
		throw new Error(`Property "${key}" must be an object`);

	const prop = property as JsonObject;

	if (!prop.type || typeof prop.type !== "string")
		throw new Error(`Property "${key}" must have a type field`);

	const type = prop.type;

	if (
		!appPropertyPrimitiveTypes.includes(type as never) &&
		type !== "array" &&
		type !== "object"
	)
		throw new Error(`Property "${key}" has invalid type "${type}"`);

	if (type === "array") {
		if (!prop.items)
			throw new Error(
				`Property "${key}" with type "array" must have an items field`,
			);
		// Recursively validate items
		validatePropertyDefinition(`${key}[]`, prop.items);
	}

	if (type === "object") {
		if (!isJsonObject(prop.properties))
			throw new Error(
				`Property "${key}" with type "object" must have a properties field`,
			);
		// Recursively validate nested properties
		const nestedProps = prop.properties as JsonObject;
		for (const [nestedKey, nestedValue] of Object.entries(nestedProps))
			validatePropertyDefinition(`${key}.${nestedKey}`, nestedValue);
	}
};

export const isEntitySchemaPropertiesString = (value: string) => {
	try {
		parseEntitySchemaPropertiesSchema(value);
		return true;
	} catch {
		return false;
	}
};

export const resolveEntitySchemaName = (name: string) =>
	resolveRequiredString(name, "Entity schema name");

export const resolveEntitySchemaFacetId = (facetId: string) =>
	resolveRequiredString(facetId, "Facet id");

export const resolveEntitySchemaSlug = (input: {
	name: string;
	slug?: string;
}) => {
	return resolveRequiredSlug({
		name: input.name,
		slug: input.slug,
		label: "Entity schema",
	});
};

export const parseEntitySchemaPropertiesSchema = (
	input: unknown,
): EntitySchemaPropertiesShape => {
	let parsed = input;

	if (typeof input === "string") {
		try {
			parsed = JSON.parse(input);
		} catch {
			throw new Error("Entity schema properties schema must be valid JSON");
		}
	}

	if (!isJsonObject(parsed))
		throw new Error("Entity schema properties schema must be a JSON object");

	const parsedObject = parsed as JsonObject;

	const keys = Object.keys(parsedObject);
	if (keys.length === 0) {
		throw new Error(
			"Entity schema properties must contain at least one property",
		);
	}

	// Validate each property definition
	for (const [key, value] of Object.entries(parsedObject))
		validatePropertyDefinition(key, value);

	return parsedObject as EntitySchemaPropertiesShape;
};

export const resolveEntitySchemaCreateInput = (input: {
	name: string;
	slug?: string;
	propertiesSchema: unknown;
}) => {
	const name = resolveEntitySchemaName(input.name);
	const slug = resolveEntitySchemaSlug({ name, slug: input.slug });
	const propertiesSchema = parseEntitySchemaPropertiesSchema(
		input.propertiesSchema,
	);

	return { name, slug, propertiesSchema };
};
