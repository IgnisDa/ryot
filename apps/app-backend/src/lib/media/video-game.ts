import { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils";
import { nullableIntSchema, nullableStringSchema } from "../zod/base";
import { mediaPropertiesSchema } from "./common";

// All fields in minutes. Reserved for providers that expose time-to-beat data
// (e.g., IGDB). GiantBomb does not provide this.
const videoGameTimeToBeatSchema = z
	.object({
		hastily: nullableIntSchema,
		normally: nullableIntSchema,
		completely: nullableIntSchema,
	})
	.strict()
	.nullish();

// releaseDate and releaseRegion are reserved for providers that expose
// per-platform release details (e.g., IGDB). GiantBomb only provides platform
// names; those fields will be null for GiantBomb-sourced entities.
const videoGamePlatformReleaseSchema = z
	.object({
		name: z.string(),
		releaseDate: nullableStringSchema,
		releaseRegion: nullableStringSchema,
	})
	.strict();

export const videoGamePropertiesSchema = mediaPropertiesSchema.extend({
	timeToBeat: videoGameTimeToBeatSchema,
	platformReleases: z.array(videoGamePlatformReleaseSchema).nullish(),
});

export const videoGamePropertiesJsonSchema = toAppSchemaProperties(
	videoGamePropertiesSchema,
);

export type VideoGameProperties = z.infer<typeof videoGamePropertiesSchema>;
