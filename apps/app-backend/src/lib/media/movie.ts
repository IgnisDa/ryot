import type { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils/app-schema";

import { imagesSchema, nullableIntSchema } from "../zod";
import { mediaPropertiesSchema } from "./common";

export const moviePropertiesSchema = mediaPropertiesSchema.extend({
	runtime: nullableIntSchema.describe("Runtime in minutes"),
	images: imagesSchema.describe("Cover and promotional images for this movie"),
});

export const moviePropertiesJsonSchema = toAppSchemaProperties(moviePropertiesSchema);

export type MovieProperties = z.infer<typeof moviePropertiesSchema>;
