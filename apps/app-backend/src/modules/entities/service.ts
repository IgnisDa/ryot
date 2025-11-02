import type { AppSchema } from "@ryot/ts-utils";
import { fromAppSchema } from "@ryot/ts-utils";
import { z } from "zod";
import { resolveRequiredString } from "~/lib/slug";

export type EntityPropertiesShape = Record<string, unknown>;

export const resolveEntityName = (name: string) =>
	resolveRequiredString(name, "Entity name");

export const resolveEntitySchemaId = (entitySchemaId: string) =>
	resolveRequiredString(entitySchemaId, "Entity schema id");

export const parseEntityProperties = (input: {
	properties: unknown;
	propertiesSchema: AppSchema;
}) => {
	if (!input.properties || typeof input.properties !== "object")
		throw new Error("Entity properties must be a JSON object");

	if (Array.isArray(input.properties))
		throw new Error("Entity properties must be a JSON object, not an array");

	const schemaShape: Record<string, z.ZodType> = {};

	for (const [key, propertyDef] of Object.entries(input.propertiesSchema)) {
		const zodSchema = fromAppSchema(propertyDef);
		schemaShape[key] = propertyDef.required ? zodSchema : zodSchema.optional();
	}

	const validationSchema = z.object(schemaShape);
	const result = validationSchema.safeParse(input.properties);

	if (!result.success)
		throw new Error(
			`Entity properties validation failed: ${result.error.message}`,
		);

	return result.data as EntityPropertiesShape;
};

export const resolveEntityCreateInput = (input: {
	name: string;
	properties: unknown;
	propertiesSchema: AppSchema;
}) => {
	const name = resolveEntityName(input.name);
	const properties = parseEntityProperties({
		properties: input.properties,
		propertiesSchema: input.propertiesSchema,
	});

	return { name, properties };
};
