import { toAppSchemaProperties } from "@ryot/ts-utils";

import { imagesSchema, nullableIntSchema } from "../zod";
import { mediaPropertiesSchema } from "./common";

export const comicBookPropertiesSchema = mediaPropertiesSchema.extend({
	images: imagesSchema.describe("Cover and promotional images for this comic book"),
	pages: nullableIntSchema.describe("Total number of pages in this issue or volume"),
});

export const comicBookPropertiesJsonSchema = toAppSchemaProperties(comicBookPropertiesSchema);
