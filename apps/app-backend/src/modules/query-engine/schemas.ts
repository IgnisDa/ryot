import { z } from "@hono/zod-openapi";

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
import { createUniqueNonEmptyTrimmedStringArraySchema } from "~/lib/zod";

import {
	aggregationFieldArraySchema,
	eventJoinDefinitionArraySchema,
	relationshipJoinDefinitionArraySchema,
	sortDefinitionSchema,
	timeSeriesMetricSchema,
} from "../saved-views/schemas";

export type QueryEngineContext = QueryEngineReferenceContext<
	QueryEngineSchemaLike,
	QueryEngineEventJoinLike
>;

const paginationSchema = z
	.object({
		page: z.number().int().min(1),
		limit: z.number().int().min(1).max(1000),
	})
	.strict();

export const queryEngineFieldSchema = z
	.object({
		expression: viewExpressionSchema,
		key: z.string().trim().min(1, "Field keys are required"),
	})
	.strict();

const queryEngineScopeSchema = createUniqueNonEmptyTrimmedStringArraySchema({
	minMessage: "At least one entity schema slug is required",
	duplicateMessage: "Entity schema slugs must be unique",
});

const eventSchemasSchema = createUniqueNonEmptyTrimmedStringArraySchema({
	minMessage: "At least one event schema slug is required",
	duplicateMessage: "Event schema slugs must be unique",
});

const hasMillisecondOrLowerPrecision = (value: string) => {
	const fractional = value.match(/\.(\d+)(?=Z|[+-]\d{2}:?\d{2}$)/);
	return !fractional || (fractional[1]?.length ?? 0) <= 3;
};

const dateRangeDateTimeSchema = z.iso
	.datetime({ offset: true })
	.refine(
		hasMillisecondOrLowerPrecision,
		"dateRange datetimes must not exceed millisecond precision",
	);

const entityQueryEngineFieldsSchema = z
	.array(queryEngineFieldSchema)
	.refine(
		(fields) => new Set(fields.map((field) => field.key)).size === fields.length,
		"Field keys must be unique",
	)
	.default([]);

const queryEngineRequestCoreSchema = z
	.object({
		scope: queryEngineScopeSchema,
		computedFields: computedFieldArraySchema,
		filter: nullableViewPredicateSchema.default(null),
	})
	.strict();

const queryEngineRequestWithEventJoinsSchema = queryEngineRequestCoreSchema
	.extend({ eventJoins: eventJoinDefinitionArraySchema })
	.strict();

const queryEngineRequestBaseSchema = queryEngineRequestWithEventJoinsSchema
	.extend({ relationshipJoins: relationshipJoinDefinitionArraySchema })
	.strict();

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

export const eventsQueryEngineRequestSchema = queryEngineRequestWithEventJoinsSchema
	.extend({
		sort: sortDefinitionSchema,
		pagination: paginationSchema,
		mode: z.literal("events"),
		fields: entityQueryEngineFieldsSchema,
		eventSchemas: eventSchemasSchema.optional(),
	})
	.strict();

export const timeSeriesQueryEngineRequestSchema = queryEngineRequestCoreSchema
	.extend({
		metric: timeSeriesMetricSchema,
		mode: z.literal("timeSeries"),
		eventSchemas: eventSchemasSchema.optional(),
		bucket: z.enum(["day", "hour", "month", "week"]),
		dateRange: z
			.object({
				endAt: dateRangeDateTimeSchema,
				startAt: dateRangeDateTimeSchema,
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

const resolvedDisplayRawValueSchema = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.array(z.any()),
	z.record(z.string(), z.any()),
	z.null(),
]);

export const resolvedDisplayValueSchema = z
	.object({
		value: resolvedDisplayRawValueSchema,
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

const aggregateValueSchema = z.discriminatedUnion("kind", [
	z
		.object({
			key: z.string(),
			value: z.number(),
			kind: z.literal("number"),
		})
		.strict(),
	z
		.object({
			key: z.string(),
			kind: z.literal("json"),
			value: z.record(z.string(), z.number()),
		})
		.strict(),
	z
		.object({
			key: z.string(),
			kind: z.literal("null"),
			value: z.null(),
		})
		.strict(),
]);

const executeAggregateQueryEngineResponseDataSchema = z
	.object({ values: z.array(aggregateValueSchema) })
	.strict();

const timeSeriesBucketSchema = z.object({ date: z.string(), value: z.number() }).strict();

const executeTimeSeriesQueryEngineResponseDataSchema = z
	.object({
		buckets: z.array(timeSeriesBucketSchema),
		meta: z
			.object({ alignedDateRange: z.object({ endAt: z.string(), startAt: z.string() }).strict() })
			.strict(),
	})
	.strict();

export const queryEngineResponseDataSchema = z.discriminatedUnion("mode", [
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

export type QueryEngineItem = z.infer<typeof queryEngineItemSchema>;
export type QueryEngineField = z.infer<typeof queryEngineFieldSchema>;
export type QueryEngineRequest = z.infer<typeof queryEngineRequestSchema>;
export type ResolvedDisplayValue = z.infer<typeof resolvedDisplayValueSchema>;
export type QueryEngineEventsResponseData = QueryEngineEventsResponse["data"];
export type QueryEngineEntityResponseData = QueryEngineEntityResponse["data"];
export type QueryEngineResponse = z.infer<typeof queryEngineResponseDataSchema>;
export type QueryEngineAggregateResponseData = QueryEngineAggregateResponse["data"];
export type EntityQueryEngineRequest = z.infer<typeof entityQueryEngineRequestSchema>;
export type QueryEngineTimeSeriesResponseData = QueryEngineTimeSeriesResponse["data"];
export type EventsQueryEngineRequest = z.infer<typeof eventsQueryEngineRequestSchema>;
export type QueryEngineEventsResponse = Extract<QueryEngineResponse, { mode: "events" }>;
export type QueryEngineEntityResponse = Extract<QueryEngineResponse, { mode: "entities" }>;
export type AggregateQueryEngineRequest = z.infer<typeof aggregateQueryEngineRequestSchema>;
export type TimeSeriesQueryEngineRequest = z.infer<typeof timeSeriesQueryEngineRequestSchema>;
export type QueryEngineAggregateResponse = Extract<QueryEngineResponse, { mode: "aggregate" }>;
export type QueryEngineTimeSeriesResponse = Extract<QueryEngineResponse, { mode: "timeSeries" }>;
