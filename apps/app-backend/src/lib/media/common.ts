import { z } from "@hono/zod-openapi";

import {
	nullableBooleanSchema,
	nullableIntSchema,
	nullableNumberSchema,
	nullableStringSchema,
	stringArraySchema,
} from "../zod";

export const mediaPropertiesSchema = z
	.object({
		genres: stringArraySchema.describe("List of genres this media is categorized under"),
		isNsfw: nullableBooleanSchema.describe(
			"Whether this media contains adult or not-safe-for-work content",
		),
		publishYear: nullableIntSchema.describe("Year this media was first published or released"),
		sourceUrl: nullableStringSchema.describe(
			"Link to the original source or external provider page",
		),
		description: nullableStringSchema.describe(
			"Synopsis or overview provided by the data provider",
		),
		providerRating: nullableNumberSchema.describe(
			"Aggregate score from the external data provider",
		),
		productionStatus: nullableStringSchema.describe(
			"Current production status (e.g. Ended, Continuing, Cancelled)",
		),
	})
	.strict();

export const freeCreatorSchema = z
	.object({
		role: z.string().describe("Role this creator held in the production"),
		name: z.string().describe("Full name of the creator"),
	})
	.strict();

export const mediaWithFreeCreatorsPropertiesSchema = mediaPropertiesSchema.extend({
	freeCreators: z.array(freeCreatorSchema),
});

export const personStubSchema = z
	.object({
		role: z.string(),
		name: z.string(),
		scriptSlug: z.string(),
		externalId: z.string(),
		character: z.string().optional(),
		order: z.number().int().optional(),
	})
	.strict();
