import { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils";
import { imagesSchema, nullableStringSchema, stringArraySchema } from "../zod";

export const personPropertiesSchema = z
	.object({
		images: imagesSchema,
		gender: nullableStringSchema,
		website: nullableStringSchema,
		sourceUrl: nullableStringSchema,
		birthDate: nullableStringSchema,
		deathDate: nullableStringSchema,
		birthPlace: nullableStringSchema,
		description: nullableStringSchema,
		alternateNames: stringArraySchema,
	})
	.strict();

export const personPropertiesJsonSchema = toAppSchemaProperties(
	personPropertiesSchema,
);

export type PersonProperties = z.infer<typeof personPropertiesSchema>;
