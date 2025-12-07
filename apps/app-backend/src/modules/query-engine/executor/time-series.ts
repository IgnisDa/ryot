import { sql } from "drizzle-orm";
import { DateTime, Effect, Option } from "effect";

import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

import { compileBool, compileScalar } from "./compile/expr";
import { bucketStartSql, bucketStepSql, timeRangeConditionSql } from "./compile/fragments";
import { rootScope } from "./compile/scope";
import { measureExprSql } from "./compile/select-list";
import { rootSourceFromWhereSql } from "./root-source";
import type { TimeSeriesQueryDocument } from "./types";

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

// A bucket boundary (timestamptz) from SQL, normalized to the canonical ISO form the contract uses.
const formatBoundary = (value: unknown): string => {
	const parsed = parseTimeValue(value);
	return Option.isSome(parsed) ? DateTime.formatIso(parsed.value) : String(value);
};

// Executes a time-series return entirely in SQL: bucketing, aggregation, and zero-filling all run in
// Postgres. A generate_series grid over the aligned range LEFT JOINs the sparse per-bucket aggregate,
// so empty buckets surface as 0 with no app-side grid construction. Grid math runs in naive-UTC
// `timestamp` space, so stepping is timezone-independent and the join keys match date_trunc exactly.
export const executeTimeSeriesQuery = Effect.fn("executeTimeSeriesQuery")(function* (
	userId: string,
	language: string | null,
	doc: TimeSeriesQueryDocument,
) {
	const { source, output } = doc;
	const startAt = DateTime.make(output.time.range.startAt);
	const endAt = DateTime.make(output.time.range.endAt);
	if (Option.isNone(startAt) || Option.isNone(endAt)) {
		return { type: "timeSeries" as const, data: { buckets: [] } };
	}
	const rangeStart = DateTime.formatIso(startAt.value);
	const rangeEnd = DateTime.formatIso(endAt.value);

	const { bucket } = output.time;
	const scope = rootScope(source, userId, language);
	const timeColSql = compileScalar(output.time.expr, scope, "date");
	const conditions = [
		...(source.where ? [compileBool(source.where, scope)] : []),
		timeRangeConditionSql(timeColSql, rangeStart, rangeEnd),
	];
	const fromWhere = yield* rootSourceFromWhereSql(userId, language, source, conditions);

	const measure = measureExprSql(output.measure.aggregation, scope);
	const step = bucketStepSql(bucket);
	// The grid runs from the bucket containing startAt to the bucket containing endAt's last instant
	// (endAt is exclusive, so back off one microsecond before truncating). generate_series is inclusive
	// of the stop, so the last grid point is exactly that final bucket.
	const gridStart = bucketStartSql(bucket, sql`${rangeStart}::timestamptz`);
	const gridStop = bucketStartSql(
		bucket,
		sql`(${rangeEnd}::timestamptz - interval '1 microsecond')`,
	);

	const db = yield* CurrentDb;
	const rawRows = yield* dbEffect(() =>
		db.execute<{ startAt: unknown; endAt: unknown; value: unknown }>(sql`
			WITH agg AS (
				SELECT ${bucketStartSql(bucket, timeColSql)} AS "bucketStart", ${measure} AS "value"
				${fromWhere}
				GROUP BY 1
			)
			SELECT
				(grid."bucketStart" AT TIME ZONE 'UTC') AS "startAt",
				((grid."bucketStart" + ${step}) AT TIME ZONE 'UTC') AS "endAt",
				COALESCE(agg."value", 0) AS "value"
			FROM generate_series(${gridStart}, ${gridStop}, ${step}) AS grid("bucketStart")
			LEFT JOIN agg ON agg."bucketStart" = grid."bucketStart"
			ORDER BY grid."bucketStart"
		`),
	);

	const buckets = rawRows.rows.map((row) => ({
		startAt: formatBoundary(row.startAt),
		endAt: formatBoundary(row.endAt),
		value: Number(row.value),
	}));
	return { type: "timeSeries" as const, data: { buckets } };
});
