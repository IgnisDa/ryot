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
		.replaceAll(/\s+/g, "_")
		.replaceAll(/[^a-z0-9_]/g, "")
		.replaceAll(/_+/g, "_")
		.replaceAll(/^_|_$/g, "");

export type MetricSort = "az" | "recent" | "changed";
type Points = readonly MeasurementSeries["points"][number][];
type TrendPoint = Omit<Points[number], "value"> & { readonly value: null | number };
type SeriesCalendar = Pick<Parameters<typeof measurementSeriesRecipe>[0], "bucket" | "timeZone">;

const trendWindow = (pointCount: number) => (pointCount > 40 ? 7 : 3);

const rollingAverage = (points: Points): Points => {
	const size = trendWindow(points.length);
	return points.map(({ at }, index) => {
		const window = points.slice(Math.max(0, index - size + 1), index + 1);
		return { at, value: window.reduce((sum, { value }) => sum + value, 0) / window.length };
	});
};

export const smoothRuns = <Point extends { readonly at: string; readonly value: null | number }>(
	points: readonly Point[],
	breaks: (previous: Point, next: Point) => boolean,
): ReadonlyArray<Point & { readonly smoothing: 3 | 7 | null }> => {
	const result: Array<Point & { readonly smoothing: 3 | 7 | null }> = [];
	let run: Array<{ readonly point: Point; readonly value: number }> = [];
	const flush = () => {
		const smoothing = trendWindow(run.length);
		const averages = rollingAverage(run.map(({ point, value }) => ({ value, at: point.at })));
		run.forEach(({ point }, index) =>
			result.push({ ...point, smoothing, value: averages[index]?.value ?? null }),
		);
		run = [];
	};
	for (const point of points) {
		const previous = run.at(-1)?.point;
		if (point.value === null) {
			flush();
			result.push({ ...point, smoothing: null });
			continue;
		}
		if (previous !== undefined && breaks(previous, point)) {
			flush();
		}
		run.push({ point, value: point.value });
	}
	flush();
	return result;
};

const smoothMeasurementSeries = (
	points: readonly TrendPoint[],
	{ bucket, timeZone }: SeriesCalendar,
): readonly TrendPoint[] => {
	const adjacent = (previous: TrendPoint, next: TrendPoint) =>
		addCalendarUnits(localDateOf(previous.at, timeZone), bucket, 1) ===
		localDateOf(next.at, timeZone);
	return smoothRuns(points, (left, right) => !adjacent(left, right)).flatMap(
		({ at, value }, index) => {
			const previous = points[index - 1];
			const point = { at, value };
			return previous?.value != null && value !== null && !adjacent(previous, point)
				? [
						{
							value: null,
							at: new Date((Date.parse(previous.at) + Date.parse(at)) / 2).toISOString(),
						},
						point,
					]
				: [point];
		},
	);
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
