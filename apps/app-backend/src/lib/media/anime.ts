import { toAppSchemaProperties } from "@ryot/ts-utils";
import { z } from "zod";
import { nullableIntSchema } from "../zod/base";
import { animeMangaPropertiesSchema } from "./common";

const animeAiringScheduleSpecificsSchema = z
	.object({
		episode: z.number().int(),
		airingAt: z.iso.datetime(),
	})
	.strict();

export const animePropertiesSchema = animeMangaPropertiesSchema.extend({
	episodes: nullableIntSchema,
	airingSchedule: z.array(animeAiringScheduleSpecificsSchema).nullish(),
});

export const animePropertiesJsonSchema = toAppSchemaProperties(
	animePropertiesSchema,
);
