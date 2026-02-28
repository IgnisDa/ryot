import { z } from "zod";
import { nullableIntSchema, toStableJsonSchema } from "./base";
import { animeMangaPropertiesSchema } from "./media";

const animeAiringScheduleSpecificsSchema = z
	.object({
		episode: z.number().int(),
		airing_at: z.string().datetime(),
	})
	.strict();

export const animePropertiesSchema = animeMangaPropertiesSchema.extend({
	episodes: nullableIntSchema,
	airing_schedule: z.array(animeAiringScheduleSpecificsSchema).nullable(),
});

export const animePropertiesJsonSchema = toStableJsonSchema(
	animePropertiesSchema,
);
