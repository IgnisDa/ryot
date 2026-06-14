import { sql } from "drizzle-orm";
import { DateTime, Effect, Option } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";

import type { TimeSeriesResponse } from "../language";
import { addTimeSeriesBucket, alignDateRangeToBucket } from "../time-series-buckets";
import { compileBool, compileScalar } from "./compile/expr";
import { timeBucketSql, timeRangeConditionSql } from "./compile/fragments";
import { rootScope } from "./compile/scope";
import { measureExprSql } from "./compile/select-list";
import { rootSourceFromWhereSql } from "./root-source";
import type { TimeSeriesQueryDocument } from "./types";

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

// Walks the aligned, zero-filled bucket grid and reads each bucket's value, defaulting to 0. The
// grid (calendar boundaries, ≤1000 buckets) is built in app code; SQL only produces sparse values.
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

// Executes a time-series return entirely in SQL: bucketing (date_trunc, UTC) and aggregation run in
// Postgres over the compiled `where` + range condition; the app zero-fills the aligned grid.
export const executeTimeSeriesQuery = Effect.fn("executeTimeSeriesQuery")(function* (
	userId: string,
	doc: TimeSeriesQueryDocument,
) {
	const { source, output } = doc;
	const startAt = DateTime.make(output.time.range.startAt);
	const endAt = DateTime.make(output.time.range.endAt);
	if (Option.isNone(startAt) || Option.isNone(endAt)) {
		return { type: "timeSeries" as const, data: { buckets: [] } };
	}
	const range = { startAt: startAt.value, endAt: endAt.value };

	const scope = rootScope(source, userId);
	const timeColSql = compileScalar(output.time.expr, scope, "date");
	const conditions = [
		...(source.where ? [compileBool(source.where, scope)] : []),
		timeRangeConditionSql(
			timeColSql,
			DateTime.formatIso(range.startAt),
			DateTime.formatIso(range.endAt),
		),
	];
	const fromWhere = yield* rootSourceFromWhereSql(userId, source, conditions);

	const aggregate = measureExprSql(output.measure.aggregation, scope);
	// A non-empty bucket whose numeric measure is null coerces to 0; empty buckets are zero-filled.
	const valueSql =
		output.measure.aggregation.function === "count" ? aggregate : sql`COALESCE(${aggregate}, 0)`;

	const db = yield* CurrentDb;
	const rawRows = yield* dbEffect(() =>
		db.execute<{ bucket: unknown; value: unknown }>(sql`
			SELECT
				${timeBucketSql(output.time.bucket, timeColSql)} AS "bucket",
				${valueSql} AS "value"
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
