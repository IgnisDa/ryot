import { z } from "zod";
import { dataSchema } from "~/lib/openapi";
import {
	createNameWithOptionalSlugSchema,
	nonEmptyTrimmedStringSchema,
} from "~/lib/zod/base";
import {
	createPropertySchemaInputSchema,
	createPropertySchemaObjectSchema,
} from "../property-schemas/schemas";

export const entitySchemaPropertiesObjectSchema =
	createPropertySchemaObjectSchema(
		"Entity schema properties must contain at least one property",
	);

export const entitySchemaPropertiesInputSchema =
	createPropertySchemaInputSchema(
		"Entity schema properties must contain at least one property",
	);

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
