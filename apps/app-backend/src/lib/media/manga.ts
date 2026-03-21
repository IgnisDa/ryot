import type { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils/app-schema";

import { imagesSchema, nullableIntSchema, nullableNumberSchema } from "../zod";
import { mediaPropertiesSchema } from "./common";

export const mangaPropertiesSchema = mediaPropertiesSchema.extend({
	images: imagesSchema.describe("Cover and promotional images for this manga"),
	volumes: nullableIntSchema.describe("Total number of volumes, if known"),
	chapters: nullableNumberSchema.describe("Total number of chapters, if known"),
});

export const mangaPropertiesJsonSchema = toAppSchemaProperties(mangaPropertiesSchema);

export type MangaProperties = z.infer<typeof mangaPropertiesSchema>;
