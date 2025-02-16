import { z } from "zod";
import { FacetMode } from "~/lib/db/schema";
import { dataSchema } from "~/lib/openapi";
import {
	createNameWithOptionalSlugSchema,
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
	icon: nonEmptyTrimmedStringSchema,
	accentColor: nullableStringSchema,
	description: nullableStringSchema,
	sortOrder: z.number().int().nonnegative(),
});

export const createFacetResponseSchema = dataSchema(listedFacetSchema);
export const listFacetsResponseSchema = dataSchema(z.array(listedFacetSchema));

export const createFacetBody = createNameWithOptionalSlugSchema({
	icon: nonEmptyTrimmedStringSchema,
	description: nonEmptyTrimmedStringSchema.optional(),
	accentColor: nonEmptyTrimmedStringSchema.optional(),
});

const nullableTextInputSchema = z
	.union([nonEmptyTrimmedStringSchema, z.null()])
	.optional();

export const updateFacetBody = z
	.object({
		enabled: z.boolean().optional(),
		description: nullableTextInputSchema,
		accentColor: nullableTextInputSchema,
		icon: nonEmptyTrimmedStringSchema.optional(),
		name: nonEmptyTrimmedStringSchema.optional(),
		slug: nonEmptyTrimmedStringSchema.optional(),
	})
	.superRefine((value, ctx) => {
		if (Object.keys(value).length === 0) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "At least one field must be provided",
			});
			return;
		}

		const hasConfigUpdate =
			value.icon !== undefined ||
			value.name !== undefined ||
			value.slug !== undefined ||
			value.description !== undefined ||
			value.accentColor !== undefined;

		if (!hasConfigUpdate || value.icon !== undefined) return;

		ctx.addIssue({
			path: ["icon"],
			code: z.ZodIssueCode.custom,
			message: "Icon is required",
		});
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
