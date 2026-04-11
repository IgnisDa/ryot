import { z } from "@hono/zod-openapi";
import { itemDataSchema, listDataSchema } from "~/lib/openapi";
import {
	createIdParamsSchema,
	createNameWithOptionalSlugSchema,
	createUniqueNonEmptyTrimmedStringArraySchema,
	iconAndAccentColorFields,
	nonEmptyTrimmedStringSchema,
} from "~/lib/zod/base";
import { createLabeledPropertySchemas } from "../property-schemas/schemas";

const entitySchemaProperties = createLabeledPropertySchemas(
	"Entity schema properties",
);

export const entitySchemaPropertiesObjectSchema = entitySchemaProperties.schema;

export const entitySchemaPropertiesInputSchema =
	entitySchemaProperties.inputSchema;

export const providerSchema = z.object({
	name: z.string(),
	scriptId: z.string(),
});

export const listedEntitySchemaSchema = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	trackerId: z.string(),
	isBuiltin: z.boolean(),
	providers: z.array(providerSchema),
	propertiesSchema: entitySchemaPropertiesObjectSchema,
	...iconAndAccentColorFields,
});

export const listEntitySchemasResponseSchema = listDataSchema(
	listedEntitySchemaSchema,
);

export const createEntitySchemaResponseSchema = itemDataSchema(
	listedEntitySchemaSchema,
);

export const entitySchemaParams = createIdParamsSchema("entitySchemaId");

export const listEntitySchemasBody = z.object({
	trackerId: nonEmptyTrimmedStringSchema.optional(),
	slugs: createUniqueNonEmptyTrimmedStringArraySchema({
		minMessage: "At least one slug is required",
		duplicateMessage: "Entity schema slugs must be unique",
	}).optional(),
});

export const createEntitySchemaBody = createNameWithOptionalSlugSchema({
	trackerId: nonEmptyTrimmedStringSchema,
	propertiesSchema: entitySchemaPropertiesInputSchema,
	...iconAndAccentColorFields,
});

export type Provider = z.infer<typeof providerSchema>;
export type ListedEntitySchema = z.infer<typeof listedEntitySchemaSchema>;
export type CreateEntitySchemaBody = z.infer<typeof createEntitySchemaBody>;
