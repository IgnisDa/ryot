import { toAppSchemaProperties } from "@ryot/ts-utils";
import {
	nullableBooleanSchema,
	nullableIntSchema,
	remoteImagesAssetsSchema,
} from "../zod";
import { mediaWithFreeCreatorsPropertiesSchema } from "./common";

export const bookPropertiesSchema =
	mediaWithFreeCreatorsPropertiesSchema.extend({
		assets: remoteImagesAssetsSchema,
		pages: nullableIntSchema,
		isCompilation: nullableBooleanSchema,
	});

export const bookPropertiesJsonSchema =
	toAppSchemaProperties(bookPropertiesSchema);
