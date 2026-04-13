import { toAppSchemaProperties } from "@ryot/ts-utils";
import { nullableIntSchema } from "../zod";
import { mediaWithFreeCreatorsPropertiesSchema } from "./common";

export const moviePropertiesSchema =
	mediaWithFreeCreatorsPropertiesSchema.extend({
		runtime: nullableIntSchema,
	});

export const moviePropertiesJsonSchema = toAppSchemaProperties(
	moviePropertiesSchema,
);
