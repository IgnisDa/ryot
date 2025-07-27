import { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils";
import { imagesSchema, nullableIntSchema, nullableStringSchema } from "../zod";
import { mediaWithFreeCreatorsPropertiesSchema } from "./common";

const podcastEpisodeSchema = z
	.object({
		id: z.string().describe("Unique identifier for this episode"),
		title: z.string().describe("Episode title"),
		publishDate: z.string().describe("Date this episode was published"),
		number: z.number().int().describe("Episode number in the feed"),
		runtime: nullableIntSchema.describe("Episode runtime in minutes"),
		overview: nullableStringSchema.describe(
			"Episode description or show notes",
		),
		thumbnail: nullableStringSchema.describe(
			"Thumbnail image URL for this episode",
		),
	})
	.strict();

export const podcastPropertiesSchema =
	mediaWithFreeCreatorsPropertiesSchema.extend({
		images: imagesSchema.describe(
			"Cover and promotional images for this podcast",
		),
		totalEpisodes: nullableIntSchema.describe(
			"Total number of episodes published by this podcast",
		),
		episodes: z
			.array(podcastEpisodeSchema)
			.describe("List of podcast episodes"),
	});

export const podcastPropertiesJsonSchema = toAppSchemaProperties(
	podcastPropertiesSchema,
);

export type PodcastProperties = z.infer<typeof podcastPropertiesSchema>;
