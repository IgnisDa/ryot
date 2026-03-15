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

export const eventSchemaPropertyTypes = propertySchemaTypes;

export type EventSchemaPropertyType = PropertySchemaType;

export type EventSchemaPropertyRow = PropertySchemaRow;

export type EventSchemaPropertyInput = PropertySchemaInput;

export type EventSchemaFormValues = PropertySchemaFormValues;

export type CreateEventSchemaFormValues = CreatePropertySchemaFormValues;

export const buildDefaultEventSchemaPropertyRow = buildDefaultPropertySchemaRow;

export const isEventSchemaPropertyRowsValid = isPropertySchemaRowsValid;

export const createEventSchemaFormSchema = createPropertySchemaFormSchema;

export const buildEventSchemaFormValues = buildPropertySchemaFormValues;

export const buildEventSchemaPropertiesSchema = buildPropertiesSchema;

export const defaultCreateEventSchemaFormValues =
	defaultCreatePropertySchemaFormValues;

export interface CreateEventSchemaPayload {
	name: string;
	slug?: string;
	entitySchemaId: string;
	propertiesSchema: AppSchema;
}

export function toCreateEventSchemaPayload(
	input: CreateEventSchemaFormValues,
	entitySchemaId: string,
) {
	return {
		name: input.name.trim(),
		entitySchemaId,
		propertiesSchema: buildEventSchemaPropertiesSchema(input.properties),
		...(normalizeOptionalSlug(input.slug)
			? { slug: normalizeOptionalSlug(input.slug) }
			: {}),
	};
}
