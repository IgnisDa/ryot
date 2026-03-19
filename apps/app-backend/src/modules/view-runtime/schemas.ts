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
	page: z.number().int().min(1),
	limit: z.number().int().min(1),
});

const executeViewRuntimeGridBody = z.object({
	sort: sortDefinitionSchema,
	pagination: paginationSchema,
	layout: z.literal("grid"),
	displayConfiguration: gridConfigSchema,
	filters: z.array(filterExpressionSchema),
	entitySchemaSlugs: z
		.array(z.string())
		.min(1, "At least one entity schema slug is required"),
});

const executeViewRuntimeListBody = z.object({
	sort: sortDefinitionSchema,
	pagination: paginationSchema,
	layout: z.literal("list"),
	displayConfiguration: listConfigSchema,
	filters: z.array(filterExpressionSchema),
	entitySchemaSlugs: z
		.array(z.string())
		.min(1, "At least one entity schema slug is required"),
});

const executeViewRuntimeTableBody = z.object({
	sort: sortDefinitionSchema,
	pagination: paginationSchema,
	layout: z.literal("table"),
	displayConfiguration: tableConfigSchema,
	filters: z.array(filterExpressionSchema),
	entitySchemaSlugs: z
		.array(z.string())
		.min(1, "At least one entity schema slug is required"),
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
	page: z.number().int(),
	total: z.number().int(),
	limit: z.number().int(),
	hasNextPage: z.boolean(),
	hasPreviousPage: z.boolean(),
	totalPages: z.number().int(),
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
