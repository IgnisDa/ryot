import { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils";
import {
	nullableIntSchema,
	nullableStringSchema,
	remoteImagesAssetsSchema,
	stringArraySchema,
} from "../zod";
import { mediaWithFreeCreatorsPropertiesSchema } from "./common";

const showEpisodeSchema = z
	.object({
		name: z.string(),
		id: z.number().int(),
		runtime: nullableIntSchema,
		overview: nullableStringSchema,
		episodeNumber: z.number().int(),
		posterImages: stringArraySchema,
		publishDate: nullableStringSchema,
	})
	.strict();

const showSeasonSchema = z
	.object({
		name: z.string(),
		id: z.number().int(),
		overview: nullableStringSchema,
		seasonNumber: z.number().int(),
		posterImages: stringArraySchema,
		publishDate: nullableStringSchema,
		backdropImages: stringArraySchema,
		episodes: z.array(showEpisodeSchema),
	})
	.strict();

export const showPropertiesSchema =
	mediaWithFreeCreatorsPropertiesSchema.extend({
		assets: remoteImagesAssetsSchema,
		showSeasons: z.array(showSeasonSchema),
	});

export const showPropertiesJsonSchema =
	toAppSchemaProperties(showPropertiesSchema);
