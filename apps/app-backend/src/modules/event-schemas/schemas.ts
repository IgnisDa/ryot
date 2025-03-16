import { z } from "zod";
import { itemDataSchema, listDataSchema } from "~/lib/openapi";
import {
	createNameWithOptionalSlugSchema,
	nonEmptyTrimmedStringSchema,
} from "~/lib/zod/base";
import { createLabeledPropertySchemas } from "../property-schemas/schemas";

const eventSchemaPropertiesSchema = createLabeledPropertySchemas(
	"Event schema properties",
).schema;

export const listedEventSchemaSchema = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	entitySchemaId: z.string(),
	propertiesSchema: eventSchemaPropertiesSchema,
});

export const listEventSchemasResponseSchema = listDataSchema(
	listedEventSchemaSchema,
);

export const createEventSchemaResponseSchema = itemDataSchema(
	listedEventSchemaSchema,
);

export const listEventSchemasQuery = z.object({
	entitySchemaId: nonEmptyTrimmedStringSchema,
});

export const createEventSchemaBody = createNameWithOptionalSlugSchema({
	entitySchemaId: nonEmptyTrimmedStringSchema,
	propertiesSchema: eventSchemaPropertiesSchema,
});

export type CreateEventSchemaBody = z.infer<typeof createEventSchemaBody>;
export type ListedEventSchema = z.infer<typeof listedEventSchemaSchema>;
