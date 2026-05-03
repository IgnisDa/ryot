import { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils";

import { imagesSchema, nullableStringSchema, stringArraySchema } from "../zod";

export const personPropertiesSchema = z
	.object({
		images: imagesSchema.describe("Photos or profile images of this person"),
		gender: nullableStringSchema.describe("Reported gender of this person"),
		website: nullableStringSchema.describe("Official website or online presence of this person"),
		sourceUrl: nullableStringSchema.describe(
			"Link to the external source or provider page for this person",
		),
		birthDate: nullableStringSchema.describe("Date of birth"),
		deathDate: nullableStringSchema.describe("Date of death, if applicable"),
		birthPlace: nullableStringSchema.describe("City or country where this person was born"),
		description: nullableStringSchema.describe(
			"Biography or summary provided by the data provider",
		),
		alternateNames: stringArraySchema.describe("Other names or aliases this person is known by"),
	})
	.strict();

export const personPropertiesJsonSchema = toAppSchemaProperties(personPropertiesSchema);

export type PersonProperties = z.infer<typeof personPropertiesSchema>;
