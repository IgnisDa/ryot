import type { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils/app-schema";

import { imagesSchema, nullableBooleanSchema, nullableIntSchema } from "../zod";
import { mediaPropertiesSchema } from "./common";

export const musicPropertiesSchema = mediaPropertiesSchema.extend({
	duration: nullableIntSchema.describe("Total duration in seconds"),
	images: imagesSchema.describe("Cover art and promotional images for this music release"),
	byVariousArtists: nullableBooleanSchema.describe(
		"Whether this release features multiple artists rather than a single act",
	),
});

export const musicPropertiesJsonSchema = toAppSchemaProperties(musicPropertiesSchema);

export type MusicProperties = z.infer<typeof musicPropertiesSchema>;
