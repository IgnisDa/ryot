import { toJSONSchema, z } from "zod";

const animeAiringScheduleSpecificsSchema = z
	.object({
		episode: z.number().int(),
		airing_at: z.string().datetime(),
	})
	.strict();

export const animePropertiesSchema = z
	.object({
		is_nsfw: z.boolean().nullable(),
		description: z.string().nullable(),
		genres: z.array(z.string()),
		episodes: z.number().int().nullable(),
		provider_rating: z.number().nullable(),
		production_status: z.string().nullable(),
		publish_year: z.number().int().nullable(),
		airing_schedule: z.array(animeAiringScheduleSpecificsSchema).nullable(),
		assets: z.object({ remote_images: z.array(z.string()) }).strict(),
	})
	.strict();

export const animePropertiesJsonSchema = JSON.parse(
	JSON.stringify(toJSONSchema(animePropertiesSchema)),
);
