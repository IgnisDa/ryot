import type { z } from "@hono/zod-openapi";

import { imagesSchema, nullableIntSchema } from "../zod";
import { mediaPropertiesSchema } from "./common";

export const visualNovelPropertiesSchema = mediaPropertiesSchema.extend({
	images: imagesSchema.describe("Cover and promotional images for this visual novel"),
	lengthMinutes: nullableIntSchema.describe(
		"Approximate time to complete this visual novel in minutes",
	),
});


export type VisualNovelProperties = z.infer<typeof visualNovelPropertiesSchema>;
