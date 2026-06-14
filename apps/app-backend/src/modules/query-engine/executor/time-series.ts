import { sql } from "drizzle-orm";
import { DateTime, Effect, Option } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";

import type { FieldValue, TimeSeriesResponse } from "../language";
import {
	addTimeSeriesBucket,
	alignDateRangeToBucket,
	startOfTimeSeriesBucket,
} from "../time-series-buckets";
import { evalAggregateMeasure, evalExprAsBoolean, evalExprValue } from "./expr";
import { executeRootSourceMatches, rootSourceFromWhereSql } from "./source-matches";
import {
	measureAggregationSql,
	rootAliasResolver,
	rootWherePushdown,
	timeBucketSql,
	timeColumnSql,
	timeRangeConditionSql,
} from "./sql";
import type { SourceMatch, TimeSeriesQueryDocument } from "./types";

type TimeSeriesRange = { endAt: DateTime.DateTime; startAt: DateTime.DateTime };
type TimeSeriesBucket = TimeSeriesResponse["data"]["buckets"][number];

const parseTimeValue = (value: unknown): Option.Option<DateTime.DateTime> => {
	if (DateTime.isDateTime(value)) {
		return Option.some(value);
	}
	if (value instanceof Date) {
		return DateTime.make(value.getTime());
	}
	if (typeof value === "string") {
		const normalized = value
			.trim()
			.replace(" ", "T")
			.replace(/([+-]\d{2})$/, "$1:00");
		const withZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
		return DateTime.make(withZone);
	}
	if (typeof value === "number") {
		return DateTime.make(value);
	}
	if (typeof value === "object" && value !== null) {
		if ("toISOString" in value && typeof value.toISOString === "function") {
			return DateTime.make(value.toISOString());
		}
	}
	return Option.none();
};

const isWithinHalfOpenRange = (value: DateTime.DateTime, range: TimeSeriesRange) =>
	!DateTime.lessThan(value, range.startAt) && DateTime.lessThan(value, range.endAt);

const numberFromAggregateValue = (value: FieldValue) =>
	typeof value.value === "number" ? value.value : 0;

// Walks the aligned, zero-filled bucket grid (identical boundaries/formatting to the app-side path)
// and reads each bucket's value from `valueByBucketStart`, defaulting missing buckets to 0.
const buildZeroFilledBuckets = (
	doc: TimeSeriesQueryDocument,
	range: TimeSeriesRange,
	valueByBucketStart: (bucketStartIso: string) => number,
): TimeSeriesBucket[] => {
	const buckets: TimeSeriesBucket[] = [];
	const alignedRange = alignDateRangeToBucket({
		endAt: range.endAt,
		startAt: range.startAt,
		bucket: doc.output.time.bucket,
	});
	let cursor = alignedRange.startAt;
	while (DateTime.lessThan(cursor, alignedRange.endAt)) {
		const bucketKey = DateTime.formatIso(cursor);
		const next = addTimeSeriesBucket(cursor, doc.output.time.bucket);
		buckets.push({
			startAt: bucketKey,
			endAt: DateTime.formatIso(next),
			value: valueByBucketStart(bucketKey),
		});
		cursor = next;
	}
	return buckets;
};

type TimeSeriesSqlPlan = {
	readonly timeColSql: ReturnType<typeof sql>;
	readonly valueSql: ReturnType<typeof sql>;
	readonly conditions: readonly ReturnType<typeof sql>[];
};

// Compiles a time-series return into SQL bucketing + aggregation when semantics match, otherwise
// null (keeping the app-side path). Requires a fully-pushable source `where`, a system date-column
// time expression, and a pushable measure (count / numeric sum·avg·min·max, not count-distinct).
const planTimeSeriesSql = (
	doc: TimeSeriesQueryDocument,
	userId: string,
): TimeSeriesSqlPlan | null => {
	const { source, output } = doc;
	const pushdown = rootWherePushdown(source, userId);
	if (pushdown.residual !== null) {
		return null;
	}
	const resolve = rootAliasResolver(source);

	const timeExpr = output.time.expr;
	if (timeExpr.type !== "ref") {
		return null;
	}
	const timeTarget = resolve(timeExpr.sourceAlias);
	if (!timeTarget) {
		return null;
	}
	const timeColSql = timeColumnSql(timeExpr.field, timeTarget);
	if (!timeColSql) {
		return null;
	}

	const aggregation = output.measure.aggregation;
	const aggregateSql = measureAggregationSql(aggregation, resolve);
	if (!aggregateSql) {
		return null;
	}
	// A non-empty bucket whose numeric measure is null coerces to 0 (numberFromAggregateValue);
	// empty buckets are zero-filled while walking the grid.
	const valueSql =
		aggregation.function === "count" ? aggregateSql : sql`COALESCE(${aggregateSql}, 0)`;

	return { timeColSql, valueSql, conditions: pushdown.conditions };
};

