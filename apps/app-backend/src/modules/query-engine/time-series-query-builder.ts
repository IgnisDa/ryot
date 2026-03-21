import { dayjs } from "@ryot/ts-utils/dayjs";
import { sql } from "drizzle-orm";
import { match } from "ts-pattern";

import { db } from "~/lib/db";

import type { PreparedQueryContext } from "./context";
import { buildEventFirstCte } from "./event-query-ctes";
import {
	buildQueryFilterClause,
	buildQueryRuntime,
	buildScalarCompiler,
} from "./query-builder-shared";
import { EVENT_FIRST_ENTITY_COLUMN_OVERRIDES, TIMESERIES_CTE_ALIASES } from "./query-cte-shared";
import type { QueryEngineTimeSeriesResponse, TimeSeriesQueryEngineRequest } from "./schemas";

type TimeSeriesRow = {
	date: Date | string;
	value: number | string | null;
};

export const buildBucketInterval = (bucket: TimeSeriesQueryEngineRequest["bucket"]): string =>
	match(bucket)
		.with("hour", () => "1 hour")
		.with("day", () => "1 day")
		.with("week", () => "1 week")
		.with("month", () => "1 month")
		.exhaustive();

const startOfIsoWeek = (value: string) => {
	const date = dayjs.utc(value).startOf("day");
	const dayOfWeek = date.day();
	const daysSinceMonday = (dayOfWeek + 6) % 7;
	return date.subtract(daysSinceMonday, "day");
};

const startOfBucket = (value: string, bucket: TimeSeriesQueryEngineRequest["bucket"]) => {
	return bucket === "week" ? startOfIsoWeek(value) : dayjs.utc(value).startOf(bucket);
};

export const alignDateRangeToBucket = (input: {
	bucket: TimeSeriesQueryEngineRequest["bucket"];
	dateRange: TimeSeriesQueryEngineRequest["dateRange"];
}) => {
	const startAt = startOfBucket(input.dateRange.startAt, input.bucket);
	const endAt = startOfBucket(
		dayjs.utc(input.dateRange.endAt).subtract(1, "millisecond").toISOString(),
		input.bucket,
	).add(1, input.bucket);

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
	const runtime = buildQueryRuntime({
		userId: input.userId,
		context: input.context,
		computedFields: input.request.computedFields,
		overrides: {
			eventJoinMap: new Map(),
			eventSchemaMap: input.context.eventSchemaMap,
			entityColumnOverrides: EVENT_FIRST_ENTITY_COLUMN_OVERRIDES,
		},
	});

	const bucketInterval = buildBucketInterval(input.request.bucket);
	const alignedDateRange = alignDateRangeToBucket({
		bucket: input.request.bucket,
		dateRange: input.request.dateRange,
	});
	const matchingEventsCte = buildEventFirstCte({
		userId: input.userId,
		dateRange: input.request.dateRange,
		eventSchemaSlugs: input.request.eventSchemas,
		cteName: TIMESERIES_CTE_ALIASES.matchingEvents,
		entitySchemaIds: input.context.runtimeSchemas.map((s) => s.id),
	});
	const filterWhereClause = buildQueryFilterClause({
		runtime,
		predicate: input.request.filter,
		alias: TIMESERIES_CTE_ALIASES.matchingEvents,
		computedFields: input.request.computedFields,
	});
	const compiler = buildScalarCompiler({
		runtime,
		alias: TIMESERIES_CTE_ALIASES.filteredEvents,
		computedFields: input.request.computedFields,
	});

	const metricExpression =
		input.request.metric.type === "count"
			? sql`count(*)::integer`
			: sql`sum(${compiler.compile(input.request.metric.expression, "number")})`;

	const result = await db.execute<TimeSeriesRow>(sql`
		with
			${sql.raw(TIMESERIES_CTE_ALIASES.bucketSeries)} as (
				select generate_series(
					${alignedDateRange.startAt}::timestamptz at time zone 'UTC',
					(${alignedDateRange.endAt}::timestamptz - ${bucketInterval}::interval) at time zone 'UTC',
					${bucketInterval}::interval
				) as bucket_start
			),
			${matchingEventsCte},
			${sql.raw(TIMESERIES_CTE_ALIASES.filteredEvents)} as (
				select * from ${sql.raw(TIMESERIES_CTE_ALIASES.matchingEvents)} where ${filterWhereClause}
			),
			${sql.raw(TIMESERIES_CTE_ALIASES.bucketed)} as (
				select
					date_trunc(${input.request.bucket}, created_at at time zone 'UTC') as bucket,
					${metricExpression} as value
				from ${sql.raw(TIMESERIES_CTE_ALIASES.filteredEvents)}
				group by 1
			)
		select
			${sql.raw(TIMESERIES_CTE_ALIASES.bucketSeries)}.bucket_start as date,
			coalesce(${sql.raw(TIMESERIES_CTE_ALIASES.bucketed)}.value, 0) as value
		from ${sql.raw(TIMESERIES_CTE_ALIASES.bucketSeries)}
		left join ${sql.raw(TIMESERIES_CTE_ALIASES.bucketed)} on ${sql.raw(TIMESERIES_CTE_ALIASES.bucketed)}.bucket = ${sql.raw(TIMESERIES_CTE_ALIASES.bucketSeries)}.bucket_start
		order by ${sql.raw(TIMESERIES_CTE_ALIASES.bucketSeries)}.bucket_start
	`);

	return {
		mode: "timeSeries",
		data: {
			buckets: result.rows.map((row) => ({
				value: Number(row.value ?? 0),
				date: row.date instanceof Date ? row.date.toISOString() : row.date,
			})),
			meta: { alignedDateRange },
		},
	};
};
