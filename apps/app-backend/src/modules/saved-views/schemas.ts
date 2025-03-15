import { zodBoolAsString } from "@ryot/ts-utils";
import { z } from "zod";
import { dataSchema } from "~/lib/openapi";
import {
	applicationIconNameSchema,
	nonEmptyTrimmedStringSchema,
} from "~/lib/zod/base";

const filterExpressionIsNullSchema = z.object({
	value: z.null().optional(),
	op: z.literal("isNull"),
	field: z.array(z.string()).min(1, "Filter field is required"),
});

const filterExpressionInSchema = z.object({
	op: z.literal("in"),
	value: z.array(z.unknown()),
	field: z.array(z.string()).min(1, "Filter field is required"),
});

const filterExpressionComparisonSchema = z.object({
	value: z.unknown(),
	op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte"]),
	field: z.array(z.string()).min(1, "Filter field is required"),
});

export const filterExpressionSchema = z.discriminatedUnion("op", [
	filterExpressionInSchema,
	filterExpressionIsNullSchema,
	filterExpressionComparisonSchema,
]);

export type FilterExpression = z.infer<typeof filterExpressionSchema>;

export const sortDefinitionSchema = z.object({
	direction: z.enum(["asc", "desc"]),
	field: z.array(z.string()).min(1, "Sort field is required"),
});

export type GridConfig = z.infer<typeof gridConfigSchema>;
export type ListConfig = z.infer<typeof listConfigSchema>;
export type TableConfig = z.infer<typeof tableConfigSchema>;
export type SortDefinition = z.infer<typeof sortDefinitionSchema>;

export const gridConfigSchema = z.object({
	imageProperty: z.array(z.string()).nullable(),
	titleProperty: z.array(z.string()).nullable(),
	badgeProperty: z.array(z.string()).nullable(),
	subtitleProperty: z.array(z.string()).nullable(),
});

export const listConfigSchema = z.object({
	imageProperty: z.array(z.string()).nullable(),
	titleProperty: z.array(z.string()).nullable(),
	badgeProperty: z.array(z.string()).nullable(),
	subtitleProperty: z.array(z.string()).nullable(),
});

export const tableColumnSchema = z.object({
	property: z.array(z.string()),
});

export const tableConfigSchema = z.object({
	columns: z.array(tableColumnSchema),
});

export const displayConfigurationSchema = z.object({
	grid: gridConfigSchema,
	list: listConfigSchema,
	table: tableConfigSchema,
});

export type DisplayConfiguration = z.infer<typeof displayConfigurationSchema>;

export const savedViewQueryDefinitionSchema = z.object({
	sort: sortDefinitionSchema,
	filters: z.array(filterExpressionSchema),
	entitySchemaSlugs: z
		.array(z.string())
		.min(1, "At least one entity schema slug is required"),
});

export type SavedViewQueryDefinition = z.infer<
	typeof savedViewQueryDefinitionSchema
>;

export const listedSavedViewSchema = z.object({
	id: z.string(),
	name: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	isBuiltin: z.boolean(),
	isDisabled: z.boolean(),
	icon: applicationIconNameSchema,
	trackerId: z.string().nullable(),
	accentColor: nonEmptyTrimmedStringSchema,
	sortOrder: z.number().int().nonnegative(),
	queryDefinition: savedViewQueryDefinitionSchema,
	displayConfiguration: displayConfigurationSchema,
});

export const listSavedViewsResponseSchema = dataSchema(
	z.array(listedSavedViewSchema),
);

export const listSavedViewsQuery = z.object({
	trackerId: nonEmptyTrimmedStringSchema.optional(),
	includeDisabled: zodBoolAsString.optional().default(false),
});

export const createSavedViewBody = z.object({
	icon: applicationIconNameSchema,
	name: nonEmptyTrimmedStringSchema,
	accentColor: nonEmptyTrimmedStringSchema,
	queryDefinition: savedViewQueryDefinitionSchema,
	displayConfiguration: displayConfigurationSchema,
	trackerId: nonEmptyTrimmedStringSchema.optional(),
});

export const createSavedViewResponseSchema = dataSchema(listedSavedViewSchema);

export const savedViewParams = z.object({
	viewId: nonEmptyTrimmedStringSchema,
});

export const deleteSavedViewParams = savedViewParams;

export const updateSavedViewBody = z.object({
	isDisabled: z.boolean(),
	icon: applicationIconNameSchema,
	name: nonEmptyTrimmedStringSchema,
	accentColor: nonEmptyTrimmedStringSchema,
	queryDefinition: savedViewQueryDefinitionSchema,
	displayConfiguration: displayConfigurationSchema,
	trackerId: nonEmptyTrimmedStringSchema.optional(),
});

export const updateSavedViewResponseSchema = dataSchema(listedSavedViewSchema);

export const reorderSavedViewsBody = z
	.object({
		trackerId: nonEmptyTrimmedStringSchema.optional(),
		viewIds: z.array(nonEmptyTrimmedStringSchema).min(1),
	})
	.superRefine((value, ctx) => {
		const uniqueViewIds = new Set(value.viewIds);
		if (uniqueViewIds.size === value.viewIds.length) {
			return;
		}

		ctx.addIssue({
			path: ["viewIds"],
			code: z.ZodIssueCode.custom,
			message: "Saved view ids must be unique",
		});
	});

export const reorderSavedViewsResponseSchema = dataSchema(
	z.object({ viewIds: z.array(z.string()) }),
);

export type ListedSavedView = z.infer<typeof listedSavedViewSchema>;
export type CreateSavedViewBody = z.infer<typeof createSavedViewBody>;
export type UpdateSavedViewBody = z.infer<typeof updateSavedViewBody>;
export type ReorderSavedViewsBody = z.infer<typeof reorderSavedViewsBody>;
