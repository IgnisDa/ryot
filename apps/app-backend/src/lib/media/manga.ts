import { toAppSchemaProperties } from "@ryot/ts-utils";
import { nullableIntSchema, nullableNumberSchema } from "../zod";
import { mediaPropertiesSchema } from "./common";

export const mangaPropertiesSchema = mediaPropertiesSchema.extend({
	volumes: nullableIntSchema,
	chapters: nullableNumberSchema,
});

export const mangaPropertiesJsonSchema = toAppSchemaProperties(
	mangaPropertiesSchema,
);
