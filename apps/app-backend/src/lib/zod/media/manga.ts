import {
	nullableIntSchema,
	nullableNumberSchema,
	toStableJsonSchema,
} from "../base";
import { animeMangaPropertiesSchema } from "./common";

export const mangaPropertiesSchema = animeMangaPropertiesSchema.extend({
	volumes: nullableIntSchema,
	chapters: nullableNumberSchema,
});

export const mangaPropertiesJsonSchema = toStableJsonSchema(
	mangaPropertiesSchema,
);
