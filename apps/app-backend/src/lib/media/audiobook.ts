import { toAppSchemaProperties } from "@ryot/ts-utils";
import { imagesSchema, nullableIntSchema } from "../zod";
import { mediaWithFreeCreatorsPropertiesSchema } from "./common";

export const audiobookPropertiesSchema =
	mediaWithFreeCreatorsPropertiesSchema.extend({
		images: imagesSchema,
		runtime: nullableIntSchema,
	});

export const audiobookPropertiesJsonSchema = toAppSchemaProperties(
	audiobookPropertiesSchema,
);
