import { z } from "@hono/zod-openapi";
import { ImageSchema } from "~/lib/db/schema";
import {
	builtinMediaEntitySchemaSlugs,
	builtinMediaEventSchemaSlugs,
} from "~/lib/media/constants";
import { itemDataSchema } from "~/lib/openapi";
import {
	nullableIntSchema,
	nullableNumberSchema,
	nullableStringSchema,
} from "~/lib/zod";

const builtinMediaEntitySchemaSlugSchema = z.enum(
	builtinMediaEntitySchemaSlugs,
);

const builtinMediaEventSchemaSlugSchema = z.enum(builtinMediaEventSchemaSlugs);

const builtInMediaOverviewSubtitleSchema = z
	.object({ raw: nullableIntSchema, label: nullableStringSchema })
	.strict();

const builtInMediaOverviewBaseItemSchema = z
	.object({
		id: z.string(),
		title: z.string(),
		image: ImageSchema.nullable(),
		subtitle: builtInMediaOverviewSubtitleSchema,
		entitySchemaSlug: builtinMediaEntitySchemaSlugSchema,
	})
	.strict();

const builtInMediaOverviewContinueItemSchema =
	builtInMediaOverviewBaseItemSchema
		.extend({
			progressAt: z.date(),
			labels: z.object({ cta: z.string(), progress: z.string() }).strict(),
			progress: z
				.object({
					totalUnits: nullableNumberSchema,
					currentUnits: nullableNumberSchema,
					progressPercent: nullableNumberSchema,
				})
				.strict(),
		})
		.strict();

const builtInMediaOverviewUpNextItemSchema = builtInMediaOverviewBaseItemSchema
	.extend({
		backlogAt: z.date(),
		labels: z.object({ cta: z.literal("Start") }).strict(),
	})
	.strict();

const builtInMediaOverviewRateTheseItemSchema =
	builtInMediaOverviewBaseItemSchema
		.extend({
			completedAt: z.date(),
			reviewAt: z.date().nullable(),
			rating: z.number().int().nullable(),
		})
		.strict();

const builtInMediaOverviewRecentActivityItemSchema = z
	.object({
		id: z.string(),
		entityId: z.string(),
		occurredAt: z.date(),
		rating: z.number().int().nullable(),
		eventSchemaSlug: builtinMediaEventSchemaSlugSchema,
		entity: z
			.object({
				name: z.string(),
				image: ImageSchema.nullable(),
				entitySchemaSlug: builtinMediaEntitySchemaSlugSchema,
			})
			.strict(),
	})
	.strict();

const builtInMediaOverviewWeekActivityItemSchema = z
	.object({
		dayLabel: z.string(),
		count: z.number().int().nonnegative(),
	})
	.strict();

const builtInMediaOverviewLibraryItemSchema = z
	.object({
		avgRating: z.number().nullable(),
		total: z.number().int().nonnegative(),
		inBacklog: z.number().int().nonnegative(),
		completed: z.number().int().nonnegative(),
		inProgress: z.number().int().nonnegative(),
		entityTypeCounts: z.record(
			builtinMediaEntitySchemaSlugSchema,
			z.number().int().nonnegative(),
		),
	})
	.strict();

const createOverviewSectionSchema = <TItem extends z.ZodTypeAny>(item: TItem) =>
	z
		.object({ items: z.array(item), count: z.number().int().nonnegative() })
		.strict();

const builtInMediaOverviewUpNextSectionSchema = createOverviewSectionSchema(
	builtInMediaOverviewUpNextItemSchema,
);

const builtInMediaOverviewContinueSectionSchema = createOverviewSectionSchema(
	builtInMediaOverviewContinueItemSchema,
);

const builtInMediaOverviewRateTheseSectionSchema = createOverviewSectionSchema(
	builtInMediaOverviewRateTheseItemSchema,
);

const builtInMediaOverviewRecentActivitySectionSchema =
	createOverviewSectionSchema(builtInMediaOverviewRecentActivityItemSchema);

const builtInMediaOverviewWeekActivitySectionSchema =
	createOverviewSectionSchema(builtInMediaOverviewWeekActivityItemSchema);

const builtInMediaOverviewDataSchema = z
	.object({
		upNext: builtInMediaOverviewUpNextSectionSchema,
		continue: builtInMediaOverviewContinueSectionSchema,
		rateThese: builtInMediaOverviewRateTheseSectionSchema,
	})
	.strict();

export const builtInMediaOverviewUpNextResponseSchema = itemDataSchema(
	builtInMediaOverviewUpNextSectionSchema,
);

export const builtInMediaOverviewContinueResponseSchema = itemDataSchema(
	builtInMediaOverviewContinueSectionSchema,
);

export const builtInMediaOverviewRateTheseResponseSchema = itemDataSchema(
	builtInMediaOverviewRateTheseSectionSchema,
);

export const builtInMediaOverviewRecentActivityResponseSchema = itemDataSchema(
	builtInMediaOverviewRecentActivitySectionSchema,
);

export const builtInMediaOverviewWeekActivityResponseSchema = itemDataSchema(
	builtInMediaOverviewWeekActivitySectionSchema,
);

export const builtInMediaOverviewLibraryResponseSchema = itemDataSchema(
	builtInMediaOverviewLibraryItemSchema,
);

export const builtInMediaOverviewResponseSchema = itemDataSchema(
	builtInMediaOverviewDataSchema,
);

export type BuiltInMediaOverviewUpNextResponse = z.infer<
	typeof builtInMediaOverviewUpNextSectionSchema
>;

export type BuiltInMediaOverviewContinueResponse = z.infer<
	typeof builtInMediaOverviewContinueSectionSchema
>;

export type BuiltInMediaOverviewRateTheseResponse = z.infer<
	typeof builtInMediaOverviewRateTheseSectionSchema
>;

export type BuiltInMediaOverviewRecentActivityResponse = z.infer<
	typeof builtInMediaOverviewRecentActivitySectionSchema
>;

export type BuiltInMediaOverviewWeekActivityResponse = z.infer<
	typeof builtInMediaOverviewWeekActivitySectionSchema
>;

export type BuiltInMediaOverviewLibraryResponse = z.infer<
	typeof builtInMediaOverviewLibraryItemSchema
>;

export type BuiltInMediaOverviewResponse = z.infer<
	typeof builtInMediaOverviewDataSchema
>;
