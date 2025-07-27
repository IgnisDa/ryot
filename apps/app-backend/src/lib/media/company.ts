import { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils";

import { imagesSchema, nullableIntSchema, nullableStringSchema, stringArraySchema } from "../zod";

export const companyPropertiesSchema = z
	.object({
		foundedYear: nullableIntSchema.describe("Year this company was founded"),
		website: nullableStringSchema.describe("Official website of this company"),
		images: imagesSchema.describe("Logos or images associated with this company"),
		alternateNames: stringArraySchema.describe("Other names or aliases this company is known by"),
		sourceUrl: nullableStringSchema.describe(
			"Link to the external source or provider page for this company",
		),
		headquarters: nullableStringSchema.describe(
			"City or country where this company is headquartered",
		),
		description: nullableStringSchema.describe(
			"Overview or biography provided by the data provider",
		),
	})
	.strict();

export const companyPropertiesJsonSchema = toAppSchemaProperties(companyPropertiesSchema);

export type CompanyProperties = z.infer<typeof companyPropertiesSchema>;
