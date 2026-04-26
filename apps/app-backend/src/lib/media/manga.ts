import { toAppSchemaProperties } from "@ryot/ts-utils";
import { imagesSchema, nullableIntSchema, nullableNumberSchema } from "../zod";
import { mediaPropertiesSchema } from "./common";

export const mangaPropertiesSchema = mediaPropertiesSchema.extend({
	images: imagesSchema,
	volumes: nullableIntSchema,
	chapters: nullableNumberSchema,
});

export const mangaPropertiesJsonSchema = toAppSchemaProperties(
	mangaPropertiesSchema,
);
