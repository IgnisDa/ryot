import type { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils";
import { imagesSchema, nullableBooleanSchema, nullableIntSchema } from "../zod";
import { mediaPropertiesSchema } from "./common";

// duration is in seconds
export const musicPropertiesSchema = mediaPropertiesSchema.extend({
	images: imagesSchema.describe(
		"Cover art and promotional images for this music release",
	),
	duration: nullableIntSchema.describe("Total duration in seconds"),
	byVariousArtists: nullableBooleanSchema.describe(
		"Whether this release features multiple artists rather than a single act",
	),
});

export const musicPropertiesJsonSchema = toAppSchemaProperties(
	musicPropertiesSchema,
);

export type MusicProperties = z.infer<typeof musicPropertiesSchema>;
