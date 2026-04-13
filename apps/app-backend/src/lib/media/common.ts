import { z } from "@hono/zod-openapi";
import {
	nullableBooleanSchema,
	nullableIntSchema,
	nullableNumberSchema,
	nullableStringSchema,
	remoteImagesAssetsSchema,
	stringArraySchema,
} from "../zod";

export const mediaPropertiesSchema = z
	.object({
		genres: stringArraySchema,
		isNsfw: nullableBooleanSchema,
		publishYear: nullableIntSchema,
		sourceUrl: nullableStringSchema,
		assets: remoteImagesAssetsSchema,
		description: nullableStringSchema,
		providerRating: nullableNumberSchema,
		productionStatus: nullableStringSchema,
	})
	.strict();

export const animeMangaPropertiesSchema = mediaPropertiesSchema.extend({});

export const freeCreatorSchema = z
	.object({ role: z.string(), name: z.string() })
	.strict();
