import { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils";
import {
	imagesSchema,
	nullableIntSchema,
	nullableStringSchema,
	stringArraySchema,
} from "../zod";
import { mediaWithFreeCreatorsPropertiesSchema } from "./common";

const showEpisodeSchema = z
	.object({
		name: z.string().describe("Episode title"),
		id: z.number().int().describe("Provider-assigned ID for this episode"),
		runtime: nullableIntSchema.describe("Episode runtime in minutes"),
		overview: nullableStringSchema.describe("Episode synopsis or description"),
		episodeNumber: z
			.number()
			.int()
			.describe("Episode number within the season"),
		posterImages: stringArraySchema.describe(
			"Poster image URLs for this episode",
		),
		publishDate: nullableStringSchema.describe(
			"Original air date of this episode",
		),
	})
	.strict();

const showSeasonSchema = z
	.object({
		name: z.string().describe("Season name"),
		id: z.number().int().describe("Provider-assigned ID for this season"),
		overview: nullableStringSchema.describe(
			"Synopsis or overview of this season",
		),
		seasonNumber: z.number().int().describe("Season number"),
		posterImages: stringArraySchema.describe(
			"Poster image URLs for this season",
		),
		publishDate: nullableStringSchema.describe(
			"Original air or release date of this season",
		),
		backdropImages: stringArraySchema.describe(
			"Backdrop image URLs for this season",
		),
		episodes: z
			.array(showEpisodeSchema)
			.describe("List of episodes in this season"),
	})
	.strict();

export const showPropertiesSchema =
	mediaWithFreeCreatorsPropertiesSchema.extend({
		images: imagesSchema.describe("Cover and promotional images for this show"),
		showSeasons: z
			.array(showSeasonSchema)
			.describe("Seasons in this show, each containing episodes"),
	});

export const showPropertiesJsonSchema =
	toAppSchemaProperties(showPropertiesSchema);
