import { z } from "zod";
import { ImageSchema } from "~/lib/db/schema";
import { dataSchema, unknownObjectSchema } from "~/lib/openapi";
import {
	filterExpressionSchema,
	gridConfigSchema,
	listConfigSchema,
	sortDefinitionSchema,
	tableConfigSchema,
} from "../saved-views/schemas";

const paginationSchema = z.object({
	limit: z.number().int().min(1),
	offset: z.number().int().min(0),
});

const executeViewRuntimeGridBody = z.object({
	page: paginationSchema,
	sort: sortDefinitionSchema,
	layout: z.literal("grid"),
	displayConfiguration: gridConfigSchema,
	entitySchemaSlugs: z.array(z.string()),
	filters: z.array(filterExpressionSchema),
});

const executeViewRuntimeListBody = z.object({
	page: paginationSchema,
	sort: sortDefinitionSchema,
	layout: z.literal("list"),
	displayConfiguration: listConfigSchema,
	entitySchemaSlugs: z.array(z.string()),
	filters: z.array(filterExpressionSchema),
});

const executeViewRuntimeTableBody = z.object({
	page: paginationSchema,
	sort: sortDefinitionSchema,
	layout: z.literal("table"),
	displayConfiguration: tableConfigSchema,
	entitySchemaSlugs: z.array(z.string()),
	filters: z.array(filterExpressionSchema),
});

const viewRuntimeItemSchema = z.object({
	id: z.string(),
	name: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	entitySchemaId: z.string(),
	entitySchemaSlug: z.string(),
	image: ImageSchema.nullable(),
	resolvedProperties: unknownObjectSchema,
});

const viewRuntimePaginationSchema = z.object({
	total: z.number().int(),
	limit: z.number().int(),
	offset: z.number().int(),
	hasNextPage: z.boolean(),
	hasPreviousPage: z.boolean(),
	totalPages: z.number().int(),
	currentPage: z.number().int(),
});

export const executeViewRuntimeBody = z.discriminatedUnion("layout", [
	executeViewRuntimeGridBody,
	executeViewRuntimeListBody,
	executeViewRuntimeTableBody,
]);

export const executeViewRuntimeResponseSchema = dataSchema(
	z.object({
		items: z.array(viewRuntimeItemSchema),
		meta: z.object({ pagination: viewRuntimePaginationSchema }),
	}),
);

export type ViewRuntimeRequest = z.infer<typeof executeViewRuntimeBody>;
export type ViewRuntimeResponse = z.infer<
	typeof executeViewRuntimeResponseSchema
>["data"];
