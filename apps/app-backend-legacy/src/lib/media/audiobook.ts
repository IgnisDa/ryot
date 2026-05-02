import type { z } from "@hono/zod-openapi";

import { imagesSchema, nullableIntSchema } from "../zod";
import { mediaWithUnlinkedCreatorsPropertiesSchema } from "./common";

export const audiobookPropertiesSchema = mediaWithUnlinkedCreatorsPropertiesSchema.extend({
	runtime: nullableIntSchema.describe("Total listening time in minutes"),
	images: imagesSchema.describe("Cover and promotional images for this audiobook"),
});


export type AudiobookProperties = z.infer<typeof audiobookPropertiesSchema>;
