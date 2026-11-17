import { Array, DateTime, Duration } from "@ryot-app/plugin-client-sdk/effect";
import {
	addCalendarDays,
	calendarPeriod,
	localDateOf,
	REPORTING_BUCKET_LIMIT,
	type TimeZone,
} from "@ryot-app/plugin-client-sdk/plugin";
import type { Formatters } from "@ryot-app/plugin-client-sdk/react";

import { MEASUREMENT_PIN_LIMIT } from "../../shared/measurement-metric-operations";
import type { MeasurementSummary } from "../../shared/measurement-recipes";
import type { FitnessText } from "../messages";
import { formatNumber } from "../workout/format";
import type { MeasurementLogEntry } from "./queries";

export type RangeKey = "1M" | "3M" | "1Y" | "All";

const STALE_AFTER = Duration.days(45);

export const rangeOptions = [
	{ days: 30, key: "1M" },
	{ days: 90, key: "3M" },
	{ key: "1Y", days: 365 },
	{ key: "All", days: null },
] as const satisfies readonly { readonly key: RangeKey; readonly days: null | number }[];

const rangeDays = (range: RangeKey) => rangeOptions.find(({ key }) => key === range)?.days ?? null;

export const measurementSelection = (range: RangeKey) => {
	const days = rangeDays(range);
	return {
		grouping: "day" as const,
		comparison: "none" as const,
		range: days === null ? { kind: "all-time" as const } : { days, kind: "rolling" as const },
	};
};

export const measurementPeriod = (range: RangeKey, now: Date, timeZone: TimeZone) => {
	const days = rangeDays(range);
	if (days === null) {
		return null;
	}
	const today = localDateOf(now, timeZone);
	return calendarPeriod(addCalendarDays(today, 1 - days), today, timeZone);
};

export const seriesWindow = (
	range: RangeKey,
	now: Date,
	summaries: readonly Pick<MeasurementSummary, "firstAt">[],
	timeZone: TimeZone,
) => {
	const period = measurementPeriod(range, now, timeZone);
	if (period !== null) {
		return { endAt: period.endAt, bucket: "day" as const, startAt: period.startAt };
	}
	const end = DateTime.fromDateUnsafe(now);
	const firstTimes = summaries.flatMap(({ firstAt }) =>
		firstAt === null ? [] : [DateTime.makeUnsafe(firstAt)],
	);
	const earliest = Array.isArrayNonEmpty(firstTimes)
		? Array.min(firstTimes, DateTime.Order)
		: DateTime.subtract(end, { days: 1 });
	const spanDays = Duration.toDays(DateTime.distance(earliest, end));
	const coarseBucket =
		spanDays / 28 <= REPORTING_BUCKET_LIMIT ? ("month" as const) : ("year" as const);
	return {
		endAt: DateTime.formatIso(end),
		startAt: DateTime.formatIso(earliest),
		bucket: spanDays / 7 <= REPORTING_BUCKET_LIMIT ? ("week" as const) : coarseBucket,
	};
};

export const selectPinnedMetrics = (summaries: readonly MeasurementSummary[]) =>
	summaries
		.flatMap((summary) =>
			summary.pinnedAt === null ? [] : [{ summary, pinnedAt: Date.parse(summary.pinnedAt) }],
		)
		.sort(
			(left, right) =>
				left.pinnedAt - right.pinnedAt || left.summary.id.localeCompare(right.summary.id),
		)
		.slice(0, MEASUREMENT_PIN_LIMIT)
		.map(({ summary }) => summary);

export const isStale = (latestAt: string, now: Date) =>
	DateTime.isGreaterThan(
		DateTime.fromDateUnsafe(now),
		DateTime.addDuration(DateTime.makeUnsafe(latestAt), STALE_AFTER),
	);

export const nameWithUnit = (text: FitnessText, name: string, unit: null | string) =>
	unit === null || unit === "" ? name : text("client.measurements.name-with-unit", { name, unit });

export const formatValue = (
	formatters: Formatters,
	text: FitnessText,
	value: number,
	unit: null | string,
) => {
	if (unit === null || unit === "") {
		return formatNumber(formatters, value);
	}
	return unit === "%"
		? formatters.number({ style: "percent", maximumFractionDigits: 2 }).format(value / 100)
		: text("common.unit.value", { unit, value: formatNumber(formatters, value) });
};

export const formatChange = (
	formatters: Formatters,
	text: FitnessText,
	change: number,
	unit: null | string,
) => {
	if (formatNumber(formatters, Math.abs(change)) === "0") {
		return `±${formatValue(formatters, text, 0, unit)}`;
	}
	return `${change > 0 ? "+" : "−"}${formatValue(formatters, text, Math.abs(change), unit)}`;
};

const dateFormat = (formatters: Formatters, timeZone: TimeZone, withYear: boolean) =>
	formatters.dateTime({
		timeZone,
		day: "numeric",
		month: "short",
		...(withYear ? { year: "numeric" } : {}),
	});

export const formatDay = (
	formatters: Formatters,
	iso: string,
	timeZone: TimeZone,
	withYear = false,
) => dateFormat(formatters, timeZone, withYear).format(Date.parse(iso));

export const formatTime = (formatters: Formatters, iso: string, timeZone: TimeZone) =>
	formatters
		.dateTime({ timeZone, hour12: false, hour: "2-digit", minute: "2-digit" })
		.format(Date.parse(iso));

const monthFormat = (formatters: Formatters, timeZone: TimeZone) =>
	formatters.dateTime({ timeZone, month: "long", year: "numeric" });

export type ReadingValue = {
	readonly id: string;
	readonly value: number;
	readonly metricId: string;
	readonly previous: null | number;
};

export type ReadingGroup = {
	readonly id: string;
	readonly occurredAt: string;
	readonly comment: null | string;
	readonly values: ReadonlyMap<string, ReadingValue>;
};

export const groupReadings = (entries: readonly MeasurementLogEntry[]): readonly ReadingGroup[] => {
	const lastValue = new Map<string, number>();
	return [...entries]
		.sort(
			(left, right) =>
				Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
				right.id.localeCompare(left.id),
		)
		.map(({ id, comment, readings, occurredAt }) => {
			const values = new Map(
				readings.map((reading) => {
					const previous = lastValue.get(reading.metricId) ?? null;
					lastValue.set(reading.metricId, reading.value);
					return [
						reading.metricId,
						{ previous, id: reading.id, value: reading.value, metricId: reading.metricId },
					] as const;
				}),
			);
			return { id, values, comment, occurredAt };
		})
		.sort(
			(left, right) =>
				Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
				left.id.localeCompare(right.id),
		);
};

export type MonthSection = { readonly label: string; readonly groups: readonly ReadingGroup[] };

export const groupByMonth = (
	formatters: Formatters,
	groups: readonly ReadingGroup[],
	timeZone: TimeZone,
): readonly MonthSection[] => {
	const format = monthFormat(formatters, timeZone);
	const sections: { label: string; groups: ReadingGroup[] }[] = [];
	for (const group of groups) {
		const label = format.format(Date.parse(group.occurredAt));
		const current = sections.at(-1);
		if (current?.label === label) {
			current.groups.push(group);
		} else {
			sections.push({ label, groups: [group] });
		}
	}
	return sections;
};
