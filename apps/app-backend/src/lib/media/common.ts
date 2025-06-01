import { z } from "@hono/zod-openapi";
import {
	nullableBooleanSchema,
	nullableIntSchema,
	nullableNumberSchema,
	nullableStringSchema,
	remoteImagesAssetsSchema,
	stringArraySchema,
} from "../zod";

export const mediaPropertiesSchema = z
	.object({
		genres: stringArraySchema,
		isNsfw: nullableBooleanSchema,
		publishYear: nullableIntSchema,
		sourceUrl: nullableStringSchema,
		assets: remoteImagesAssetsSchema,
		description: nullableStringSchema,
		providerRating: nullableNumberSchema,
		productionStatus: nullableStringSchema,
	})
	.strict();

export const freeCreatorSchema = z
	.object({ role: z.string(), name: z.string() })
	.strict();

export const mediaWithFreeCreatorsPropertiesSchema =
	mediaPropertiesSchema.extend({
		freeCreators: z.array(freeCreatorSchema),
	});

export const personStubSchema = z
	.object({
		role: z.string(),
		name: z.string(),
		scriptSlug: z.string(),
		identifier: z.string(),
		character: z.string().optional(),
		order: z.number().int().optional(),
	})
	.strict();
