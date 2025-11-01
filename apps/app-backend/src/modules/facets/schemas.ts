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

const nullableTextInputSchema = z
	.union([nonEmptyTrimmedStringSchema, z.null()])
	.optional();

export const updateFacetBody = z
	.object({
		icon: nullableTextInputSchema,
		description: nullableTextInputSchema,
		accentColor: nullableTextInputSchema,
		name: nonEmptyTrimmedStringSchema.optional(),
		slug: nonEmptyTrimmedStringSchema.optional(),
	})
	.refine((value) => Object.keys(value).length > 0, {
		message: "At least one field must be provided",
	});

export const reorderFacetsBody = z
	.object({
		facetIds: z.array(nonEmptyTrimmedStringSchema).min(1),
	})
	.superRefine((value, ctx) => {
		const uniqueFacetIds = new Set(value.facetIds);
		if (uniqueFacetIds.size === value.facetIds.length) return;

		ctx.addIssue({
			path: ["facetIds"],
			code: z.ZodIssueCode.custom,
			message: "Facet ids must be unique",
		});
	});

export const reorderFacetsResponseSchema = dataSchema(
	z.object({ facetIds: z.array(z.string()) }),
);

export const facetParams = z.object({
	facetId: nonEmptyTrimmedStringSchema,
});

export type CreateFacetBody = z.infer<typeof createFacetBody>;
export type UpdateFacetBody = z.infer<typeof updateFacetBody>;
export type ReorderFacetsBody = z.infer<typeof reorderFacetsBody>;
