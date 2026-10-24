import { addCalendarUnits, localDateOf } from "@ryot-app/plugin-kit/schema";

import type {
	MeasurementSeries,
	measurementSeriesRecipe,
	MeasurementSummary,
} from "./measurement-recipes";

const measurementMetricUnits = new Map([
	["fat", "%"],
	["hip", "cm"],
	["lbm", "kg"],
	["bone", "kg"],
	["water", "%"],
	["muscle", "%"],
	["waist", "cm"],
	["bmi", "kg/m²"],
	["weight", "kg"],
]);

export const measurementMetricUnit = (key: string) => measurementMetricUnits.get(key);

export const measurementMetricKey = (name: string) =>
	name
		.toLowerCase()
		.trim()
		.replace(/\s+/g, "_")
		.replace(/[^a-z0-9_]/g, "")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "");

export type MetricSort = "az" | "recent" | "changed";
type Points = readonly MeasurementSeries["points"][number][];
type TrendPoint = Omit<Points[number], "value"> & { readonly value: null | number };
type SeriesCalendar = Pick<Parameters<typeof measurementSeriesRecipe>[0], "bucket" | "timeZone">;

export const trendWindow = (pointCount: number) => (pointCount > 40 ? 7 : 3);

export const rollingAverage = (points: Points): Points => {
	const size = trendWindow(points.length);
	return points.map(({ at }, index) => {
		const window = points.slice(Math.max(0, index - size + 1), index + 1);
		return { at, value: window.reduce((sum, { value }) => sum + value, 0) / window.length };
	});
};

export const smoothMeasurementSeries = (
	points: readonly TrendPoint[],
	{ bucket, timeZone }: SeriesCalendar,
): readonly TrendPoint[] => {
	const adjacent = (previous: string, next: string) =>
		addCalendarUnits(localDateOf(previous, timeZone), bucket, 1) === localDateOf(next, timeZone);
	const trend: TrendPoint[] = [];
	let run: MeasurementSeries["points"][number][] = [];
	const flush = () => {
		trend.push(...rollingAverage(run));
		run = [];
	};
	for (const point of points) {
		if (point.value === null) {
			flush();
			trend.push(point);
			continue;
		}
		const previous = run.at(-1);
		if (previous !== undefined && !adjacent(previous.at, point.at)) {
			flush();
			trend.push({
				value: null,
				at: new Date((Date.parse(previous.at) + Date.parse(point.at)) / 2).toISOString(),
			});
		}
		run.push({ at: point.at, value: point.value });
	}
	flush();
	return trend;
};

export type MetricRow = {
	readonly averages: Points;
	readonly change: null | number;
	readonly summary: MeasurementSummary;
	readonly trend: readonly TrendPoint[];
	readonly relativeChange: null | number;
};

export const buildMetricRows = (
	summaries: readonly MeasurementSummary[],
	series: readonly MeasurementSeries[],
	calendar: SeriesCalendar,
): readonly MetricRow[] => {
	const pointsByMetric = new Map(series.map(({ points, metricId }) => [metricId, points]));
	return summaries.map((summary) => {
		const averages = pointsByMetric.get(summary.id) ?? [];
		const trend = smoothMeasurementSeries(averages, calendar);
		const first = trend[0];
		const last = trend.at(-1);
		const change =
			first?.value == null || last?.value == null || averages.length < 2
				? null
				: last.value - first.value;
		return {
			trend,
			change,
			summary,
			averages,
			relativeChange:
				change === null || first?.value == null || first.value === 0
					? null
					: Math.abs(change / first.value),
		};
	});
};

const byRecency = (left: MeasurementSummary, right: MeasurementSummary) =>
	(right.latestAt === null ? -Infinity : Date.parse(right.latestAt)) -
	(left.latestAt === null ? -Infinity : Date.parse(left.latestAt));

export const sortMetricRows = (rows: readonly MetricRow[], sort: MetricSort) =>
	[...rows].sort((left, right) => {
		if (sort === "az") {
			return left.summary.name.localeCompare(right.summary.name);
		}
		if (sort === "changed") {
			return (
				(right.relativeChange ?? -Infinity) - (left.relativeChange ?? -Infinity) ||
				byRecency(left.summary, right.summary)
			);
		}
		return (
			byRecency(left.summary, right.summary) || right.summary.rangeCount - left.summary.rangeCount
		);
	});
