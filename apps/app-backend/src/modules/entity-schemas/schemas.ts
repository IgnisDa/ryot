import { z } from "zod";
import { dataSchema } from "~/lib/openapi";
import {
	createNameWithOptionalSlugSchema,
	nonEmptyTrimmedStringSchema,
} from "~/lib/zod/base";

/**
 * App schema format: flat properties map where each value is a property definition.
 * Property definitions must have a "type" field and optional "nullable"/"required" modifiers.
 */
export const entitySchemaPropertiesObjectSchema: z.ZodType<
	Record<string, unknown>
> = z.record(z.string(), z.unknown()).refine(
	(value) => {
		const keys = Object.keys(value);
		return keys.length > 0;
	},
	{ message: "Entity schema properties must contain at least one property" },
);

export const entitySchemaPropertiesInputSchema = z.union([
	z.string(),
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

export const createEntitySchemaBody = createNameWithOptionalSlugSchema({
	facetId: nonEmptyTrimmedStringSchema,
	propertiesSchema: entitySchemaPropertiesInputSchema,
});

export type CreateEntitySchemaBody = z.infer<typeof createEntitySchemaBody>;
