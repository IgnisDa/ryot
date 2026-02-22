import { toAppSchemaProperties } from "@ryot/ts-utils";

import { imagesSchema, nullableIntSchema } from "../zod";
import { mediaWithFreeCreatorsPropertiesSchema } from "./common";

export const audiobookPropertiesSchema = mediaWithFreeCreatorsPropertiesSchema.extend({
	images: imagesSchema.describe("Cover and promotional images for this audiobook"),
	runtime: nullableIntSchema.describe("Total listening time in minutes"),
});

export const audiobookPropertiesJsonSchema = toAppSchemaProperties(audiobookPropertiesSchema);
