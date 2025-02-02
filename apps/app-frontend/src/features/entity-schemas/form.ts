import type { AppSchema } from "@ryot/ts-utils";
import {
	buildDefaultPropertySchemaRow,
	buildPropertiesSchema,
	buildPropertySchemaFormValues,
	type CreatePropertySchemaFormValues,
	createPropertySchemaFormSchema,
	defaultCreatePropertySchemaFormValues,
	isPropertySchemaRowsValid,
	normalizeOptionalSlug,
	type PropertySchemaFormValues,
	type PropertySchemaInput,
	type PropertySchemaRow,
	type PropertySchemaType,
	propertySchemaTypes,
} from "../property-schemas/form";

export const entitySchemaPropertyTypes = propertySchemaTypes;

export type EntitySchemaPropertyType = PropertySchemaType;

export type EntitySchemaPropertyRow = PropertySchemaRow;

export type EntitySchemaPropertyInput = PropertySchemaInput;

export type EntitySchemaFormValues = PropertySchemaFormValues;

export type CreateEntitySchemaFormValues = CreatePropertySchemaFormValues;

export const buildDefaultEntitySchemaPropertyRow =
	buildDefaultPropertySchemaRow;

export const isEntitySchemaPropertyRowsValid = isPropertySchemaRowsValid;

export const createEntitySchemaFormSchema = createPropertySchemaFormSchema;

export const buildEntitySchemaFormValues = buildPropertySchemaFormValues;

export const buildEntitySchemaPropertiesSchema = buildPropertiesSchema;

export const defaultCreateEntitySchemaFormValues =
	defaultCreatePropertySchemaFormValues;

export interface CreateEntitySchemaPayload {
	name: string;
	slug?: string;
	facetId: string;
	propertiesSchema: AppSchema;
}

export function toCreateEntitySchemaPayload(
	input: CreateEntitySchemaFormValues,
	facetId: string,
) {
	return {
		name: input.name.trim(),
		facetId,
		propertiesSchema: buildEntitySchemaPropertiesSchema(input.properties),
		...(normalizeOptionalSlug(input.slug)
			? { slug: normalizeOptionalSlug(input.slug) }
			: {}),
	};
}
