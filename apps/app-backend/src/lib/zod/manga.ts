import {
	nullableIntSchema,
	nullableNumberSchema,
	nullableStringSchema,
	toStableJsonSchema,
} from "./base";
import { animeMangaPropertiesSchema } from "./media";

export const mangaPropertiesSchema = animeMangaPropertiesSchema.extend({
	url: nullableStringSchema,
	volumes: nullableIntSchema,
	chapters: nullableNumberSchema,
});

export const mangaPropertiesJsonSchema = toStableJsonSchema(
	mangaPropertiesSchema,
);
