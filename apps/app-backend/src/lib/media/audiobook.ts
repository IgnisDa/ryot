import type { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils/app-schema";

import { imagesSchema, nullableIntSchema } from "../zod";
import { mediaWithUnlinkedCreatorsPropertiesSchema } from "./common";

export const audiobookPropertiesSchema = mediaWithUnlinkedCreatorsPropertiesSchema.extend({
	images: imagesSchema.describe("Cover and promotional images for this audiobook"),
	runtime: nullableIntSchema.describe("Total listening time in minutes"),
});

export const audiobookPropertiesJsonSchema = toAppSchemaProperties(audiobookPropertiesSchema);

export type AudiobookProperties = z.infer<typeof audiobookPropertiesSchema>;
