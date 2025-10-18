import { sql } from "drizzle-orm";
import { DateTime, Effect, Match, Option } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";
import type { DbError } from "#lib/errors";
import type { TimeSeriesQueryRequest } from "#lib/query-language";

import type { PreparedQueryContext } from "./context";
import { buildEventFirstCte } from "./event-query-ctes";
import {
	buildQueryFilterClause,
	buildQueryRuntime,
	buildScalarCompiler,
} from "./query-builder-shared";
import { EVENT_FIRST_ENTITY_COLUMN_OVERRIDES, TIMESERIES_CTE_ALIASES } from "./query-cte-shared";

type TimeSeriesRow = {
	date: Date | string;
	value: number | string | null;
};

export const buildBucketInterval = (bucket: TimeSeriesQueryRequest["bucket"]): string =>
	Match.value(bucket).pipe(
		Match.when("hour", () => "1 hour"),
		Match.when("day", () => "1 day"),
		Match.when("week", () => "1 week"),
		Match.when("month", () => "1 month"),
		Match.exhaustive,
	);

const startOfUtcHour = (isoString: string): Date => {
	const d = new Date(isoString);
	d.setUTCMinutes(0, 0, 0);
	return d;
};

const startOfUtcDay = (isoString: string): Date => {
	const d = new Date(isoString);
	d.setUTCHours(0, 0, 0, 0);
	return d;
};

const startOfIsoWeek = (isoString: string): Date => {
	const d = startOfUtcDay(isoString);
	const dayOfWeek = d.getUTCDay();
	const daysSinceMonday = (dayOfWeek + 6) % 7;
	d.setUTCDate(d.getUTCDate() - daysSinceMonday);
	return d;
};

const startOfUtcMonth = (isoString: string): Date => {
	const d = new Date(isoString);
	d.setUTCDate(1);
	d.setUTCHours(0, 0, 0, 0);
	return d;
};

const addBucket = (d: Date, bucket: TimeSeriesQueryRequest["bucket"]): Date => {
	const result = new Date(d);
	Match.value(bucket).pipe(
		Match.when("hour", () => result.setUTCHours(result.getUTCHours() + 1)),
		Match.when("day", () => result.setUTCDate(result.getUTCDate() + 1)),
		Match.when("week", () => result.setUTCDate(result.getUTCDate() + 7)),
		Match.when("month", () => result.setUTCMonth(result.getUTCMonth() + 1)),
		Match.exhaustive,
	);
	return result;
};

const startOfBucket = (isoString: string, bucket: TimeSeriesQueryRequest["bucket"]): Date => {
	return Match.value(bucket).pipe(
		Match.when("hour", () => startOfUtcHour(isoString)),
		Match.when("day", () => startOfUtcDay(isoString)),
		Match.when("week", () => startOfIsoWeek(isoString)),
		Match.when("month", () => startOfUtcMonth(isoString)),
		Match.exhaustive,
	);
};

export const alignDateRangeToBucket = (input: {
	bucket: TimeSeriesQueryRequest["bucket"];
	dateRange: TimeSeriesQueryRequest["dateRange"];
}) => {
	const startAt = startOfBucket(input.dateRange.startAt, input.bucket);
	const endAtMs = new Date(input.dateRange.endAt).getTime() - 1;
	const endAt = addBucket(
		startOfBucket(new Date(endAtMs).toISOString(), input.bucket),
		input.bucket,
	);

	return {
		startAt: startAt.toISOString(),
		endAt: endAt.toISOString(),
	};
};

export const normalizeBucketDate = (value: Date | string): string => {
	if (value instanceof Date) {
		return value.toISOString();
	}

	const normalized = value.trim().replace(" ", "T");
	const withZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
	const parsed = DateTime.make(withZone);
	return Option.isSome(parsed) ? DateTime.formatIso(parsed.value) : value;
};

export const executeTimeSeriesQuery = (input: {
	userId: string;
	context: PreparedQueryContext;
	request: TimeSeriesQueryRequest;
}): Effect.Effect<
	{
		mode: "timeSeries";
		data: {
			buckets: { date: string; value: number }[];
			meta: { alignedDateRange: { startAt: string; endAt: string } };
		};
	},
	DbError,
	CurrentDb
> =>
	Effect.gen(function* () {
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

		const db = yield* CurrentDb;
		const result = yield* dbEffect(() =>
			db.execute<TimeSeriesRow>(sql`
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
							date_trunc(${input.request.bucket}, occurred_at at time zone 'UTC') as bucket,
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
			`),
		);

		return {
			mode: "timeSeries" as const,
			data: {
				meta: { alignedDateRange },
				buckets: result.rows.map((row) => ({
					value: Number(row.value ?? 0),
					date: normalizeBucketDate(row.date),
				})),
			},
		};
	});
