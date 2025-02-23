import { z } from "zod";
import { FacetMode } from "~/db/schema";
import { dataSchema } from "~/lib/openapi";
import {
	nonEmptyTrimmedStringSchema,
	nullableStringSchema,
} from "~/lib/zod/base";

const facetModeSchema = z.enum([FacetMode.curated, FacetMode.generated]);

export const listedFacetSchema = z.object({
	id: z.string(),
	slug: z.string(),
	name: z.string(),
	config: z.unknown(),
	enabled: z.boolean(),
	mode: facetModeSchema,
	isBuiltin: z.boolean(),
	icon: nullableStringSchema,
	accentColor: nullableStringSchema,
	description: nullableStringSchema,
	sortOrder: z.number().int().nonnegative(),
});

export const listFacetsResponseSchema = dataSchema(z.array(listedFacetSchema));
export const createFacetResponseSchema = dataSchema(listedFacetSchema);

export const facetMutationResponseSchema = dataSchema(
	z.object({
		facetId: z.string(),
		enabled: z.boolean(),
	}),
);

export const createFacetBody = z.object({
	name: nonEmptyTrimmedStringSchema,
	slug: nonEmptyTrimmedStringSchema.optional(),
	icon: nonEmptyTrimmedStringSchema.optional(),
	description: nonEmptyTrimmedStringSchema.optional(),
	accentColor: nonEmptyTrimmedStringSchema.optional(),
});

export const facetParams = z.object({
	facetId: nonEmptyTrimmedStringSchema,
});

export type CreateFacetBody = z.infer<typeof createFacetBody>;
