import { z } from "zod";
import { itemDataSchema, listDataSchema } from "~/lib/openapi";
import {
	createIdParamsSchema,
	createNameWithOptionalSlugSchema,
	createUniqueNonEmptyTrimmedStringArraySchema,
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

export const listEntitySchemasResponseSchema = listDataSchema(
	listedEntitySchemaSchema,
);

export const createEntitySchemaResponseSchema = itemDataSchema(
	listedEntitySchemaSchema,
);

export const entitySchemaParams = createIdParamsSchema("entitySchemaId");

export const listEntitySchemasQuery = z.object({
	trackerId: nonEmptyTrimmedStringSchema.optional(),
	slugs: z
		.preprocess(
			(val) => (typeof val === "string" ? [val] : val),
			createUniqueNonEmptyTrimmedStringArraySchema({
				minMessage: "At least one slug is required",
				duplicateMessage: "Entity schema slugs must be unique",
			}),
		)
		.optional(),
});

export const createEntitySchemaBody = createNameWithOptionalSlugSchema({
	trackerId: nonEmptyTrimmedStringSchema,
	propertiesSchema: entitySchemaPropertiesInputSchema,
	...iconAndAccentColorFields,
});

export type ListedEntitySchema = z.infer<typeof listedEntitySchemaSchema>;
export type CreateEntitySchemaBody = z.infer<typeof createEntitySchemaBody>;
