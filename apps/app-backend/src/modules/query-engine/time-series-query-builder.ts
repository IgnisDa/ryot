import { dayjs } from "@ryot/ts-utils";
import { sql } from "drizzle-orm";
import { match } from "ts-pattern";
import { db } from "~/lib/db";
import { createScalarExpressionCompiler } from "./expression-compiler";
import { createExpressionTypeResolver } from "./expression-type-resolver";
import { buildFilterWhereClause } from "./filter-builder";
import { buildQueryContext, type PreparedQueryContext } from "./preparer";
import {
	buildEventFirstCte,
	EVENT_FIRST_ENTITY_COLUMN_OVERRIDES,
} from "./query-ctes";
import type {
	QueryEngineTimeSeriesResponse,
	TimeSeriesQueryEngineRequest,
} from "./schemas";

type TimeSeriesRow = {
	date: Date | string;
	value: number | string | null;
};

export const buildBucketInterval = (
	bucket: TimeSeriesQueryEngineRequest["bucket"],
): string =>
	match(bucket)
		.with("hour", () => "1 hour")
		.with("day", () => "1 day")
		.with("week", () => "1 week")
		.with("month", () => "1 month")
		.exhaustive();

export const alignDateRangeToBucket = (input: {
	bucket: TimeSeriesQueryEngineRequest["bucket"];
	dateRange: TimeSeriesQueryEngineRequest["dateRange"];
}) => {
	const startAt = dayjs.utc(input.dateRange.startAt).startOf(input.bucket);
	const endAt = dayjs
		.utc(input.dateRange.endAt)
		.subtract(1, "millisecond")
		.startOf(input.bucket)
		.add(1, input.bucket);

	return {
		startAt: startAt.toISOString(),
		endAt: endAt.toISOString(),
	};
};

export const executeTimeSeriesQuery = async (input: {
	userId: string;
	context: PreparedQueryContext;
	request: TimeSeriesQueryEngineRequest;
}): Promise<QueryEngineTimeSeriesResponse> => {
	const queryContext = buildQueryContext(input.userId, input.context, {
		eventJoinMap: new Map(),
		eventSchemaMap: input.context.eventSchemaMap,
		entityColumnOverrides: EVENT_FIRST_ENTITY_COLUMN_OVERRIDES,
	});

	const bucketInterval = buildBucketInterval(input.request.bucket);
	const alignedDateRange = alignDateRangeToBucket({
		bucket: input.request.bucket,
		dateRange: input.request.dateRange,
	});
	const matchingEventsCte = buildEventFirstCte({
		userId: input.userId,
		cteName: "matching_events",
		dateRange: alignedDateRange,
		eventSchemaSlugs: input.request.eventSchemas,
		entitySchemaIds: input.context.runtimeSchemas.map((s) => s.id),
	});

	const filterWhereClause = buildFilterWhereClause({
		context: queryContext,
		alias: "matching_events",
		predicate: input.request.filter,
		computedFields: input.request.computedFields,
	});
	const filterClause = filterWhereClause ?? sql`true`;

	const getTypeInfo = createExpressionTypeResolver({
		context: queryContext,
		computedFields: input.request.computedFields,
	});
	const compiler = createScalarExpressionCompiler({
		getTypeInfo,
		context: queryContext,
		alias: "filtered_events",
		computedFields: input.request.computedFields,
	});

	const metricExpression =
		input.request.metric.type === "count"
			? sql`count(*)::integer`
			: sql`sum(${compiler.compile(input.request.metric.expression, "number")})`;

	const result = await db.execute<TimeSeriesRow>(sql`
		with
			bucket_series as (
				select generate_series(
					date_trunc(${input.request.bucket}, ${input.request.dateRange.startAt}::timestamptz at time zone 'UTC'),
					date_trunc(${input.request.bucket}, (${input.request.dateRange.endAt}::timestamptz - interval '1 microsecond') at time zone 'UTC'),
					${bucketInterval}::interval
				) as bucket_start
			),
			${matchingEventsCte},
			filtered_events as (
				select * from matching_events where ${filterClause}
			),
			bucketed as (
				select
					date_trunc(${input.request.bucket}, created_at at time zone 'UTC') as bucket,
					${metricExpression} as value
				from filtered_events
				group by 1
			)
		select
			bucket_series.bucket_start as date,
			coalesce(bucketed.value, 0) as value
		from bucket_series
		left join bucketed on bucketed.bucket = bucket_series.bucket_start
		order by bucket_series.bucket_start
	`);

	return {
		mode: "timeSeries",
		data: {
			buckets: result.rows.map((row) => ({
				value: Number(row.value ?? 0),
				date:
					row.date instanceof Date ? row.date.toISOString() : String(row.date),
			})),
		},
	};
};
