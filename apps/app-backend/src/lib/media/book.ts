import { toAppSchemaProperties } from "@ryot/ts-utils";
import { imagesSchema, nullableBooleanSchema, nullableIntSchema } from "../zod";
import { mediaWithFreeCreatorsPropertiesSchema } from "./common";

export const bookPropertiesSchema =
	mediaWithFreeCreatorsPropertiesSchema.extend({
		images: imagesSchema,
		pages: nullableIntSchema,
		isCompilation: nullableBooleanSchema,
	});

export const bookPropertiesJsonSchema =
	toAppSchemaProperties(bookPropertiesSchema);
