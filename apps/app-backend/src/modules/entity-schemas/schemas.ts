import { z } from "zod";
import { dataSchema } from "~/lib/openapi";
import {
	createNameWithOptionalSlugSchema,
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
	facetId: z.string(),
	isBuiltin: z.boolean(),
	propertiesSchema: entitySchemaPropertiesObjectSchema,
});

export const listEntitySchemasResponseSchema = dataSchema(
	z.array(listedEntitySchemaSchema),
);

export const createEntitySchemaResponseSchema = dataSchema(
	listedEntitySchemaSchema,
);

export const listEntitySchemasQuery = z.object({
	facetId: nonEmptyTrimmedStringSchema,
});

export const createEntitySchemaBody = createNameWithOptionalSlugSchema({
	facetId: nonEmptyTrimmedStringSchema,
	propertiesSchema: entitySchemaPropertiesInputSchema,
});

export type CreateEntitySchemaBody = z.infer<typeof createEntitySchemaBody>;
