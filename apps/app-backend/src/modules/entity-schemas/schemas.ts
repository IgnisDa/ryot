import { z } from "zod";
import { dataSchema } from "~/lib/openapi";
import {
	createNameWithOptionalSlugSchema,
	iconAndAccentColorFields,
	nonEmptyTrimmedStringSchema,
} from "~/lib/zod/base";
import { createLabeledPropertySchemas } from "../property-schemas/schemas";

export const entitySchemaPropertiesObjectSchema = createLabeledPropertySchemas(
	"Entity schema properties",
).schema;

export const entitySchemaPropertiesInputSchema =
	entitySchemaPropertiesObjectSchema;

export const listedEntitySchemaSchema = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	trackerId: z.string(),
	isBuiltin: z.boolean(),
	propertiesSchema: entitySchemaPropertiesObjectSchema,
	...iconAndAccentColorFields,
});

export const listEntitySchemasResponseSchema = dataSchema(
	z.array(listedEntitySchemaSchema),
);

export const createEntitySchemaResponseSchema = dataSchema(
	listedEntitySchemaSchema,
);

export const listEntitySchemasQuery = z.object({
	trackerId: nonEmptyTrimmedStringSchema,
});

export const createEntitySchemaBody = createNameWithOptionalSlugSchema({
	trackerId: nonEmptyTrimmedStringSchema,
	propertiesSchema: entitySchemaPropertiesInputSchema,
	...iconAndAccentColorFields,
});

export type CreateEntitySchemaBody = z.infer<typeof createEntitySchemaBody>;
export type ListedEntitySchema = z.infer<typeof listedEntitySchemaSchema>;
