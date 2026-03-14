import type { AppPropertyDefinition, AppSchema } from "@ryot/ts-utils";
import { fromAppSchema, zodRequiredName } from "@ryot/ts-utils";
import { z } from "zod";

export type EntityImageValue =
	| { kind: "s3"; key: string }
	| { kind: "remote"; url: string }
	| null
	| undefined;

export interface CreateEntityFormValues {
	name: string;
	image: EntityImageValue;
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
		image: z.union([
			z.object({ kind: z.literal("s3"), key: z.string() }),
			z.object({ kind: z.literal("remote"), url: z.string() }),
			z.null(),
			z.undefined(),
		]),
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

	return { name: "", image: null, properties };
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
	entitySchemaId: string;
	image: EntityImageValue;
	properties: Record<string, unknown>;
}

export function toCreateEntityPayload(
	input: CreateEntityFormValues,
	entitySchemaId: string,
): CreateEntityPayload {
	return {
		entitySchemaId,
		image: input.image,
		name: input.name.trim(),
		properties: input.properties,
	};
}
