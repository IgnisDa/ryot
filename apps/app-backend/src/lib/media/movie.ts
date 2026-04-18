import { toAppSchemaProperties } from "@ryot/ts-utils";
import { nullableIntSchema, remoteImagesAssetsSchema } from "../zod";
import { mediaWithFreeCreatorsPropertiesSchema } from "./common";

export const moviePropertiesSchema =
	mediaWithFreeCreatorsPropertiesSchema.extend({
		assets: remoteImagesAssetsSchema,
		runtime: nullableIntSchema,
	});

export const moviePropertiesJsonSchema = toAppSchemaProperties(
	moviePropertiesSchema,
);
