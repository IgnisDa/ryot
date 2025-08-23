import { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils/app-schema";

import { imagesSchema, nullableIntSchema, nullableStringSchema } from "../zod";
import { mediaPropertiesSchema } from "./common";

// All fields in minutes
const videoGameTimeToBeatSchema = z
	.object({
		normally: nullableIntSchema.describe("Estimated minutes for a typical playthrough"),
		hastily: nullableIntSchema.describe("Estimated minutes to rush through the main story"),
		completely: nullableIntSchema.describe("Estimated minutes for a full 100% completion run"),
	})
	.strict()
	.nullish();

const videoGamePlatformReleaseSchema = z
	.object({
		name: z.string().describe("Platform name"),
		releaseDate: nullableStringSchema.describe("Release date on this platform"),
		releaseRegion: nullableStringSchema.describe("Geographic region of this release"),
	})
	.strict();

export const videoGamePropertiesSchema = mediaPropertiesSchema.extend({
	images: imagesSchema.describe("Cover and promotional images for this video game"),
	timeToBeat: videoGameTimeToBeatSchema.describe(
		"Estimated time to complete the game at different paces",
	),
	platformReleases: z
		.array(videoGamePlatformReleaseSchema)
		.nullish()
		.describe("Platform-specific release information"),
});

export const videoGamePropertiesJsonSchema = toAppSchemaProperties(videoGamePropertiesSchema);

export type VideoGameTimeToBeat = z.infer<typeof videoGameTimeToBeatSchema>;

export type VideoGamePlatformRelease = z.infer<typeof videoGamePlatformReleaseSchema>;

export type VideoGameProperties = z.infer<typeof videoGamePropertiesSchema>;
