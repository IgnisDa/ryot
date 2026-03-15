import type { AppPropertyDefinition, AppSchema } from "@ryot/ts-utils";
import { fromAppSchema, zodRequiredName } from "@ryot/ts-utils";
import { z } from "zod";

export interface CreateEntityFormValues {
	name: string;
	properties: Record<string, unknown>;
}

export const buildCreateEntityFormSchema = (propertiesSchema: AppSchema) => {
	const propertySchemas: Record<string, z.ZodType> = {};

	for (const [key, propertyDef] of Object.entries(propertiesSchema)) {
		const zodSchema = fromAppSchema(propertyDef);
		propertySchemas[key] = propertyDef.required
			? zodSchema
			: zodSchema.optional();
	}

	return z.object({
		name: zodRequiredName,
		properties: z.object(propertySchemas),
	});
};

export const buildDefaultEntityFormValues = (
	propertiesSchema: AppSchema,
): CreateEntityFormValues => {
	const properties: Record<string, unknown> = {};

	for (const [key, propertyDef] of Object.entries(propertiesSchema)) {
		if (propertyDef.required) properties[key] = getDefaultValue(propertyDef);
	}

	return { name: "", properties };
};

const getDefaultValue = (propertyDef: AppPropertyDefinition): unknown => {
	switch (propertyDef.type) {
		case "string":
		case "date":
			return "";
		case "number":
		case "integer":
			return 0;
		case "boolean":
			return false;
		case "array":
			return [];
		case "object": {
			const obj: Record<string, unknown> = {};
			for (const [key, nestedDef] of Object.entries(propertyDef.properties))
				obj[key] = getDefaultValue(nestedDef);
			return obj;
		}
		default:
			return null;
	}
};

export interface CreateEntityPayload {
	name: string;
	properties: Record<string, unknown>;
	entitySchemaId: string;
}

export function toCreateEntityPayload(
	input: CreateEntityFormValues,
	entitySchemaId: string,
): CreateEntityPayload {
	return {
		entitySchemaId,
		name: input.name.trim(),
		properties: input.properties,
	};
}
