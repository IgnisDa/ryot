import { DateTime, Duration, Effect, Option } from "effect";

import type { CurrentDb } from "#lib/db";
import type { BadRequest, DbError, NotFound } from "#lib/errors";

import type { FieldValue, TimeSeriesResponse } from "../language";
import { evalAggregateMeasure, evalExprAsBoolean, evalExprValue } from "./expr";
import { executeRootSourceMatches } from "./source-matches";
import type { SourceMatch, TimeSeriesQueryDocument } from "./types";

type TimeSeriesBucket = TimeSeriesQueryDocument["output"]["time"]["bucket"];
type TimeSeriesRange = { endAt: DateTime.DateTime; startAt: DateTime.DateTime };

const addBucket = (value: DateTime.DateTime, bucket: TimeSeriesBucket) => {
	if (bucket === "hour") {
		return DateTime.addDuration(value, Duration.hours(1));
	}
	if (bucket === "day") {
		return DateTime.addDuration(value, Duration.days(1));
	}
	if (bucket === "week") {
		return DateTime.addDuration(value, Duration.days(7));
	}
	return DateTime.add(value, { months: 1 });
};

const startOfBucket = (value: DateTime.DateTime, bucket: TimeSeriesBucket) =>
	DateTime.startOf(value, bucket);

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

export const alignDateRangeToBucket = (input: {
	bucket: TimeSeriesBucket;
	endAt: DateTime.DateTime;
	startAt: DateTime.DateTime;
}) => {
	const startAt = startOfBucket(input.startAt, input.bucket);
	const endAt = addBucket(
		startOfBucket(DateTime.subtractDuration(input.endAt, Duration.millis(1)), input.bucket),
		input.bucket,
	);
	return { endAt, startAt };
};

const isWithinHalfOpenRange = (value: DateTime.DateTime, range: TimeSeriesRange) =>
	!DateTime.lessThan(value, range.startAt) && DateTime.lessThan(value, range.endAt);

const numberFromAggregateValue = (value: FieldValue) =>
	typeof value.value === "number" ? value.value : 0;

export const executeTimeSeriesQuery = (
	userId: string,
	doc: TimeSeriesQueryDocument,
): Effect.Effect<TimeSeriesResponse, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const startAt = DateTime.make(doc.output.time.range.startAt);
		const endAt = DateTime.make(doc.output.time.range.endAt);
		if (Option.isNone(startAt) || Option.isNone(endAt)) {
			return { type: "timeSeries" as const, data: { buckets: [] } };
		}

		const groups = new Map<string, SourceMatch[]>();
		const range = { startAt: startAt.value, endAt: endAt.value };
		const matches = yield* executeRootSourceMatches(userId, doc.source, evalExprAsBoolean);

		for (const match of matches) {
			const rawValue = (yield* evalExprValue(userId, doc.output.time.expr, match.context)).value;
			const timeValue = parseTimeValue(rawValue);
			if (Option.isNone(timeValue) || !isWithinHalfOpenRange(timeValue.value, range)) {
				continue;
			}

			const bucketStart = startOfBucket(timeValue.value, doc.output.time.bucket);
			const bucketKey = DateTime.formatIso(bucketStart);
			const bucketMatches = groups.get(bucketKey);
			if (bucketMatches === undefined) {
				groups.set(bucketKey, [match]);
				continue;
			}
			bucketMatches.push(match);
		}

		const buckets: Array<TimeSeriesResponse["data"]["buckets"][number]> = [];
		const alignedRange = alignDateRangeToBucket({
			endAt: endAt.value,
			startAt: startAt.value,
			bucket: doc.output.time.bucket,
		});
		let cursor = alignedRange.startAt;
		while (DateTime.lessThan(cursor, alignedRange.endAt)) {
			const bucketKey = DateTime.formatIso(cursor);
			const next = addBucket(cursor, doc.output.time.bucket);
			const bucketMatches = groups.get(bucketKey) ?? [];
			const aggregateValue =
				bucketMatches.length === 0
					? { kind: "number" as const, value: 0 }
					: yield* evalAggregateMeasure(userId, bucketMatches, doc.output.measure.aggregation);
			buckets.push({
				startAt: bucketKey,
				endAt: DateTime.formatIso(next),
				value: numberFromAggregateValue(aggregateValue),
			});
			cursor = next;
		}

		return { type: "timeSeries" as const, data: { buckets } };
	});
