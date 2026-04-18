import { toAppSchemaProperties } from "@ryot/ts-utils";
import { imagesSchema, nullableIntSchema } from "../zod";
import { mediaPropertiesSchema } from "./common";

export const comicBookPropertiesSchema = mediaPropertiesSchema.extend({
	images: imagesSchema,
	pages: nullableIntSchema,
});

export const comicBookPropertiesJsonSchema = toAppSchemaProperties(
	comicBookPropertiesSchema,
);
