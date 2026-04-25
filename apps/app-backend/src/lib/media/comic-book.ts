import { toAppSchemaProperties } from "@ryot/ts-utils";
import { nullableIntSchema, remoteImagesAssetsSchema } from "../zod";
import { mediaPropertiesSchema } from "./common";

export const comicBookPropertiesSchema = mediaPropertiesSchema.extend({
	assets: remoteImagesAssetsSchema,
	pages: nullableIntSchema,
});

export const comicBookPropertiesJsonSchema = toAppSchemaProperties(
	comicBookPropertiesSchema,
);
