import { z } from "zod";
import { ImageSchema } from "~/lib/db/schema";
import { dataSchema } from "~/lib/openapi";
import {
	filterExpressionSchema,
	gridConfigSchema,
	listConfigSchema,
	sortDefinitionSchema,
	tableConfigSchema,
} from "../saved-views/schemas";

const paginationSchema = z.object({
	page: z.number().int().min(1),
	limit: z.number().int().min(1),
});

const executeViewRuntimeBaseBody = z.object({
	sort: sortDefinitionSchema,
	pagination: paginationSchema,
	filters: z.array(filterExpressionSchema),
	entitySchemaSlugs: z
		.array(z.string())
		.min(1, "At least one entity schema slug is required"),
});

const executeViewRuntimeGridBody = executeViewRuntimeBaseBody.extend({
	layout: z.literal("grid"),
	displayConfiguration: gridConfigSchema,
});

const executeViewRuntimeListBody = executeViewRuntimeBaseBody.extend({
	layout: z.literal("list"),
	displayConfiguration: listConfigSchema,
});

const executeViewRuntimeTableBody = executeViewRuntimeBaseBody.extend({
	layout: z.literal("table"),
	displayConfiguration: tableConfigSchema,
});

export const resolvedDisplayValueKindSchema = z.enum([
	"json",
	"null",
	"date",
	"text",
	"image",
	"number",
	"boolean",
]);

export const resolvedDisplayValueSchema = z
	.object({
		value: z.unknown().nullable(),
		kind: resolvedDisplayValueKindSchema,
	})
	.strict();

const semanticResolvedPropertiesSchema = z
	.object({
		badgeProperty: resolvedDisplayValueSchema,
		imageProperty: resolvedDisplayValueSchema,
		titleProperty: resolvedDisplayValueSchema,
		subtitleProperty: resolvedDisplayValueSchema,
	})
	.strict();

const viewRuntimeBaseItemSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		createdAt: z.date(),
		updatedAt: z.date(),
		entitySchemaId: z.string(),
		entitySchemaSlug: z.string(),
		image: ImageSchema.nullable(),
	})
	.strict();

const viewRuntimeSemanticItemSchema = viewRuntimeBaseItemSchema
	.extend({
		resolvedProperties: semanticResolvedPropertiesSchema,
	})
	.strict();

const viewRuntimeTableCellSchema = z
	.object({
		key: z.string(),
		value: z.unknown().nullable(),
		kind: resolvedDisplayValueKindSchema,
	})
	.strict();

const viewRuntimeTableItemSchema = viewRuntimeBaseItemSchema
	.extend({
		cells: z.array(viewRuntimeTableCellSchema),
	})
	.strict();

const viewRuntimePaginationSchema = z.object({
	page: z.number().int(),
	total: z.number().int(),
	limit: z.number().int(),
	hasNextPage: z.boolean(),
	hasPreviousPage: z.boolean(),
	totalPages: z.number().int(),
});

const viewRuntimeTableMetaSchema = z
	.object({
		columns: z.array(z.object({ key: z.string(), label: z.string() }).strict()),
	})
	.strict();

const executeViewRuntimeSemanticResponseDataSchema = z
	.object({
		items: z.array(viewRuntimeSemanticItemSchema),
		meta: z.object({ pagination: viewRuntimePaginationSchema }).strict(),
	})
	.strict();

const executeViewRuntimeTableResponseDataSchema = z
	.object({
		items: z.array(viewRuntimeTableItemSchema),
		meta: z
			.object({
				pagination: viewRuntimePaginationSchema,
				table: viewRuntimeTableMetaSchema,
			})
			.strict(),
	})
	.strict();

export const executeViewRuntimeBody = z.discriminatedUnion("layout", [
	executeViewRuntimeGridBody,
	executeViewRuntimeListBody,
	executeViewRuntimeTableBody,
]);

export const executeViewRuntimeResponseSchema = dataSchema(
	z.union([
		executeViewRuntimeSemanticResponseDataSchema,
		executeViewRuntimeTableResponseDataSchema,
	]),
);

export type ViewRuntimeRequest = z.infer<typeof executeViewRuntimeBody>;
export type ResolvedDisplayValue = z.infer<typeof resolvedDisplayValueSchema>;
export type ViewRuntimeSemanticItem = z.infer<
	typeof viewRuntimeSemanticItemSchema
>;
export type ViewRuntimeTableItem = z.infer<typeof viewRuntimeTableItemSchema>;
export type ViewRuntimeSemanticResponse = z.infer<
	typeof executeViewRuntimeSemanticResponseDataSchema
>;
export type ViewRuntimeTableResponse = z.infer<
	typeof executeViewRuntimeTableResponseDataSchema
>;
export type ViewRuntimeTableMeta = z.infer<typeof viewRuntimeTableMetaSchema>;
export type ViewRuntimeResponse = z.infer<
	typeof executeViewRuntimeResponseSchema
>["data"];
