import type { z } from "@hono/zod-openapi";

import { imagesSchema, nullableIntSchema, nullableNumberSchema } from "../zod";
import { mediaPropertiesSchema } from "./common";

export const mangaPropertiesSchema = mediaPropertiesSchema.extend({
	volumes: nullableIntSchema.describe("Total number of volumes, if known"),
	images: imagesSchema.describe("Cover and promotional images for this manga"),
	chapters: nullableNumberSchema.describe("Total number of chapters, if known"),
});


export type MangaProperties = z.infer<typeof mangaPropertiesSchema>;
