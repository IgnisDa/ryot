import { toAppSchemaProperties } from "@ryot/ts-utils";
import { nullableIntSchema, nullableNumberSchema } from "../base";
import { animeMangaPropertiesSchema } from "./common";

export const mangaPropertiesSchema = animeMangaPropertiesSchema.extend({
	volumes: nullableIntSchema,
	chapters: nullableNumberSchema,
});

export const mangaPropertiesJsonSchema = toAppSchemaProperties(
	mangaPropertiesSchema,
);
