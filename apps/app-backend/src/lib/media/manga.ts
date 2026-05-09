import { toAppSchemaProperties } from "@ryot/ts-utils";

import { imagesSchema, nullableIntSchema, nullableNumberSchema } from "../zod";
import { mediaPropertiesSchema } from "./common";

export const mangaPropertiesSchema = mediaPropertiesSchema.extend({
	images: imagesSchema.describe("Cover and promotional images for this manga"),
	volumes: nullableIntSchema.describe("Total number of volumes, if known"),
	chapters: nullableNumberSchema.describe("Total number of chapters, if known"),
});

export const mangaPropertiesJsonSchema = toAppSchemaProperties(mangaPropertiesSchema);
