import { z } from "@hono/zod-openapi";
import { zodBoolAsString } from "@ryot/ts-utils";

import { itemDataSchema, listDataSchema } from "~/lib/openapi";
import {
	computedFieldArraySchema,
	nullableViewExpressionSchema,
	viewExpressionSchema,
} from "~/lib/views/expression";
import { nullableViewPredicateSchema, viewPredicateSchema } from "~/lib/views/filtering";
import {
	createIdParamsSchema,
	createNonEmptyStringArraySchema,
	createUniqueNonEmptyTrimmedStringArraySchema,
	iconAndAccentColorFields,
	nonEmptyTrimmedStringSchema,
	sortOrderSchema,
	timestampFields,
} from "~/lib/zod";

const storedSavedViewScopeSchema = z.array(nonEmptyTrimmedStringSchema);

const scopeSchema = createNonEmptyStringArraySchema("At least one entity schema slug is required");

const eventJoinKeySchema = nonEmptyTrimmedStringSchema.regex(
	/^[A-Za-z_][A-Za-z0-9_]*$/,
	"Event join keys must start with a letter or underscore and contain only letters, numbers, and underscores",
);

const createEntityCardDisplayConfigSchema = () =>
	z.object({
		imageProperty: nullableViewExpressionSchema,
		titleProperty: nullableViewExpressionSchema,
		calloutProperty: nullableViewExpressionSchema,
		primarySubtitleProperty: nullableViewExpressionSchema,
		secondarySubtitleProperty: nullableViewExpressionSchema,
	});

export const sortDefinitionSchema = z.object({
	expression: viewExpressionSchema,
	direction: z.enum(["asc", "desc"]),
});

export const latestEventJoinDefinitionSchema = z.object({
	key: eventJoinKeySchema,
	kind: z.literal("latestEvent"),
	eventSchemaSlug: nonEmptyTrimmedStringSchema,
});

export const eventJoinDefinitionSchema = z.discriminatedUnion("kind", [
	latestEventJoinDefinitionSchema,
]);

export const eventJoinDefinitionArraySchema = z
	.array(eventJoinDefinitionSchema)
	.refine(
		(joins) => new Set(joins.map((join) => join.key)).size === joins.length,
		"Event join keys must be unique",
	)
	.default([]);

export type GridConfig = z.infer<typeof gridConfigSchema>;
export type ListConfig = z.infer<typeof listConfigSchema>;

export type TableConfig = z.infer<typeof tableConfigSchema>;
export type SortDefinition = z.infer<typeof sortDefinitionSchema>;
export type EventJoinDefinition = z.infer<typeof eventJoinDefinitionSchema>;
export type LatestEventJoinDefinition = z.infer<typeof latestEventJoinDefinitionSchema>;

export const gridConfigSchema = createEntityCardDisplayConfigSchema();

export const listConfigSchema = createEntityCardDisplayConfigSchema();

export const tableColumnSchema = z.object({
	label: nonEmptyTrimmedStringSchema,
	expression: viewExpressionSchema,
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

const relationshipFilterSchema = z.object({
	relationshipSchemaSlug: nonEmptyTrimmedStringSchema,
});

export const relationshipFilterArraySchema = z.array(relationshipFilterSchema).default([]);

export const timeSeriesMetricSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("count") }).strict(),
	z.object({ type: z.literal("sum"), expression: viewExpressionSchema }).strict(),
]);

export const aggregateExpressionSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("count") }).strict(),
	z.object({ predicate: viewPredicateSchema, type: z.literal("countWhere") }).strict(),
	z.object({ type: z.literal("sum"), expression: viewExpressionSchema }).strict(),
	z.object({ type: z.literal("avg"), expression: viewExpressionSchema }).strict(),
	z.object({ type: z.literal("min"), expression: viewExpressionSchema }).strict(),
	z.object({ type: z.literal("max"), expression: viewExpressionSchema }).strict(),
	z.object({ type: z.literal("countBy"), groupBy: viewExpressionSchema }).strict(),
]);

