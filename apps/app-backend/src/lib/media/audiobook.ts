import { toAppSchemaProperties } from "@ryot/ts-utils";
import { nullableIntSchema } from "../zod";
import { mediaWithFreeCreatorsPropertiesSchema } from "./common";

export const audiobookPropertiesSchema =
	mediaWithFreeCreatorsPropertiesSchema.extend({
		runtime: nullableIntSchema,
	});

export const audiobookPropertiesJsonSchema = toAppSchemaProperties(
	audiobookPropertiesSchema,
);
