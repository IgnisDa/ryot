import { zodNonEmptyTrimmedString } from "@ryot/ts-utils";
import type { z } from "zod";
import type { ApiPostRequestBody } from "#/lib/api/types";
import {
	buildDefaultPropertySchemaRow,
	buildPropertiesSchema,
	buildPropertySchemaFormValues,
	createPropertySchemaFormSchema,
	isPropertySchemaRowsValid,
	normalizeOptionalSlug,
	type PropertySchemaInput,
	propertySchemaTypes,
} from "../property-schemas/form";

export const entitySchemaPropertyTypes = propertySchemaTypes;

export type CreateEntitySchemaFormValues = z.infer<
	typeof createEntitySchemaFormSchema
>;

type EntitySchemaFormInput = Partial<
	Omit<CreateEntitySchemaFormValues, "properties">
> & {
	properties?: PropertySchemaInput[];
};

export const buildDefaultEntitySchemaPropertyRow =
	buildDefaultPropertySchemaRow;

export const isEntitySchemaPropertyRowsValid = isPropertySchemaRowsValid;

export const createEntitySchemaFormSchema =
	createPropertySchemaFormSchema.extend({
		icon: zodNonEmptyTrimmedString("Icon is required"),
		accentColor: zodNonEmptyTrimmedString("Accent color is required"),
	});

export function buildEntitySchemaFormValues(
	values?: EntitySchemaFormInput,
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

export type CreateEntitySchemaPayload = ApiPostRequestBody<"/entity-schemas">;

export function toCreateEntitySchemaPayload(
	input: CreateEntitySchemaFormValues,
	trackerId: string,
) {
	return {
		trackerId,
		icon: input.icon.trim(),
		name: input.name.trim(),
		accentColor: input.accentColor.trim(),
		propertiesSchema: buildEntitySchemaPropertiesSchema(input.properties),
		...(normalizeOptionalSlug(input.slug)
			? { slug: normalizeOptionalSlug(input.slug) }
			: {}),
	};
}
