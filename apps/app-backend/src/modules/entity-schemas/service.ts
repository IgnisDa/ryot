import { resolveRequiredSlug } from "~/lib/slug";

type JsonObject = Record<string, unknown>;
export type EntitySchemaPropertiesShape = {
	type: "object";
	properties: JsonObject;
};

const isJsonObject = (value: unknown) => {
	return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const isEntitySchemaPropertiesShape = (value: unknown) => {
	if (!isJsonObject(value)) return false;

	const parsedValue = value as JsonObject;

	const keys = Object.keys(parsedValue);
	if (keys.length !== 2) return false;
	if (!keys.includes("type") || !keys.includes("properties")) return false;
	if (parsedValue.type !== "object") return false;

	return isJsonObject(parsedValue.properties);
};

export const isEntitySchemaPropertiesString = (value: string) => {
	try {
		parseEntitySchemaPropertiesSchema(value);
		return true;
	} catch {
		return false;
	}
};

export const resolveEntitySchemaName = (name: string) => {
	const resolvedName = name.trim();

	if (!resolvedName) throw new Error("Entity schema name is required");

	return resolvedName;
};

export const resolveEntitySchemaFacetId = (facetId: string) => {
	const resolvedFacetId = facetId.trim();

	if (!resolvedFacetId) throw new Error("Facet id is required");

	return resolvedFacetId;
};

export const resolveEntitySchemaSlug = (input: {
	name: string;
	slug?: string;
}) => {
	return resolveRequiredSlug({
		name: input.name,
		label: "Entity schema",
		slug: input.slug,
	});
};

export const parseEntitySchemaPropertiesSchema = (input: unknown) => {
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

	if (parsedObject.type !== "object")
		throw new Error('Entity schema properties schema must have type "object"');

	if (!isJsonObject(parsedObject.properties))
		throw new Error(
			"Entity schema properties schema must define an object properties map",
		);

	if (!isEntitySchemaPropertiesShape(parsedObject))
		throw new Error(
			"Entity schema properties schema may only contain type and properties",
		);

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
