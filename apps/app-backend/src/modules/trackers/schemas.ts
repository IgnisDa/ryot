import { zodBoolAsString } from "@ryot/ts-utils";
import { z } from "zod";
import { dataSchema } from "~/lib/openapi";
import {
	createIdParamsSchema,
	createNameWithOptionalSlugSchema,
	createUniqueNonEmptyTrimmedStringArraySchema,
	iconAndAccentColorFields,
	nonEmptyTrimmedStringSchema,
	nullableStringSchema,
	optionalIconAndAccentColorFields,
} from "~/lib/zod/base";

export const listedTrackerSchema = z.object({
	id: z.string(),
	slug: z.string(),
	name: z.string(),
	config: z.unknown(),
	isBuiltin: z.boolean(),
	isDisabled: z.boolean(),
	description: nullableStringSchema,
	sortOrder: z.number().int().nonnegative(),
	...iconAndAccentColorFields,
});

export const createTrackerResponseSchema = dataSchema(listedTrackerSchema);
export const listTrackersResponseSchema = dataSchema(
	z.array(listedTrackerSchema),
);

export const listTrackersQuery = z.object({
	includeDisabled: zodBoolAsString.optional().default(false),
});

export const createTrackerBody = createNameWithOptionalSlugSchema({
	description: nonEmptyTrimmedStringSchema.optional(),
	...iconAndAccentColorFields,
});

const nullableTextInputSchema = z
	.union([nonEmptyTrimmedStringSchema, z.null()])
	.optional();

export const updateTrackerBody = z
	.object({
		isDisabled: z.boolean(),
		description: nullableTextInputSchema,
		name: nonEmptyTrimmedStringSchema.optional(),
		...optionalIconAndAccentColorFields,
	})
	.superRefine((value, ctx) => {
		const hasConfigUpdate =
			value.icon !== undefined ||
			value.name !== undefined ||
			value.description !== undefined ||
			value.accentColor !== undefined;

		if (!hasConfigUpdate) {
			return;
		}

		if (value.icon === undefined) {
			ctx.addIssue({
				path: ["icon"],
				code: z.ZodIssueCode.custom,
				message: "Icon is required",
			});
		}

		if (value.accentColor === undefined) {
			ctx.addIssue({
				path: ["accentColor"],
				code: z.ZodIssueCode.custom,
				message: "Accent color is required",
			});
		}
	});

export const reorderTrackersBody = z.object({
	trackerIds: createUniqueNonEmptyTrimmedStringArraySchema({
		duplicateMessage: "Tracker ids must be unique",
	}),
});

export const reorderTrackersResponseSchema = dataSchema(
	z.object({ trackerIds: z.array(z.string()) }),
);

export const trackerParams = createIdParamsSchema("trackerId");

export type ListedTracker = z.infer<typeof listedTrackerSchema>;
export type CreateTrackerBody = z.infer<typeof createTrackerBody>;
export type UpdateTrackerBody = z.infer<typeof updateTrackerBody>;
export type ReorderTrackersBody = z.infer<typeof reorderTrackersBody>;
