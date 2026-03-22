import { zodBoolAsString } from "@ryot/ts-utils";
import { z } from "zod";
import { itemDataSchema, listDataSchema } from "~/lib/openapi";
import {
	createIdParamsSchema,
	createNonEmptyStringArraySchema,
	createUniqueNonEmptyTrimmedStringArraySchema,
	iconAndAccentColorFields,
	nonEmptyTrimmedStringSchema,
	sortOrderSchema,
	timestampFields,
} from "~/lib/zod/base";

const runtimeFieldPathSchema = nonEmptyTrimmedStringSchema;

const sortFieldsSchema = createNonEmptyStringArraySchema(
	"Sort fields are required",
);

const entitySchemaSlugArraySchema = createNonEmptyStringArraySchema(
	"At least one entity schema slug is required",
);

const displayPropertyReferenceSchema = z.array(z.string()).nullable();

const createEntityCardDisplayConfigSchema = () =>
	z.object({
		imageProperty: displayPropertyReferenceSchema,
		titleProperty: displayPropertyReferenceSchema,
		badgeProperty: displayPropertyReferenceSchema,
		subtitleProperty: displayPropertyReferenceSchema,
	});

const filterExpressionIsNullSchema = z.object({
	value: z.null().optional(),
	op: z.literal("isNull"),
	field: runtimeFieldPathSchema,
});

const filterExpressionInSchema = z.object({
	op: z.literal("in"),
	field: runtimeFieldPathSchema,
	value: z.array(z.unknown()),
});

const filterExpressionComparisonSchema = z.object({
	value: z.unknown(),
	field: runtimeFieldPathSchema,
	op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte"]),
});

export const filterExpressionSchema = z.discriminatedUnion("op", [
	filterExpressionInSchema,
	filterExpressionIsNullSchema,
	filterExpressionComparisonSchema,
]);

export type FilterExpression = z.infer<typeof filterExpressionSchema>;

export const sortDefinitionSchema = z.object({
	fields: sortFieldsSchema,
	direction: z.enum(["asc", "desc"]),
});

export type GridConfig = z.infer<typeof gridConfigSchema>;
export type ListConfig = z.infer<typeof listConfigSchema>;
export type TableConfig = z.infer<typeof tableConfigSchema>;
export type SortDefinition = z.infer<typeof sortDefinitionSchema>;

export const gridConfigSchema = createEntityCardDisplayConfigSchema();

export const listConfigSchema = createEntityCardDisplayConfigSchema();

export const tableColumnSchema = z.object({
	label: nonEmptyTrimmedStringSchema,
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
	entitySchemaSlugs: entitySchemaSlugArraySchema,
});

export type SavedViewQueryDefinition = z.infer<
	typeof savedViewQueryDefinitionSchema
>;

export const listedSavedViewSchema = z.object({
	id: z.string(),
	name: z.string(),
	...timestampFields,
	isBuiltin: z.boolean(),
	isDisabled: z.boolean(),
	sortOrder: sortOrderSchema,
	trackerId: z.string().nullable(),
	queryDefinition: savedViewQueryDefinitionSchema,
	displayConfiguration: displayConfigurationSchema,
	...iconAndAccentColorFields,
});

export const listSavedViewsResponseSchema = listDataSchema(
	listedSavedViewSchema,
);

export const listSavedViewsQuery = z.object({
	trackerId: nonEmptyTrimmedStringSchema.optional(),
	includeDisabled: zodBoolAsString.optional().default(false),
});

const savedViewMutableFields = {
	name: nonEmptyTrimmedStringSchema,
	queryDefinition: savedViewQueryDefinitionSchema,
	displayConfiguration: displayConfigurationSchema,
	trackerId: nonEmptyTrimmedStringSchema.optional(),
	...iconAndAccentColorFields,
} satisfies z.ZodRawShape;

export const createSavedViewBody = z.object(savedViewMutableFields);

const savedViewResponseSchema = itemDataSchema(listedSavedViewSchema);

export const createSavedViewResponseSchema = savedViewResponseSchema;

export const savedViewParams = createIdParamsSchema("viewId");

export const deleteSavedViewParams = savedViewParams;

export const updateSavedViewBody = z.object({
	isDisabled: z.boolean(),
	...savedViewMutableFields,
});

export const updateSavedViewResponseSchema = savedViewResponseSchema;

export const reorderSavedViewsBody = z.object({
	trackerId: nonEmptyTrimmedStringSchema.optional(),
	viewIds: createUniqueNonEmptyTrimmedStringArraySchema({
		duplicateMessage: "Saved view ids must be unique",
	}),
});

export const reorderSavedViewsResponseSchema = itemDataSchema(
	z.object({ viewIds: z.array(z.string()) }),
);

export type ListedSavedView = z.infer<typeof listedSavedViewSchema>;
export type CreateSavedViewBody = z.infer<typeof createSavedViewBody>;
export type UpdateSavedViewBody = z.infer<typeof updateSavedViewBody>;
export type ReorderSavedViewsBody = z.infer<typeof reorderSavedViewsBody>;
