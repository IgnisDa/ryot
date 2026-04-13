import { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils";
import {
	nullableStringSchema,
	remoteImagesAssetsSchema,
	stringArraySchema,
} from "../zod";

export const personPropertiesSchema = z
	.object({
		gender: nullableStringSchema,
		website: nullableStringSchema,
		sourceUrl: nullableStringSchema,
		birthDate: nullableStringSchema,
		deathDate: nullableStringSchema,
		assets: remoteImagesAssetsSchema,
		birthPlace: nullableStringSchema,
		description: nullableStringSchema,
		alternateNames: stringArraySchema,
	})
	.strict();

export const personPropertiesJsonSchema = toAppSchemaProperties(
	personPropertiesSchema,
);

export type PersonProperties = z.infer<typeof personPropertiesSchema>;
