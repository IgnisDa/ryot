import { toAppSchemaProperties } from "@ryot/ts-utils";

import { imagesSchema, nullableBooleanSchema, nullableIntSchema } from "../zod";
import { mediaWithUnlinkedCreatorsPropertiesSchema } from "./common";

export const bookPropertiesSchema = mediaWithUnlinkedCreatorsPropertiesSchema.extend({
	images: imagesSchema.describe("Cover and related images for this book"),
	pages: nullableIntSchema.describe("Total number of pages in this edition"),
	isCompilation: nullableBooleanSchema.describe(
		"Whether this is an anthology or compilation of multiple works",
	),
});

export const bookPropertiesJsonSchema = toAppSchemaProperties(bookPropertiesSchema);
