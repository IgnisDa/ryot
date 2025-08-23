import { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils/app-schema";

import { imagesSchema, nullableStringSchema, stringArraySchema } from "../zod";

export const personPropertiesSchema = z
	.object({
		birthDate: nullableStringSchema.describe("Date of birth"),
		gender: nullableStringSchema.describe("Reported gender of this person"),
		deathDate: nullableStringSchema.describe("Date of death, if applicable"),
		images: imagesSchema.describe("Photos or profile images of this person"),
		birthPlace: nullableStringSchema.describe("City or country where this person was born"),
		website: nullableStringSchema.describe("Official website or online presence of this person"),
		alternateNames: stringArraySchema.describe("Other names or aliases this person is known by"),
		sourceUrl: nullableStringSchema.describe(
			"Link to the external source or provider page for this person",
		),
		description: nullableStringSchema.describe(
			"Biography or summary provided by the data provider",
		),
	})
	.strict();

export const personPropertiesJsonSchema = toAppSchemaProperties(personPropertiesSchema);

export type PersonProperties = z.infer<typeof personPropertiesSchema>;
