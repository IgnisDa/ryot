import { z } from "zod";
import { ImageSchema } from "~/lib/db/schema";
import { dataSchema } from "~/lib/openapi";
import { filterExpressionSchema } from "~/lib/views/filtering";
import { timestampFields } from "~/lib/zod/base";
import {
	eventJoinDefinitionArraySchema,
	sortDefinitionSchema,
} from "../saved-views/schemas";

const paginationSchema = z.object({
	page: z.number().int().min(1),
	limit: z.number().int().min(1),
});

export const viewRuntimeFieldSchema = z
	.object({
		references: z.array(z.string()),
		key: z.string().trim().min(1, "Field keys are required"),
	})
	.strict();

const executeViewRuntimeBaseBody = z
	.object({
		sort: sortDefinitionSchema,
		pagination: paginationSchema,
		eventJoins: eventJoinDefinitionArraySchema,
		filters: z.array(filterExpressionSchema),
		entitySchemaSlugs: z
			.array(z.string())
			.min(1, "At least one entity schema slug is required"),
		fields: z
			.array(viewRuntimeFieldSchema)
			.refine(
				(fields) =>
					new Set(fields.map((field) => field.key)).size === fields.length,
				"Field keys must be unique",
			)
			.default([]),
	})
	.strict();

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

const resolvedRuntimeFieldSchema = resolvedDisplayValueSchema
	.extend({ key: z.string() })
	.strict();

const viewRuntimeBaseItemSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		...timestampFields,
		entitySchemaId: z.string(),
		entitySchemaSlug: z.string(),
		image: ImageSchema.nullable(),
	})
	.strict();

const viewRuntimeItemSchema = viewRuntimeBaseItemSchema
	.extend({
		fields: z.array(resolvedRuntimeFieldSchema),
	})
	.strict();

const viewRuntimePaginationSchema = z.object({
	page: z.number().int(),
	total: z.number().int(),
	limit: z.number().int(),
	hasNextPage: z.boolean(),
	totalPages: z.number().int(),
	hasPreviousPage: z.boolean(),
});

const executeViewRuntimeResponseDataSchema = z
	.object({
		items: z.array(viewRuntimeItemSchema),
		meta: z.object({ pagination: viewRuntimePaginationSchema }).strict(),
	})
	.strict();

export const executeViewRuntimeBody = executeViewRuntimeBaseBody;

export const executeViewRuntimeResponseSchema = dataSchema(
	executeViewRuntimeResponseDataSchema,
);

export type ViewRuntimeItem = z.infer<typeof viewRuntimeItemSchema>;
export type ViewRuntimeField = z.infer<typeof viewRuntimeFieldSchema>;
export type ViewRuntimeRequest = z.infer<typeof executeViewRuntimeBody>;
export type ResolvedDisplayValue = z.infer<typeof resolvedDisplayValueSchema>;
export type ViewRuntimeResponse = z.infer<
	typeof executeViewRuntimeResponseSchema
>["data"];
export type ViewRuntimeResponseData = z.infer<
	typeof executeViewRuntimeResponseDataSchema
>;
export type ViewRuntimeResolvedField = z.infer<
	typeof resolvedRuntimeFieldSchema
>;
