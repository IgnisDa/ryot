import { toAppSchemaProperties } from "@ryot/ts-utils";
import { nullableIntSchema, remoteImagesAssetsSchema } from "../zod";
import { mediaWithFreeCreatorsPropertiesSchema } from "./common";

export const audiobookPropertiesSchema =
	mediaWithFreeCreatorsPropertiesSchema.extend({
		assets: remoteImagesAssetsSchema,
		runtime: nullableIntSchema,
	});

export const audiobookPropertiesJsonSchema = toAppSchemaProperties(
	audiobookPropertiesSchema,
);
