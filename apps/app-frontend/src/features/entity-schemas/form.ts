import type { AppSchema } from "@ryot/ts-utils";
import { zodNonEmptyTrimmedString } from "@ryot/ts-utils";
import type { z } from "zod";
import {
	buildDefaultPropertySchemaRow,
	buildPropertiesSchema,
	buildPropertySchemaFormValues,
	createPropertySchemaFormSchema,
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

export interface EntitySchemaFormValues extends PropertySchemaFormValues {
	icon: string;
	accentColor: string;
}

export type CreateEntitySchemaFormValues = z.infer<
	typeof createEntitySchemaFormSchema
>;

export const buildDefaultEntitySchemaPropertyRow =
	buildDefaultPropertySchemaRow;

export const isEntitySchemaPropertyRowsValid = isPropertySchemaRowsValid;

export const createEntitySchemaFormSchema =
	createPropertySchemaFormSchema.extend({
		icon: zodNonEmptyTrimmedString("Icon is required"),
		accentColor: zodNonEmptyTrimmedString("Accent color is required"),
	});

export function buildEntitySchemaFormValues(
	values?: Partial<EntitySchemaFormValues>,
): CreateEntitySchemaFormValues {
	const propertyValues = buildPropertySchemaFormValues(values);

	return {
		icon: values?.icon ?? "",
		name: propertyValues.name,
		slug: propertyValues.slug,
		properties: propertyValues.properties,
		accentColor: values?.accentColor ?? "",
	};
}

export const buildEntitySchemaPropertiesSchema = buildPropertiesSchema;

export const defaultCreateEntitySchemaFormValues =
	buildEntitySchemaFormValues();

export interface CreateEntitySchemaPayload {
	icon: string;
	name: string;
	slug?: string;
	facetId: string;
	accentColor: string;
	propertiesSchema: AppSchema;
}

export function toCreateEntitySchemaPayload(
	input: CreateEntitySchemaFormValues,
	facetId: string,
) {
	return {
		facetId,
		icon: input.icon.trim(),
		name: input.name.trim(),
		accentColor: input.accentColor.trim(),
		propertiesSchema: buildEntitySchemaPropertiesSchema(input.properties),
		...(normalizeOptionalSlug(input.slug)
			? { slug: normalizeOptionalSlug(input.slug) }
			: {}),
	};
}
