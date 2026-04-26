import { toAppSchemaProperties } from "@ryot/ts-utils";
import {
	nullableIntSchema,
	nullableNumberSchema,
	remoteImagesAssetsSchema,
} from "../zod";
import { mediaPropertiesSchema } from "./common";

export const mangaPropertiesSchema = mediaPropertiesSchema.extend({
	assets: remoteImagesAssetsSchema,
	volumes: nullableIntSchema,
	chapters: nullableNumberSchema,
});

export const mangaPropertiesJsonSchema = toAppSchemaProperties(
	mangaPropertiesSchema,
);
