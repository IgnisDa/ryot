import { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils";
import { nullableIntSchema, nullableStringSchema } from "../zod/base";
import { freeCreatorSchema, mediaPropertiesSchema } from "./common";

const podcastEpisodeSchema = z
	.object({
		id: z.string(),
		title: z.string(),
		publishDate: z.string(),
		number: z.number().int(),
		runtime: nullableIntSchema,
		overview: nullableStringSchema,
		thumbnail: nullableStringSchema,
	})
	.strict();

export const podcastPropertiesSchema = mediaPropertiesSchema.extend({
	totalEpisodes: nullableIntSchema,
	episodes: z.array(podcastEpisodeSchema),
	freeCreators: z.array(freeCreatorSchema),
});

export const podcastPropertiesJsonSchema = toAppSchemaProperties(
	podcastPropertiesSchema,
);

export type PodcastProperties = z.infer<typeof podcastPropertiesSchema>;
