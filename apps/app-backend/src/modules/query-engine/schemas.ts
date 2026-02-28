import { z } from "@hono/zod-openapi";

import { dataSchema } from "~/lib/openapi";
import {
	computedFieldArraySchema,
	nullableViewPredicateSchema,
	viewExpressionSchema,
} from "~/lib/views/expression";
import type {
	QueryEngineEventJoinLike,
	QueryEngineReferenceContext,
	QueryEngineSchemaLike,
} from "~/lib/views/reference";

import {
	aggregationFieldArraySchema,
	eventJoinDefinitionArraySchema,
	relationshipFilterArraySchema,
	sortDefinitionSchema,
	timeSeriesMetricSchema,
} from "../saved-views/schemas";

export type QueryEngineContext = QueryEngineReferenceContext<
	QueryEngineSchemaLike,
	QueryEngineEventJoinLike
>;

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

const queryEngineScopeSchema = z
	.array(z.string())
	.min(1, "At least one entity schema slug is required");

const eventSchemasSchema = z.array(z.string()).min(1, "At least one event schema slug is required");

const entityQueryEngineFieldsSchema = z
	.array(queryEngineFieldSchema)
	.refine(
		(fields) => new Set(fields.map((field) => field.key)).size === fields.length,
		"Field keys must be unique",
	)
	.default([]);

const queryEngineRequestBaseSchema = z.object({
	scope: queryEngineScopeSchema,
	computedFields: computedFieldArraySchema,
	eventJoins: eventJoinDefinitionArraySchema,
	relationships: relationshipFilterArraySchema,
	filter: nullableViewPredicateSchema.default(null),
});

export const entityQueryEngineRequestSchema = queryEngineRequestBaseSchema
	.extend({
		sort: sortDefinitionSchema,
		pagination: paginationSchema,
		mode: z.literal("entities"),
		fields: entityQueryEngineFieldsSchema,
	})
	.strict();

export const aggregateQueryEngineRequestSchema = queryEngineRequestBaseSchema
	.extend({
		mode: z.literal("aggregate"),
		aggregations: aggregationFieldArraySchema,
	})
	.strict();

export const eventsQueryEngineRequestSchema = z
	.object({
		sort: sortDefinitionSchema,
		pagination: paginationSchema,
		scope: queryEngineScopeSchema,
		mode: z.literal("events"),
		eventSchemas: eventSchemasSchema,
		fields: entityQueryEngineFieldsSchema,
		computedFields: computedFieldArraySchema,
		eventJoins: eventJoinDefinitionArraySchema,
		filter: nullableViewPredicateSchema.default(null),
	})
	.strict();

export const timeSeriesQueryEngineRequestSchema = z
	.object({
		scope: queryEngineScopeSchema,
		metric: timeSeriesMetricSchema,
		eventSchemas: eventSchemasSchema,
		mode: z.literal("timeSeries"),
		computedFields: computedFieldArraySchema,
		filter: nullableViewPredicateSchema.default(null),
		bucket: z.enum(["day", "hour", "month", "week"]),
		dateRange: z
			.object({
				endAt: z.iso.datetime({ offset: true }),
				startAt: z.iso.datetime({ offset: true }),
			})
			.strict()
			.refine(
				(range) => new Date(range.startAt) < new Date(range.endAt),
				"startAt must be before endAt",
			),
	})
	.strict();

export const queryEngineRequestSchema = z.discriminatedUnion("mode", [
	entityQueryEngineRequestSchema,
	eventsQueryEngineRequestSchema,
	aggregateQueryEngineRequestSchema,
	timeSeriesQueryEngineRequestSchema,
]);

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

const queryEngineItemSchema = z.array(resolvedQueryEngineFieldSchema);

const queryEnginePaginationSchema = z.object({
	page: z.number().int(),
	total: z.number().int(),
	limit: z.number().int(),
	hasNextPage: z.boolean(),
	totalPages: z.number().int(),
	hasPreviousPage: z.boolean(),
});

const executeEntityQueryEngineResponseDataSchema = z
	.object({
		items: z.array(queryEngineItemSchema),
		meta: z.object({ pagination: queryEnginePaginationSchema }).strict(),
	})
	.strict();

const aggregateValueSchema = resolvedDisplayValueSchema.extend({ key: z.string() }).strict();

const executeAggregateQueryEngineResponseDataSchema = z
	.object({ values: z.array(aggregateValueSchema) })
	.strict();

const timeSeriesBucketSchema = z.object({ date: z.string(), value: z.number() }).strict();

const executeTimeSeriesQueryEngineResponseDataSchema = z
	.object({ buckets: z.array(timeSeriesBucketSchema) })
	.strict();

const queryEngineResponseDataSchema = z.discriminatedUnion("mode", [
	z
		.object({
			mode: z.literal("entities"),
			data: executeEntityQueryEngineResponseDataSchema,
		})
		.strict(),
	z
		.object({
			mode: z.literal("aggregate"),
			data: executeAggregateQueryEngineResponseDataSchema,
		})
		.strict(),
	z
		.object({
			mode: z.literal("events"),
			data: executeEntityQueryEngineResponseDataSchema,
		})
		.strict(),
	z
		.object({
			mode: z.literal("timeSeries"),
			data: executeTimeSeriesQueryEngineResponseDataSchema,
		})
		.strict(),
]);

export const executeQueryEngineResponseSchema = dataSchema(queryEngineResponseDataSchema);

export type QueryEngineItem = z.infer<typeof queryEngineItemSchema>;
export type QueryEngineField = z.infer<typeof queryEngineFieldSchema>;
export type QueryEngineRequest = z.infer<typeof queryEngineRequestSchema>;
export type EntityQueryEngineRequest = z.infer<typeof entityQueryEngineRequestSchema>;
export type AggregateQueryEngineRequest = z.infer<typeof aggregateQueryEngineRequestSchema>;
export type EventsQueryEngineRequest = z.infer<typeof eventsQueryEngineRequestSchema>;
export type ResolvedDisplayValue = z.infer<typeof resolvedDisplayValueSchema>;
export type QueryEngineResponse = z.infer<typeof queryEngineResponseDataSchema>;
export type QueryEngineEntityResponse = Extract<QueryEngineResponse, { mode: "entities" }>;
export type QueryEngineAggregateResponse = Extract<QueryEngineResponse, { mode: "aggregate" }>;
export type QueryEngineEventsResponse = Extract<QueryEngineResponse, { mode: "events" }>;
export type QueryEngineTimeSeriesResponse = Extract<QueryEngineResponse, { mode: "timeSeries" }>;
export type TimeSeriesQueryEngineRequest = z.infer<typeof timeSeriesQueryEngineRequestSchema>;
export type QueryEngineEntityResponseData = QueryEngineEntityResponse["data"];
export type QueryEngineAggregateResponseData = QueryEngineAggregateResponse["data"];
export type QueryEngineEventsResponseData = QueryEngineEventsResponse["data"];
export type QueryEngineTimeSeriesResponseData = QueryEngineTimeSeriesResponse["data"];
export type QueryEngineResolvedField = z.infer<typeof resolvedQueryEngineFieldSchema>;
