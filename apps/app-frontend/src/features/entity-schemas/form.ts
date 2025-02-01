import type { AppPropertyPrimitiveType } from "@ryot/ts-utils";
import {
	appPropertyPrimitiveTypes,
	zodRequiredName,
	zodRequiredSlug,
} from "@ryot/ts-utils";
import { z } from "zod";

export const entitySchemaPropertyTypes = appPropertyPrimitiveTypes;

export type EntitySchemaPropertyType = AppPropertyPrimitiveType;

export interface EntitySchemaPropertyRow {
	key: string;
	required: boolean;
	type: EntitySchemaPropertyType;
}

export interface EntitySchemaFormValues {
	name: string;
	slug: string;
	properties: EntitySchemaPropertyRow[];
}

export const defaultEntitySchemaPropertiesSchema = "{}";

export function buildDefaultEntitySchemaPropertyRow(): EntitySchemaPropertyRow {
	return { key: "", type: "string", required: false };
}

export function isEntitySchemaPropertyRowsValid(
	rows: EntitySchemaPropertyRow[],
) {
	if (rows.length === 0) return false;

	const keys = rows.map((row) => row.key.trim());

	if (keys.some((key) => key.length === 0)) return false;

	return new Set(keys).size === keys.length;
}

export const createEntitySchemaFormSchema = z.object({
	name: zodRequiredName,
	slug: zodRequiredSlug,
	properties: z
		.array(
			z.object({
				key: z.string(),
				required: z.boolean(),
				type: z.enum(entitySchemaPropertyTypes),
			}),
		)
		.refine(
			(properties) => isEntitySchemaPropertyRowsValid(properties),
			"Properties must contain unique non-empty keys",
		),
});

export type CreateEntitySchemaFormValues = z.infer<
	typeof createEntitySchemaFormSchema
>;

export function buildEntitySchemaFormValues(
	values?: Partial<EntitySchemaFormValues>,
): CreateEntitySchemaFormValues {
	const properties = values?.properties;

	return {
		name: values?.name ?? "",
		slug: values?.slug ?? "",
		properties:
			properties && properties.length > 0
				? properties
				: [buildDefaultEntitySchemaPropertyRow()],
	};
}

export const buildEntitySchemaPropertiesSchema = (
	properties: EntitySchemaPropertyRow[],
) => {
	const propertiesMap: Record<string, unknown> = {};

	for (const property of properties) {
		const key = property.key.trim();
		const propertyDef: Record<string, unknown> = { type: property.type };

		if (property.required) propertyDef.required = true;

		propertiesMap[key] = propertyDef;
	}

	return propertiesMap;
};

export const serializeEntitySchemaProperties = (
	properties: EntitySchemaPropertyRow[],
) => {
	const schema = buildEntitySchemaPropertiesSchema(properties);
	return JSON.stringify(schema);
};

export const defaultCreateEntitySchemaFormValues: CreateEntitySchemaFormValues =
	buildEntitySchemaFormValues();

export interface CreateEntitySchemaPayload {
	name: string;
	slug: string;
	facetId: string;
	propertiesSchema: string;
}

export function toCreateEntitySchemaPayload(
	input: CreateEntitySchemaFormValues,
	facetId: string,
) {
	return {
		facetId,
		name: input.name.trim(),
		slug: input.slug.trim(),
		propertiesSchema: serializeEntitySchemaProperties(input.properties),
	};
}
