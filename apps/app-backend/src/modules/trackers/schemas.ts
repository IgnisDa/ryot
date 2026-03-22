import { z } from "zod";
import { dataSchema } from "~/lib/openapi";
import {
	createNameWithOptionalSlugSchema,
	nonEmptyTrimmedStringSchema,
	nullableStringSchema,
} from "~/lib/zod/base";

export const listedTrackerSchema = z.object({
	id: z.string(),
	slug: z.string(),
	name: z.string(),
	config: z.unknown(),
	enabled: z.boolean(),
	isBuiltin: z.boolean(),
	icon: nonEmptyTrimmedStringSchema,
	description: nullableStringSchema,
	accentColor: nonEmptyTrimmedStringSchema,
	sortOrder: z.number().int().nonnegative(),
});

export const createTrackerResponseSchema = dataSchema(listedTrackerSchema);
export const listTrackersResponseSchema = dataSchema(
	z.array(listedTrackerSchema),
);

export const createTrackerBody = createNameWithOptionalSlugSchema({
	icon: nonEmptyTrimmedStringSchema,
	accentColor: nonEmptyTrimmedStringSchema,
	description: nonEmptyTrimmedStringSchema.optional(),
});

const nullableTextInputSchema = z
	.union([nonEmptyTrimmedStringSchema, z.null()])
	.optional();

export const updateTrackerBody = z
	.object({
		enabled: z.boolean().optional(),
		description: nullableTextInputSchema,
		accentColor: nonEmptyTrimmedStringSchema.optional(),
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

		if (!hasConfigUpdate) return;

		if (value.icon === undefined)
			ctx.addIssue({
				path: ["icon"],
				code: z.ZodIssueCode.custom,
				message: "Icon is required",
			});

		if (value.accentColor === undefined)
			ctx.addIssue({
				path: ["accentColor"],
				code: z.ZodIssueCode.custom,
				message: "Accent color is required",
			});
	});

export const reorderTrackersBody = z
	.object({
		trackerIds: z.array(nonEmptyTrimmedStringSchema).min(1),
	})
	.superRefine((value, ctx) => {
		const uniqueTrackerIds = new Set(value.trackerIds);
		if (uniqueTrackerIds.size === value.trackerIds.length) return;

		ctx.addIssue({
			path: ["trackerIds"],
			code: z.ZodIssueCode.custom,
			message: "Tracker ids must be unique",
		});
	});

export const reorderTrackersResponseSchema = dataSchema(
	z.object({ trackerIds: z.array(z.string()) }),
);

export const trackerParams = z.object({
	trackerId: nonEmptyTrimmedStringSchema,
});

export type CreateTrackerBody = z.infer<typeof createTrackerBody>;
export type UpdateTrackerBody = z.infer<typeof updateTrackerBody>;
export type ReorderTrackersBody = z.infer<typeof reorderTrackersBody>;
export type ListedTracker = z.infer<typeof listedTrackerSchema>;
