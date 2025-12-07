import { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils/app-schema";

import { imagesSchema, nullableIntSchema, nullableStringSchema } from "../zod";

export const mediaGroupPropertiesSchema = z
	.object({
		parts: nullableIntSchema.describe("Number of items in this group"),
		images: imagesSchema.describe("Cover and promotional images for this group"),
		description: nullableStringSchema.describe(
			"Overview or description provided by the data provider",
		),
		sourceUrl: nullableStringSchema.describe(
			"Link to the original source or external provider page",
		),
	})
	.strict();

export const mediaGroupPropertiesJsonSchema = toAppSchemaProperties(mediaGroupPropertiesSchema);

export type MediaGroupProperties = z.infer<typeof mediaGroupPropertiesSchema>;
