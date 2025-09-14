import { z } from "@hono/zod-openapi";
import { dataSchema } from "~/lib/openapi";
import {
	computedFieldArraySchema,
	viewExpressionSchema,
} from "~/lib/views/expression";
import { nullableViewPredicateSchema } from "~/lib/views/filtering";
import { ImageSchema, timestampFields } from "~/lib/zod";
import {
	eventJoinDefinitionArraySchema,
	relationshipFilterArraySchema,
	sortDefinitionSchema,
} from "../saved-views/schemas";

const paginationSchema = z.object({
	page: z.number().int().min(1),
	limit: z.number().int().min(1),
});

export const queryEngineFieldSchema = z
	.object({
		expression: viewExpressionSchema,
		key: z.string().trim().min(1, "Field keys are required"),
	})
	.strict();

export const queryEngineRequestSchema = z
	.object({
		sort: sortDefinitionSchema,
		pagination: paginationSchema,
		computedFields: computedFieldArraySchema,
		eventJoins: eventJoinDefinitionArraySchema,
		relationships: relationshipFilterArraySchema,
		filter: nullableViewPredicateSchema.default(null),
		entitySchemaSlugs: z
			.array(z.string())
			.min(1, "At least one entity schema slug is required"),
		fields: z
			.array(queryEngineFieldSchema)
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

const resolvedQueryEngineFieldSchema = resolvedDisplayValueSchema
	.extend({ key: z.string() })
	.strict();

const queryEngineBaseItemSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		...timestampFields,
		image: ImageSchema.nullable(),
		externalId: z.string().nullable(),
		sandboxScriptId: z.string().nullable(),
	})
	.strict();

const queryEngineItemSchema = queryEngineBaseItemSchema
	.extend({
		fields: z.array(resolvedQueryEngineFieldSchema),
	})
	.strict();

const queryEnginePaginationSchema = z.object({
	page: z.number().int(),
	total: z.number().int(),
	limit: z.number().int(),
	hasNextPage: z.boolean(),
	totalPages: z.number().int(),
	hasPreviousPage: z.boolean(),
});

const executeQueryEngineResponseDataSchema = z
	.object({
		items: z.array(queryEngineItemSchema),
		meta: z.object({ pagination: queryEnginePaginationSchema }).strict(),
	})
	.strict();

export const executeQueryEngineResponseSchema = dataSchema(
	executeQueryEngineResponseDataSchema,
);

export type QueryEngineItem = z.infer<typeof queryEngineItemSchema>;
export type QueryEngineField = z.infer<typeof queryEngineFieldSchema>;
export type QueryEngineRequest = z.infer<typeof queryEngineRequestSchema>;
export type ResolvedDisplayValue = z.infer<typeof resolvedDisplayValueSchema>;
export type QueryEngineResponse = z.infer<
	typeof executeQueryEngineResponseSchema
>["data"];
export type QueryEngineResponseData = z.infer<
	typeof executeQueryEngineResponseDataSchema
>;
export type QueryEngineResolvedField = z.infer<
	typeof resolvedQueryEngineFieldSchema
>;
