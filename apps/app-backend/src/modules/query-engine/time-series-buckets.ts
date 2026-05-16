import { DateTime, Duration } from "effect";

import type { TimeSeriesOutput } from "./language";

export type TimeSeriesBucket = TimeSeriesOutput["time"]["bucket"];

export const addTimeSeriesBucket = (value: DateTime.DateTime, bucket: TimeSeriesBucket) => {
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

export const startOfTimeSeriesBucket = (value: DateTime.DateTime, bucket: TimeSeriesBucket) =>
	DateTime.startOf(value, bucket, { weekStartsOn: 1 });

export const alignDateRangeToBucket = (input: {
	bucket: TimeSeriesBucket;
	endAt: DateTime.DateTime;
	startAt: DateTime.DateTime;
}) => {
	const startAt = startOfTimeSeriesBucket(input.startAt, input.bucket);
	const endAt = addTimeSeriesBucket(
		startOfTimeSeriesBucket(
			DateTime.subtractDuration(input.endAt, Duration.millis(1)),
			input.bucket,
		),
		input.bucket,
	);
	return { endAt, startAt };
};

export const countAlignedTimeSeriesBuckets = (input: {
	bucket: TimeSeriesBucket;
	endAt: DateTime.DateTime;
	startAt: DateTime.DateTime;
}) => {
	const alignedRange = alignDateRangeToBucket(input);
	let count = 0;
	let cursor = alignedRange.startAt;
	while (DateTime.lessThan(cursor, alignedRange.endAt)) {
		count += 1;
		cursor = addTimeSeriesBucket(cursor, input.bucket);
	}
	return count;
};
