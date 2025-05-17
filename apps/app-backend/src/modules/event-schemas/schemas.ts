import { z } from "zod";
import { dataSchema } from "~/lib/openapi";
import {
	createNameWithOptionalSlugSchema,
	nonEmptyTrimmedStringSchema,
} from "~/lib/zod/base";
import { createLabeledPropertySchemas } from "../property-schemas/schemas";

export const listedEventSchemaSchema = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	entitySchemaId: z.string(),
	propertiesSchema: createLabeledPropertySchemas("Event schema properties")
		.schema,
});

export const listEventSchemasResponseSchema = dataSchema(
	z.array(listedEventSchemaSchema),
);

export const createEventSchemaResponseSchema = dataSchema(
	listedEventSchemaSchema,
);

export const listEventSchemasQuery = z.object({
	entitySchemaId: nonEmptyTrimmedStringSchema,
});

export const createEventSchemaBody = createNameWithOptionalSlugSchema({
	entitySchemaId: nonEmptyTrimmedStringSchema,
	propertiesSchema: createLabeledPropertySchemas("Event schema properties")
		.schema,
});

export type CreateEventSchemaBody = z.infer<typeof createEventSchemaBody>;
export type ListedEventSchema = z.infer<typeof listedEventSchemaSchema>;
