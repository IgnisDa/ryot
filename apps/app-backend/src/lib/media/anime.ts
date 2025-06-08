import { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils";
import { imagesSchema, nullableIntSchema } from "../zod";
import { mediaPropertiesSchema } from "./common";

const animeAiringScheduleSpecificsSchema = z
	.object({
		episode: z.number().int(),
		airingAt: z.iso.datetime(),
	})
	.strict();

export const animePropertiesSchema = mediaPropertiesSchema.extend({
	images: imagesSchema,
	episodes: nullableIntSchema,
	airingSchedule: z.array(animeAiringScheduleSpecificsSchema).nullish(),
});

export const animePropertiesJsonSchema = toAppSchemaProperties(
	animePropertiesSchema,
);
