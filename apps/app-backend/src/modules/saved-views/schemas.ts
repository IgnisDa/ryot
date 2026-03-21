import { z } from "zod";
import { dataSchema } from "~/lib/openapi";
import {
	applicationIconNameSchema,
	nonEmptyTrimmedStringSchema,
} from "~/lib/zod/base";

const filterExpressionIsNullSchema = z.object({
	value: z.null().optional(),
	op: z.literal("isNull"),
	field: z.array(z.string()),
});

const filterExpressionInSchema = z.object({
	op: z.literal("in"),
	field: z.array(z.string()),
	value: z.array(z.unknown()),
});

const filterExpressionComparisonSchema = z.object({
	value: z.unknown(),
	field: z.array(z.string()),
	op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte"]),
});

export const filterExpressionSchema = z.discriminatedUnion("op", [
	filterExpressionInSchema,
	filterExpressionIsNullSchema,
	filterExpressionComparisonSchema,
]);

export type FilterExpression = z.infer<typeof filterExpressionSchema>;

export const sortDefinitionSchema = z.object({
	field: z.array(z.string()),
	direction: z.enum(["asc", "desc"]),
});

export type SortDefinition = z.infer<typeof sortDefinitionSchema>;

const gridConfigSchema = z.object({
	imageProperty: z.array(z.string()).nullable(),
	titleProperty: z.array(z.string()).nullable(),
	badgeProperty: z.array(z.string()).nullable(),
	subtitleProperty: z.array(z.string()).nullable(),
});

const listConfigSchema = z.object({
	imageProperty: z.array(z.string()).nullable(),
	titleProperty: z.array(z.string()).nullable(),
	badgeProperty: z.array(z.string()).nullable(),
	subtitleProperty: z.array(z.string()).nullable(),
});

const tableColumnSchema = z.object({
	property: z.array(z.string()),
});

const tableConfigSchema = z.object({
	columns: z.array(tableColumnSchema),
});

export const displayConfigurationSchema = z.object({
	grid: gridConfigSchema,
	list: listConfigSchema,
	table: tableConfigSchema,
	layout: z.enum(["grid", "list", "table"]),
});

export type DisplayConfiguration = z.infer<typeof displayConfigurationSchema>;

export const savedViewQueryDefinitionSchema = z.object({
	sort: sortDefinitionSchema,
	entitySchemaSlugs: z.array(z.string()),
	filters: z.array(filterExpressionSchema),
});

export type SavedViewQueryDefinition = z.infer<
	typeof savedViewQueryDefinitionSchema
>;

export const listedSavedViewSchema = z.object({
	id: z.string(),
	name: z.string(),
	isBuiltin: z.boolean(),
	icon: applicationIconNameSchema,
	trackerId: z.string().nullable(),
	accentColor: nonEmptyTrimmedStringSchema,
	queryDefinition: savedViewQueryDefinitionSchema,
	displayConfiguration: displayConfigurationSchema,
});

export const listSavedViewsResponseSchema = dataSchema(
	z.array(listedSavedViewSchema),
);

export const listSavedViewsQuery = z.object({
	trackerId: nonEmptyTrimmedStringSchema.optional(),
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

export type ListedSavedView = z.infer<typeof listedSavedViewSchema>;
export type CreateSavedViewBody = z.infer<typeof createSavedViewBody>;
