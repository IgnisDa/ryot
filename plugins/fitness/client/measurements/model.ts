import {
	REPORTING_BUCKET_LIMIT,
	resolveReportingSelection,
	type TimeZone,
} from "@ryot-app/plugin-client-sdk/plugin";

import { MEASUREMENT_PIN_LIMIT } from "../../shared/measurement-metric-operations";
import type { MeasurementSummary } from "../../shared/measurement-recipes";
import { formatNumber } from "../workout/format";
import type { MeasurementLogEntry } from "./queries";

export type RangeKey = "1M" | "3M" | "1Y" | "All";

export const DAY_MS = 86_400_000;
export const STALE_AFTER_DAYS = 45;

export const rangeOptions = [
	{ days: 30, key: "1M", phrase: "30 days" },
	{ days: 90, key: "3M", phrase: "3 months" },
	{ key: "1Y", days: 365, phrase: "12 months" },
	{ key: "All", days: null, phrase: "all time" },
] as const satisfies readonly {
	readonly key: RangeKey;
	readonly phrase: string;
	readonly days: null | number;
}[];

const rangeDays = (range: RangeKey) => rangeOptions.find(({ key }) => key === range)?.days ?? null;

export const rangePhrase = (range: RangeKey) =>
	rangeOptions.find(({ key }) => key === range)?.phrase ?? "";

export const measurementPeriod = (range: RangeKey, now: Date, timeZone: TimeZone) => {
	const days = rangeDays(range);
	return resolveReportingSelection(
		{
			grouping: "day",
			comparison: "none",
			range: days === null ? { kind: "all-time" } : { days, kind: "rolling" },
		},
		{ timeZone, now: now.getTime() },
	).current;
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
	const endAt = now.toISOString();
	const firstTimes = summaries.flatMap(({ firstAt }) =>
		firstAt === null ? [] : [Date.parse(firstAt)],
	);
	const earliest = firstTimes.length === 0 ? now.getTime() - DAY_MS : Math.min(...firstTimes);
	const spanDays = (now.getTime() - earliest) / DAY_MS;
	const coarseBucket =
		spanDays / 28 <= REPORTING_BUCKET_LIMIT ? ("month" as const) : ("year" as const);
	return {
		endAt,
		startAt: new Date(earliest).toISOString(),
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
	now.getTime() - Date.parse(latestAt) > STALE_AFTER_DAYS * DAY_MS;

export const unitSuffix = (unit: null | string) =>
	unit === null || unit === "" ? "" : ` (${unit})`;

export const formatValue = (value: number, unit: null | string) => {
	const text = formatNumber(value);
	if (unit === null || unit === "") {
		return text;
	}
	return unit === "%" ? `${text}%` : `${text} ${unit}`;
};

export const formatChange = (change: number, unit: null | string) => {
	if (formatNumber(Math.abs(change)) === "0") {
		return `±${formatValue(0, unit)}`;
	}
	return `${change > 0 ? "+" : "−"}${formatValue(Math.abs(change), unit)}`;
};

const dateFormat = (timeZone: TimeZone, withYear: boolean) =>
	new Intl.DateTimeFormat("en-GB", {
		timeZone,
		day: "numeric",
		month: "short",
		...(withYear ? { year: "numeric" } : {}),
	});

export const formatDay = (iso: string, timeZone: TimeZone, withYear = false) =>
	dateFormat(timeZone, withYear).format(Date.parse(iso));

export const formatTime = (iso: string, timeZone: TimeZone) =>
	new Intl.DateTimeFormat("en-GB", {
		timeZone,
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
	}).format(Date.parse(iso));

const monthFormat = (timeZone: TimeZone) =>
	new Intl.DateTimeFormat("en-GB", { timeZone, month: "long", year: "numeric" });

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
	groups: readonly ReadingGroup[],
	timeZone: TimeZone,
): readonly MonthSection[] => {
	const format = monthFormat(timeZone);
	const sections: Array<{ label: string; groups: ReadingGroup[] }> = [];
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
