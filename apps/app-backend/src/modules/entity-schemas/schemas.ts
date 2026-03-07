import { z } from "zod";
import { dataSchema } from "~/lib/openapi";
import { nonEmptyTrimmedStringSchema } from "~/lib/zod/base";
import { isEntitySchemaPropertiesString } from "./service";

const entitySchemaPropertiesObjectSchema = z
	.object({
		type: z.literal("object"),
		properties: z.record(z.string(), z.unknown()),
	})
	.strict();

const entitySchemaPropertiesInputSchema = z.union([
	z.string().refine(isEntitySchemaPropertiesString, {
		message: "Entity schema properties schema string is invalid",
	}),
	entitySchemaPropertiesObjectSchema,
]);

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

export const createEntitySchemaBody = z.object({
	name: nonEmptyTrimmedStringSchema,
	facetId: nonEmptyTrimmedStringSchema,
	slug: nonEmptyTrimmedStringSchema.optional(),
	propertiesSchema: entitySchemaPropertiesInputSchema,
});

export type CreateEntitySchemaBody = z.infer<typeof createEntitySchemaBody>;
