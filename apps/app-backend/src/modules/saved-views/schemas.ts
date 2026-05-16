import { z } from "@hono/zod-openapi";
import { zodBoolAsString } from "@ryot/ts-utils";

import { itemDataSchema, listDataSchema } from "~/lib/openapi";
import {
	computedFieldArraySchema,
	nullableViewExpressionSchema,
	nullableViewPredicateSchema,
	viewExpressionSchema,
	viewPredicateSchema,
} from "~/lib/views/expression";
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

const joinKeySchema = nonEmptyTrimmedStringSchema.regex(
	/^[A-Za-z_][A-Za-z0-9_]*$/,
	"Join keys must start with a letter or underscore and contain only letters, numbers, and underscores",
);

const createEntityCardDisplayConfigSchema = () =>
	z.object({
		imageProperty: nullableViewExpressionSchema,
		titleProperty: nullableViewExpressionSchema,
		calloutProperty: nullableViewExpressionSchema,
		primarySubtitleProperty: nullableViewExpressionSchema,
		secondarySubtitleProperty: nullableViewExpressionSchema,
	});

export const sortDefinitionSchema = z
	.object({
		expression: viewExpressionSchema,
		direction: z.enum(["asc", "desc"]),
	})
	.strict();

export const latestEventJoinDefinitionSchema = z
	.object({
		key: joinKeySchema,
		kind: z.literal("latestEvent"),
		eventSchemaSlug: nonEmptyTrimmedStringSchema,
	})
	.strict();

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

export type LatestRelationshipJoinDefinition = z.infer<
	typeof latestRelationshipJoinDefinitionSchema
>;
export type RelationshipJoinDefinition = z.infer<typeof relationshipJoinDefinitionSchema>;

export const gridConfigSchema = createEntityCardDisplayConfigSchema();

export const listConfigSchema = createEntityCardDisplayConfigSchema();

export const tableColumnSchema = z.object({
	expression: viewExpressionSchema,
	label: nonEmptyTrimmedStringSchema,
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

export const latestRelationshipJoinDefinitionSchema = z
	.object({
		key: joinKeySchema,
		sourceEntityId: z.string().optional(),
		targetEntityId: z.string().optional(),
		kind: z.literal("latestRelationship"),
		filter: nullableViewPredicateSchema.optional(),
		direction: z.enum(["outgoing", "incoming"]),
		relationshipSchemaSlug: nonEmptyTrimmedStringSchema,
		required: z.boolean().optional().default(false),
	})
	.strict();

export const relationshipJoinDefinitionSchema = z.discriminatedUnion("kind", [
	latestRelationshipJoinDefinitionSchema,
]);

export const relationshipJoinDefinitionArraySchema = z
	.array(relationshipJoinDefinitionSchema)
	.refine(
		(joins) => new Set(joins.map((join) => join.key)).size === joins.length,
		"Relationship join keys must be unique",
	)
	.default([]);

export const timeSeriesMetricSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("count") }).strict(),
	z.object({ type: z.literal("sum"), expression: viewExpressionSchema }).strict(),
]);

export const aggregateExpressionSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("count") }).strict(),
	z.object({ type: z.literal("sum"), expression: viewExpressionSchema }).strict(),
	z.object({ type: z.literal("avg"), expression: viewExpressionSchema }).strict(),
	z.object({ type: z.literal("min"), expression: viewExpressionSchema }).strict(),
	z.object({ type: z.literal("max"), expression: viewExpressionSchema }).strict(),
	z.object({ type: z.literal("countBy"), groupBy: viewExpressionSchema }).strict(),
	z.object({ predicate: viewPredicateSchema, type: z.literal("countWhere") }).strict(),
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
		filter: nullableViewPredicateSchema.default(null),
		relationshipJoins: relationshipJoinDefinitionArraySchema,
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

export type AggregationField = z.infer<typeof aggregationFieldSchema>;
export type TimeSeriesMetric = z.infer<typeof timeSeriesMetricSchema>;
export type AggregateExpression = z.infer<typeof aggregateExpressionSchema>;
export type SavedViewQueryDefinition = z.infer<typeof savedViewQueryDefinitionSchema>;
export type StoredSavedViewQueryDefinition = z.infer<typeof storedSavedViewQueryDefinitionSchema>;

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
