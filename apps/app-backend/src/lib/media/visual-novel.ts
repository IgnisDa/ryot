import type { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils";
import { nullableIntSchema, remoteImagesAssetsSchema } from "../zod";
import { mediaPropertiesSchema } from "./common";

export const visualNovelPropertiesSchema = mediaPropertiesSchema.extend({
	assets: remoteImagesAssetsSchema,
	lengthMinutes: nullableIntSchema,
});

export const visualNovelPropertiesJsonSchema = toAppSchemaProperties(
	visualNovelPropertiesSchema,
);

export type VisualNovelProperties = z.infer<typeof visualNovelPropertiesSchema>;