export const aggregationFieldSchema = z
	.object({
		key: nonEmptyTrimmedStringSchema,
		aggregation: aggregateExpressionSchema,
	})
	.strict();

export const aggregationFieldArraySchema = z
	.array(aggregationFieldSchema)
	.refine(
		(fields) => new Set(fields.map((field) => field.key)).size === fields.length,
		"Aggregation keys must be unique",
	)
	.min(1, "At least one aggregation is required");

const createSavedViewQueryDefinitionBaseSchema = (scope: typeof storedSavedViewScopeSchema) =>
	z.object({
		scope,
		computedFields: computedFieldArraySchema,
		eventJoins: eventJoinDefinitionArraySchema,
		relationships: relationshipFilterArraySchema,
		filter: nullableViewPredicateSchema.default(null),
	});

const createEntitySavedViewQueryDefinitionSchema = (scope: typeof storedSavedViewScopeSchema) =>
	createSavedViewQueryDefinitionBaseSchema(scope)
		.extend({ sort: sortDefinitionSchema, mode: z.literal("entities") })
		.strict();

const createLegacyEntitySavedViewQueryDefinitionSchema = (
	scope: typeof storedSavedViewScopeSchema,
) =>
	createSavedViewQueryDefinitionBaseSchema(scope)
		.extend({ sort: sortDefinitionSchema })
		.strict()
		.transform((definition) => ({ ...definition, mode: "entities" as const }));

export const entitySavedViewQueryDefinitionSchema =
	createEntitySavedViewQueryDefinitionSchema(scopeSchema);

export const savedViewQueryDefinitionSchema = z.union([
	entitySavedViewQueryDefinitionSchema,
	createLegacyEntitySavedViewQueryDefinitionSchema(scopeSchema),
]);

export const storedEntitySavedViewQueryDefinitionSchema =
	createEntitySavedViewQueryDefinitionSchema(storedSavedViewScopeSchema);

export const storedSavedViewQueryDefinitionSchema = z.union([
	storedEntitySavedViewQueryDefinitionSchema,
	createLegacyEntitySavedViewQueryDefinitionSchema(storedSavedViewScopeSchema),
]);

export type SavedViewQueryDefinition = z.infer<typeof savedViewQueryDefinitionSchema>;
export type AggregateExpression = z.infer<typeof aggregateExpressionSchema>;
export type AggregationField = z.infer<typeof aggregationFieldSchema>;
export type TimeSeriesMetric = z.infer<typeof timeSeriesMetricSchema>;

export const listedSavedViewSchema = z.object({
	id: z.string(),
	slug: z.string(),
	name: z.string(),
	...timestampFields,
	isBuiltin: z.boolean(),
	isDisabled: z.boolean(),
	sortOrder: sortOrderSchema,
	...iconAndAccentColorFields,
	trackerId: z.string().nullable(),
	queryDefinition: savedViewQueryDefinitionSchema,
	displayConfiguration: displayConfigurationSchema,
});

export const listSavedViewsResponseSchema = listDataSchema(listedSavedViewSchema);

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

export const savedViewResponseSchema = itemDataSchema(listedSavedViewSchema);

export const savedViewParams = createIdParamsSchema("viewSlug");

export const updateSavedViewBody = z.object({
	isDisabled: z.boolean(),
	...savedViewMutableFields,
});

export const reorderSavedViewsBody = z.object({
	trackerId: nonEmptyTrimmedStringSchema.optional(),
	viewSlugs: createUniqueNonEmptyTrimmedStringArraySchema({
		duplicateMessage: "Saved view slugs must be unique",
	}),
});

export const reorderSavedViewsResponseSchema = itemDataSchema(
	z.object({ viewSlugs: z.array(z.string()) }),
);

export type ListedSavedView = z.infer<typeof listedSavedViewSchema>;
export type CreateSavedViewBody = z.infer<typeof createSavedViewBody>;
export type UpdateSavedViewBody = z.infer<typeof updateSavedViewBody>;
export type ReorderSavedViewsBody = z.infer<typeof reorderSavedViewsBody>;
export type RelationshipFilter = z.infer<typeof relationshipFilterSchema>;
