import { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils";

import { imagesSchema, nullableIntSchema } from "../zod";
import { mediaPropertiesSchema } from "./common";

const animeAiringScheduleSpecificsSchema = z
	.object({
		episode: z.number().int().describe("Episode number"),
		airingAt: z.iso.datetime().describe("Scheduled air date and time"),
	})
	.strict();

export const animePropertiesSchema = mediaPropertiesSchema.extend({
	images: imagesSchema.describe("Cover and promotional images for this anime"),
	episodes: nullableIntSchema.describe("Total number of episodes, if known"),
	airingSchedule: z
		.array(animeAiringScheduleSpecificsSchema)
		.nullish()
		.describe("Upcoming episode airing schedule"),
});

export const animePropertiesJsonSchema = toAppSchemaProperties(animePropertiesSchema);