const executeTimeSeriesSql = Effect.fn("executeTimeSeriesSql")(function* (
	userId: string,
	doc: TimeSeriesQueryDocument,
	plan: TimeSeriesSqlPlan,
	range: TimeSeriesRange,
) {
	// Format the parsed bounds back to canonical UTC ISO so the `::timestamptz` cast is anchored to
	// UTC (a naive range string would otherwise be read in the session time zone) and matches the
	// instant the app-side path filters on.
	const conditions = [
		...plan.conditions,
		timeRangeConditionSql(
			plan.timeColSql,
			DateTime.formatIso(range.startAt),
			DateTime.formatIso(range.endAt),
		),
	];
	const fromWhere = yield* rootSourceFromWhereSql(userId, doc.source, conditions);
	const db = yield* CurrentDb;
	const rawRows = yield* dbEffect(() =>
		db.execute<{ bucket: unknown; value: unknown }>(sql`
				SELECT
					${timeBucketSql(doc.output.time.bucket, plan.timeColSql)} AS "bucket",
					${plan.valueSql} AS "value"
				${fromWhere}
				GROUP BY 1
			`),
	);

	const values = new Map<string, number>();
	for (const row of rawRows.rows) {
		const bucket = parseTimeValue(row.bucket);
		if (Option.isSome(bucket)) {
			values.set(DateTime.formatIso(bucket.value), Number(row.value));
		}
	}

	return {
		type: "timeSeries" as const,
		data: { buckets: buildZeroFilledBuckets(doc, range, (key) => values.get(key) ?? 0) },
	};
});

const executeTimeSeriesInApp = Effect.fn("executeTimeSeriesInApp")(function* (
	userId: string,
	doc: TimeSeriesQueryDocument,
	range: TimeSeriesRange,
) {
	const groups = new Map<string, SourceMatch[]>();
	const matches = yield* executeRootSourceMatches(userId, doc.source, evalExprAsBoolean);

	for (const match of matches) {
		const rawValue = (yield* evalExprValue(userId, doc.output.time.expr, match.context)).value;
		const timeValue = parseTimeValue(rawValue);
		if (Option.isNone(timeValue) || !isWithinHalfOpenRange(timeValue.value, range)) {
			continue;
		}

		const bucketStart = startOfTimeSeriesBucket(timeValue.value, doc.output.time.bucket);
		const bucketKey = DateTime.formatIso(bucketStart);
		const bucketMatches = groups.get(bucketKey);
		if (bucketMatches === undefined) {
			groups.set(bucketKey, [match]);
			continue;
		}
		bucketMatches.push(match);
	}

	const bucketValues = new Map<string, number>();
	for (const [bucketKey, bucketMatches] of groups) {
		const aggregateValue = yield* evalAggregateMeasure(
			userId,
			bucketMatches,
			doc.output.measure.aggregation,
		);
		bucketValues.set(bucketKey, numberFromAggregateValue(aggregateValue));
	}

	return {
		type: "timeSeries" as const,
		data: { buckets: buildZeroFilledBuckets(doc, range, (key) => bucketValues.get(key) ?? 0) },
	};
});

export const executeTimeSeriesQuery = Effect.fn("executeTimeSeriesQuery")(function* (
	userId: string,
	doc: TimeSeriesQueryDocument,
) {
	const startAt = DateTime.make(doc.output.time.range.startAt);
	const endAt = DateTime.make(doc.output.time.range.endAt);
	if (Option.isNone(startAt) || Option.isNone(endAt)) {
		return { type: "timeSeries" as const, data: { buckets: [] } };
	}

	const range = { startAt: startAt.value, endAt: endAt.value };
	const plan = planTimeSeriesSql(doc, userId);
	return plan
		? yield* executeTimeSeriesSql(userId, doc, plan, range)
		: yield* executeTimeSeriesInApp(userId, doc, range);
});
