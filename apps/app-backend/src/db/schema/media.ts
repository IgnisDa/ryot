import { z } from "zod";
import {
	nullableBooleanSchema,
	nullableIntSchema,
	nullableNumberSchema,
	nullableStringSchema,
	remoteImagesAssetsSchema,
	stringArraySchema,
} from "../../lib/zod";

export const mediaPropertiesSchema = z
	.object({
		genres: stringArraySchema,
		publish_year: nullableIntSchema,
		assets: remoteImagesAssetsSchema,
		description: nullableStringSchema,
	})
	.strict();

export const animeMangaPropertiesSchema = mediaPropertiesSchema.extend({
	is_nsfw: nullableBooleanSchema,
	provider_rating: nullableNumberSchema,
	production_status: nullableStringSchema,
});
