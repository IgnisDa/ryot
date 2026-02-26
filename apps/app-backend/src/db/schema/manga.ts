import { toJSONSchema, z } from "zod";

export const mangaPropertiesSchema = z
	.object({
		url: z.string().nullable(),
		chapters: z.number().nullable(),
		is_nsfw: z.boolean().nullable(),
		description: z.string().nullable(),
		genres: z.array(z.string()),
		volumes: z.number().int().nullable(),
		provider_rating: z.number().nullable(),
		production_status: z.string().nullable(),
		publish_year: z.number().int().nullable(),
		assets: z.object({ remote_images: z.array(z.string()) }).strict(),
	})
	.strict();

export const mangaPropertiesJsonSchema = JSON.parse(
	JSON.stringify(toJSONSchema(mangaPropertiesSchema)),
);
