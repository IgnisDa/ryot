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
		publishYear: nullableIntSchema.describe("Year this media was first published or released"),
		isNsfw: nullableBooleanSchema.describe(
			"Whether this media contains adult or not-safe-for-work content",
		),
		publishDate: nullableStringSchema.describe(
			"Exact date this media was first published or released, as an ISO 8601 date string (YYYY-MM-DD)",
		),
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

export const unlinkedCreatorSchema = z
	.object({
		role: z.string().describe("Role this creator held in the production"),
		name: z.string().describe("Full name of the creator"),
	})
	.strict();

export const mediaWithUnlinkedCreatorsPropertiesSchema = mediaPropertiesSchema.extend({
	unlinkedCreators: z.array(unlinkedCreatorSchema),
});

export type MediaProperties = z.infer<typeof mediaPropertiesSchema>;

export type MediaWithUnlinkedCreatorsProperties = z.infer<
	typeof mediaWithUnlinkedCreatorsPropertiesSchema
>;

export type UnlinkedCreator = z.infer<typeof unlinkedCreatorSchema>;

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
