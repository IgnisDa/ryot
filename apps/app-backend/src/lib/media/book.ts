import { toAppSchemaProperties } from "@ryot/ts-utils";
import { nullableBooleanSchema, nullableIntSchema } from "../zod";
import { mediaWithFreeCreatorsPropertiesSchema } from "./common";

export const bookPropertiesSchema =
	mediaWithFreeCreatorsPropertiesSchema.extend({
		pages: nullableIntSchema,
		isCompilation: nullableBooleanSchema,
	});

export const bookPropertiesJsonSchema =
	toAppSchemaProperties(bookPropertiesSchema);
