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
		sourceUrl: nullableStringSchema,
		assets: remoteImagesAssetsSchema,
		description: nullableStringSchema,
		providerRating: nullableNumberSchema,
		productionStatus: nullableStringSchema,
	})
	.strict();

export const animeMangaPropertiesSchema = mediaPropertiesSchema.extend({});
