import { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils";

import { imagesSchema, nullableIntSchema, nullableStringSchema } from "../zod";
import { mediaPropertiesSchema } from "./common";

// All fields in minutes. Reserved for providers that expose time-to-beat data
// (e.g., IGDB). GiantBomb does not provide this.
const videoGameTimeToBeatSchema = z
	.object({
		hastily: nullableIntSchema.describe("Estimated minutes to rush through the main story"),
		normally: nullableIntSchema.describe("Estimated minutes for a typical playthrough"),
		completely: nullableIntSchema.describe("Estimated minutes for a full 100% completion run"),
	})
	.strict()
	.nullish();

// releaseDate and releaseRegion are reserved for providers that expose
// per-platform release details (e.g., IGDB). GiantBomb only provides platform
// names; those fields will be null for GiantBomb-sourced entities.
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

export type VideoGameProperties = z.infer<typeof videoGamePropertiesSchema>;
