import type { TimeSeriesPoint } from "@ryot-app/plugin-ui-sdk/charts";

import { MEASUREMENT_PIN_LIMIT } from "../../shared/measurement-metric-operations";
import type { MeasurementSeries, MeasurementSummary } from "../../shared/measurement-recipes";
import { formatNumber } from "../workout/format";
import type { MeasurementLogEntry } from "./queries";

export type RangeKey = "1M" | "3M" | "1Y" | "All";
export type MetricSort = "az" | "recent" | "changed";

export const DAY_MS = 86_400_000;
export const STALE_AFTER_DAYS = 45;
export const CHART_GAP_MS = 90 * DAY_MS;

const WEEK_MS = 7 * DAY_MS;
const MAX_SERIES_BUCKETS = 900;

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

export const rangeStartAt = (range: RangeKey, now: Date) => {
	const days = rangeDays(range);
	return new Date(days === null ? 0 : now.getTime() - days * DAY_MS).toISOString();
};

export const seriesWindow = (
	range: RangeKey,
	now: Date,
	summaries: readonly Pick<MeasurementSummary, "firstAt">[],
) => {
	const endAt = now.toISOString();
	if (range !== "All") {
		return { endAt, bucket: "day" as const, startAt: rangeStartAt(range, now) };
	}
	const firstTimes = summaries.flatMap(({ firstAt }) =>
		firstAt === null ? [] : [Date.parse(firstAt)],
	);
	const earliest = firstTimes.length === 0 ? now.getTime() - 365 * DAY_MS : Math.min(...firstTimes);
	return {
		endAt,
		bucket: "week" as const,
		startAt: new Date(
			Math.max(earliest, now.getTime() - MAX_SERIES_BUCKETS * WEEK_MS),
		).toISOString(),
	};
};

export const trendWindow = (pointCount: number) => (pointCount > 40 ? 7 : 3);

export const rollingAverage = (points: readonly TimeSeriesPoint[]): readonly TimeSeriesPoint[] => {
	const size = trendWindow(points.length);
	return points.map(({ at }, index) => {
		const window = points.slice(Math.max(0, index - size + 1), index + 1);
		return { at, value: window.reduce((sum, { value }) => sum + value, 0) / window.length };
	});
};

export type MetricRow = {
	readonly change: null | number;
	readonly relativeChange: number;
	readonly summary: MeasurementSummary;
	readonly trend: readonly TimeSeriesPoint[];
	readonly readings: readonly TimeSeriesPoint[];
};

export const buildMetricRows = (
	summaries: readonly MeasurementSummary[],
	series: readonly MeasurementSeries[],
): readonly MetricRow[] => {
	const pointsByMetric = new Map(series.map(({ points, metricId }) => [metricId, points]));
	return summaries.map((summary) => {
		const readings = pointsByMetric.get(summary.id) ?? [];
		const trend = rollingAverage(readings);
		const first = trend[0];
		const last = trend.at(-1);
		const change =
			first === undefined || last === undefined || trend.length < 2
				? null
				: last.value - first.value;
		return {
			trend,
			change,
			summary,
			readings,
			relativeChange:
				change === null || first === undefined || first.value === 0
					? -1
					: Math.abs(change / first.value),
		};
	});
};

const byRecency = (left: MeasurementSummary, right: MeasurementSummary) =>
	(right.latestAt === null ? -Infinity : Date.parse(right.latestAt)) -
	(left.latestAt === null ? -Infinity : Date.parse(left.latestAt));

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

export const sortMetricRows = (rows: readonly MetricRow[], sort: MetricSort) =>
	[...rows].sort((left, right) => {
		if (sort === "az") {
			return left.summary.name.localeCompare(right.summary.name);
		}
		if (sort === "changed") {
			return right.relativeChange - left.relativeChange || byRecency(left.summary, right.summary);
		}
		return (
			byRecency(left.summary, right.summary) || right.summary.rangeCount - left.summary.rangeCount
		);
	});

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

const dateFormat = (timeZone: string, withYear: boolean) =>
	new Intl.DateTimeFormat("en-GB", {
		timeZone,
		day: "numeric",
		month: "short",
		...(withYear ? { year: "numeric" } : {}),
	});

export const formatDay = (iso: string, timeZone: string, withYear = false) =>
	dateFormat(timeZone, withYear).format(Date.parse(iso));

export const formatTime = (iso: string, timeZone: string) =>
	new Intl.DateTimeFormat("en-GB", {
		timeZone,
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
	}).format(Date.parse(iso));

const monthFormat = (timeZone: string) =>
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
	timeZone: string,
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
