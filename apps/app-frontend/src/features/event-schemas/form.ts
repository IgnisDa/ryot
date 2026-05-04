import type { ApiPostRequestBody } from "~/lib/api/types";

import {
	buildDefaultPropertySchemaRow,
	buildPropertiesSchema,
	buildPropertySchemaFormValues,
	createPropertySchemaFormSchema,
	defaultCreatePropertySchemaFormValues,
	isPropertySchemaRowsValid,
	normalizeOptionalSlug,
	propertySchemaTypes,
} from "../property-schemas/form";

export const eventSchemaPropertyTypes = propertySchemaTypes;

export const buildDefaultEventSchemaPropertyRow = buildDefaultPropertySchemaRow;

export const isEventSchemaPropertyRowsValid = isPropertySchemaRowsValid;

export const createEventSchemaFormSchema = createPropertySchemaFormSchema;

export const buildEventSchemaFormValues = buildPropertySchemaFormValues;

export const buildEventSchemaPropertiesSchema = buildPropertiesSchema;

export const defaultCreateEventSchemaFormValues = defaultCreatePropertySchemaFormValues;

export type CreateEventSchemaPayload = ApiPostRequestBody<"/event-schemas">;

export function toCreateEventSchemaPayload(
	input: ReturnType<typeof buildEventSchemaFormValues>,
	entitySchemaId: string,
) {
	return {
		name: input.name.trim(),
		entitySchemaId,
		propertiesSchema: buildEventSchemaPropertiesSchema(input.properties),
		...(normalizeOptionalSlug(input.slug) ? { slug: normalizeOptionalSlug(input.slug) } : {}),
	};
}
