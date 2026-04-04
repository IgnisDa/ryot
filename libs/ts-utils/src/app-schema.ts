import { z } from "zod";

export const appPropertyPrimitiveTypes = [
	"string",
	"number",
	"integer",
	"boolean",
	"date",
] as const;

export type AppPropertyPrimitiveType =
	(typeof appPropertyPrimitiveTypes)[number];

export type AppSchema = Record<string, AppPropertyDefinition>;

export type AppPropertyDefinition =
	| AppArrayProperty
	| AppPrimitiveProperty
	| AppObjectProperty;

export type AppPrimitiveProperty = {
	required?: true;
	type: AppPropertyPrimitiveType;
};

export type AppArrayProperty = {
	type: "array";
	required?: true;
	items: AppPropertyDefinition;
};

export type AppObjectProperty = {
	type: "object";
	required?: true;
	properties: Record<string, AppPropertyDefinition>;
};

/**
 * Converts a Zod schema to the app schema format.
 *
 * Currently supports the following Zod types:
 * - `z.string()` → `{ type: "string" }`
 * - `z.string().date()` → `{ type: "date" }`
 * - `z.iso.datetime()` → `{ type: "date" }`
 * - `z.number()` → `{ type: "number" }`
 * - `z.number().int()` → `{ type: "integer" }`
 * - `z.boolean()` → `{ type: "boolean" }`
 * - `z.array(T)` → `{ type: "array", items: {...} }`
 * - `z.object({ ... })` → `{ type: "object", properties: {...} }`
 *
 * @param schema - The Zod schema to convert
 * @returns The app schema property definition
 * @throws {Error} If the Zod type is not supported
 */
export const toAppSchema = (schema: z.ZodType): AppPropertyDefinition => {
	if (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional) {
		const innerType = schema._def.innerType;
		if (!innerType || typeof innerType !== "object") {
			throw new Error(
				"Invalid nullable/optional wrapper: innerType is missing or invalid",
			);
		}
		const innerSchema = innerType as z.ZodType;
		return toAppSchema(innerSchema);
	}

	if (schema instanceof z.ZodString) {
		if (schema.format === "date") {
			return { type: "date" };
		}
		return { type: "string" };
	}

	if (schema instanceof z.ZodNumber) {
		if (schema.format === "safeint") {
			return { type: "integer" };
		}
		return { type: "number" };
	}

	if (schema instanceof z.ZodBoolean) {
		return { type: "boolean" };
	}

	if (schema.constructor.name === "ZodISODateTime") {
		return { type: "date" };
	}

	if (schema instanceof z.ZodArray) {
		return {
			type: "array",
			items: toAppSchema(schema.element as z.ZodType),
		};
	}

	if (schema instanceof z.ZodObject) {
		const properties: Record<string, AppPropertyDefinition> = {};
		for (const [key, value] of Object.entries(schema.shape)) {
			properties[key] = toAppSchema(value as z.ZodType);
		}
		return { properties, type: "object" };
	}

	throw new Error(`Unsupported Zod type: ${schema.constructor.name}`);
};

/**
 * Converts a top-level Zod object schema to an AppSchema (flat properties map).
 * This is the main export for converting seeded schemas to storage format.
 *
 * @param schema - The Zod object schema to convert
 * @returns A flat properties map without the top-level "type: object" wrapper
 */
export const toAppSchemaProperties = (
	schema: z.ZodObject<z.ZodRawShape>,
): AppSchema => {
	const properties: AppSchema = {};

	for (const [key, value] of Object.entries(schema.shape)) {
		properties[key] = toAppSchema(value as z.ZodType);
	}

	return properties;
};

/**
 * Converts an AppPropertyDefinition back to a Zod schema.
 *
 * This is the inverse of `toAppSchema()`. Supports all property types:
 * - Primitives: string, number, integer, boolean, date
 * - Arrays with recursive item conversion
 * - Objects with recursive property conversion
 *
 * @param property - The app schema property definition to convert
 * @returns A Zod schema that validates data according to the property definition
 * @throws {Error} If the property type is not supported
 */
export const fromAppSchema = (property: AppPropertyDefinition): z.ZodType => {
	let schema: z.ZodType;

	switch (property.type) {
		case "string":
			schema = z.string();
			break;
		case "number":
			schema = z.number();
			break;
		case "integer":
			schema = z.number().int();
			break;
		case "boolean":
			schema = z.boolean();
			break;
		case "date":
			schema = z.iso.date();
			break;
		case "array": {
			const arrayProp = property as AppArrayProperty;
			schema = z.array(fromAppSchema(arrayProp.items));
			break;
		}
		case "object": {
			const objectProp = property as AppObjectProperty;
			const shape: Record<string, z.ZodType> = {};

			for (const [key, value] of Object.entries(objectProp.properties)) {
				shape[key] = fromAppSchema(value);
			}

			schema = z.object(shape);
			break;
		}
		default:
			throw new Error(
				`Unsupported app schema type: ${(property as { type: string }).type}`,
			);
	}

	return schema;
};
