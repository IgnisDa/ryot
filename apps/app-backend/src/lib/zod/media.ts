import { z } from "zod";
import {
	nullableBooleanSchema,
	nullableIntSchema,
	nullableNumberSchema,
	nullableStringSchema,
	remoteImagesAssetsSchema,
	stringArraySchema,
} from "./base";

export const mediaPropertiesSchema = z
	.object({
		genres: stringArraySchema,
		isNsfw: nullableBooleanSchema,
		publish_year: nullableIntSchema,
		assets: remoteImagesAssetsSchema,
		description: nullableStringSchema,
		sourceUrl: nullableStringSchema.optional(),
	})
	.strict();

export const animeMangaPropertiesSchema = mediaPropertiesSchema.extend({
	provider_rating: nullableNumberSchema,
	production_status: nullableStringSchema,
});
