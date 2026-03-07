import { z } from "zod";
import { nullableIntSchema, toStableJsonSchema } from "../base";
import { animeMangaPropertiesSchema } from "./common";

const animeAiringScheduleSpecificsSchema = z
	.object({
		episode: z.number().int(),
		airingAt: z.string().datetime(),
	})
	.strict();

export const animePropertiesSchema = animeMangaPropertiesSchema.extend({
	episodes: nullableIntSchema,
	airingSchedule: z.array(animeAiringScheduleSpecificsSchema).nullish(),
});

export const animePropertiesJsonSchema = toStableJsonSchema(
	animePropertiesSchema,
);
