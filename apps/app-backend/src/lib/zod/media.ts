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
		publishYear: nullableIntSchema,
		assets: remoteImagesAssetsSchema,
		description: nullableStringSchema,
		providerRating: nullableNumberSchema,
		productionStatus: nullableStringSchema,
		sourceUrl: nullableStringSchema.optional(),
	})
	.strict();

export const animeMangaPropertiesSchema = mediaPropertiesSchema.extend({});
