import { z } from "@hono/zod-openapi";
import { zodBoolAsString } from "@ryot/ts-utils";
import { itemDataSchema, listDataSchema } from "~/lib/openapi";
import {
	computedFieldArraySchema,
	viewExpressionSchema,
} from "~/lib/views/expression";
import { viewPredicateSchema } from "~/lib/views/filtering";
import {
	createIdParamsSchema,
	createNonEmptyStringArraySchema,
	createUniqueNonEmptyTrimmedStringArraySchema,
	iconAndAccentColorFields,
	nonEmptyTrimmedStringSchema,
	sortOrderSchema,
	timestampFields,
} from "~/lib/zod/base";

const entitySchemaSlugArraySchema = createNonEmptyStringArraySchema(
	"At least one entity schema slug is required",
);

const eventJoinKeySchema = nonEmptyTrimmedStringSchema.regex(
	/^[A-Za-z_][A-Za-z0-9_]*$/,
	"Event join keys must start with a letter or underscore and contain only letters, numbers, and underscores",
);

const displayExpressionSchema = viewExpressionSchema.nullable();

const createEntityCardDisplayConfigSchema = () =>
	z.object({
		imageProperty: displayExpressionSchema,
		titleProperty: displayExpressionSchema,
		badgeProperty: displayExpressionSchema,
		subtitleProperty: displayExpressionSchema,
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
export type LatestEventJoinDefinition = z.infer<
	typeof latestEventJoinDefinitionSchema
>;

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

export const savedViewQueryDefinitionSchema = z.object({
	sort: sortDefinitionSchema,
	computedFields: computedFieldArraySchema,
	eventJoins: eventJoinDefinitionArraySchema,
	entitySchemaSlugs: entitySchemaSlugArraySchema,
	filter: viewPredicateSchema.nullable().default(null),
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
