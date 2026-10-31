import {
	addCalendarDays,
	calendarDaysBetween,
	isCalendarDate,
} from "@ryot-app/contract/modules/analytics/calendar";
import { type TimeZone, UTC } from "@ryot-app/contract/schema/time-zone";
import { areaY, barY, defineChart, dot, lineY } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import { Chart } from "@tanstack/charts/react/tooltip";
import { cell } from "@tanstack/charts/rect";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { portal } from "@tanstack/charts/tooltip/portal";
import clsx from "clsx";
import { DateTime } from "effect";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { Button } from "./button";
import {
	axisTicks,
	formatAxisValue,
	formatMetric,
	formatNumber,
	type MetricUnit,
	REPORTING_LOCALE,
} from "./metric-format";
import { SegmentedControl } from "./segmented-control";
import { DataTable, type DataTableColumn } from "./table";

const DAY_MS = 86_400_000;
const LEVELS = [0, 1, 2, 3, 4, 5] as const;
const LEVEL_COLORS = LEVELS.map((level) => `var(--chart-seq-${level})`);
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const MIN_MONTH_LABEL_GAP_WEEKS = 3;
const reportingStyles = {
	year: { year: "numeric" },
	month: { month: "short" },
	weekday: { weekday: "short" },
	day: { day: "numeric", month: "short" },
	monthYear: { month: "long", year: "numeric" },
	date: { day: "numeric", month: "short", year: "numeric" },
	dateTime: { day: "numeric", month: "short", hour: "numeric", year: "numeric", minute: "2-digit" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;
const reportingFormats = new Map<string, Intl.DateTimeFormat>();

const reportingFormat = (style: keyof typeof reportingStyles, timeZone: string) => {
	const key = `${timeZone}:${style}`;
	let format = reportingFormats.get(key);
	if (format === undefined) {
		format = new Intl.DateTimeFormat(REPORTING_LOCALE, { ...reportingStyles[style], timeZone });
		reportingFormats.set(key, format);
	}
	return format;
};

/** Date-only values carry no zone, so they format in UTC to keep their calendar date. */
const reportingDate = (
	at: string,
	timeZone: TimeZone,
	style: keyof typeof reportingStyles = "date",
) => reportingFormat(style, isCalendarDate(at) ? UTC : timeZone).format(new Date(at));

export const formatReportingDateTime = (at: string, timeZone: TimeZone) =>
	reportingFormat("dateTime", timeZone).format(new Date(at));

type ChartGrouping = "day" | "week" | "year" | "month";

const bucketLabel = (
	at: string,
	grouping: ChartGrouping,
	timeZone: TimeZone,
	form: "axis" | "full" | "axis-multi-year",
) => {
	if (grouping === "year") {
		return reportingDate(at, timeZone, "year");
	}
	if (grouping === "month") {
		if (form === "full") {
			return reportingDate(at, timeZone, "monthYear");
		}
		const month = reportingDate(at, timeZone, "month");
		return form === "axis" ? month : `${month} ’${reportingDate(at, timeZone, "year").slice(-2)}`;
	}
	if (form !== "full") {
		return reportingDate(at, timeZone, "day");
	}
	const date = reportingDate(at, timeZone, "date");
	return grouping === "week" ? `Week of ${date}` : date;
};

const useElementWidth = () => {
	const [element, setElement] = useState<null | HTMLElement>(null);
	const [width, setWidth] = useState<null | number>(null);
	useEffect(() => {
		if (element === null || typeof ResizeObserver === "undefined") {
			return undefined;
		}
		const observer = new ResizeObserver(([entry]) => {
			if (entry !== undefined && entry.contentRect.width > 0) {
				setWidth(entry.contentRect.width);
			}
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [element]);
	return [setElement, width] as const;
};

export type CalendarHeatmapLevel = (typeof LEVELS)[number];

/** One calendar day: `date` is `YYYY-MM-DD`; `null` is an unknown amount, not zero. */
export type CalendarHeatmapDay = { readonly date: string; readonly value: null | number };

export type CalendarHeatmapProps<Day extends CalendarHeatmapDay> = {
	/** First row of each week column: 0 = Sunday, 1 = Monday. */
	readonly weekStart: 0 | 1;
	/** Smaller cells for touch layouts. */
	readonly compact: boolean;
	/** Formats tooltips, totals, and the exact-value table. */
	readonly unit: MetricUnit;
	/** Accessible chart name. */
	readonly ariaLabel: string;
	/** Every day to show, in any order. Missing dates and null values render as gaps. */
	readonly days: ReadonlyArray<Day>;
	readonly onSelect?: undefined | ((day: Day) => void);
};

type CalendarCell<Day> = {
	readonly day: Day;
	readonly date: string;
	readonly week: number;
	readonly weekday: number;
	readonly level: CalendarHeatmapLevel;
};

const calendarParts = (date: string) => DateTime.toParts(DateTime.makeUnsafe(date));

const leadingDays = (date: string, weekStart: 0 | 1) =>
	(calendarParts(date).weekDay - weekStart + 7) % 7;

/** Level 0 is no activity; positive values split into five equal bands of the maximum value. */
const levelOf = (value: number, max: number): CalendarHeatmapLevel =>
	value <= 0 ? 0 : (LEVELS[Math.min(5, Math.ceil((value / max) * 5))] ?? 5);

const calendarCells = <Day extends CalendarHeatmapDay>(
	days: ReadonlyArray<Day>,
	weekStart: 0 | 1,
) => {
	const sorted = [...days].sort((left, right) => left.date.localeCompare(right.date));
	const first = sorted[0];
	if (first === undefined) {
		return { weeks: 0, cells: [], days: sorted };
	}
	const leading = leadingDays(first.date, weekStart);
	const max = Math.max(0, ...sorted.map(({ value }) => value ?? 0));
	const cells = sorted.flatMap((day): ReadonlyArray<CalendarCell<Day>> => {
		const offset = calendarDaysBetween(first.date, day.date) + leading;
		return day.value === null
			? []
			: [
					{
						day,
						date: day.date,
						weekday: offset % 7,
						week: Math.floor(offset / 7),
						level: levelOf(day.value, max),
					},
				];
	});
	const last = sorted.at(-1) ?? first;
	return {
		cells,
		days: sorted,
		weeks: Math.floor((calendarDaysBetween(first.date, last.date) + leading) / 7) + 1,
	};
};

const monthLabels = (days: ReadonlyArray<CalendarHeatmapDay>, weekStart: 0 | 1) => {
	const first = days[0];
	const last = days.at(-1);
	if (first === undefined || last === undefined) {
		return [];
	}
	const leading = leadingDays(first.date, weekStart);
	const labels: { readonly week: number; readonly label: string }[] = [];
	for (let offset = 0; offset <= calendarDaysBetween(first.date, last.date); offset++) {
		const date = addCalendarDays(first.date, offset);
		const previous = labels.at(-1);
		const week = Math.floor((offset + leading) / 7);
		if (
			((offset === 0 && calendarParts(date).day <= 15) || calendarParts(date).day === 1) &&
			(previous === undefined || week - previous.week >= MIN_MONTH_LABEL_GAP_WEEKS)
		) {
			labels.push({ week, label: reportingFormat("month", UTC).format(new Date(date)) });
		}
	}
	return labels;
};

const activityRuns = (days: ReadonlyArray<CalendarHeatmapDay>) => {
	let active = 0;
	let longest = 0;
	let run = 0;
	let previous: null | string = null;
	for (const day of days) {
		const continues = previous !== null && calendarDaysBetween(previous, day.date) === 1;
		if ((day.value ?? 0) > 0) {
			active++;
			run = continues || previous === null ? run + 1 : 1;
			longest = Math.max(longest, run);
		} else {
			run = 0;
		}
		previous = day.date;
	}
	return { active, longest, latest: run, total: days.length };
};

const reportingValue = (point: ReportingChartValue, unit: MetricUnit) =>
	point.value === null ? "Not recorded" : formatMetric(point.value, unit);

const tooltipValue = (point: ReportingChartValue, unit: MetricUnit) =>
	[reportingValue(point, unit), point.detail].filter(Boolean).join(" · ");

/** A timestamped value; `null` marks a line break, not a known zero. */
export type TimeSeriesPoint = { readonly at: string; readonly value: null | number };

/** One ranked row; `key` must be unique and stable. */
export type RankedBarListRow = {
	readonly key: string;
	readonly label: string;
	readonly value: number;
};

export type RankedBarListProps = {
	readonly rows: ReadonlyArray<RankedBarListRow>;
	/** Text shown beside each bar, such as a percentage or count. */
	readonly formatValue: (row: RankedBarListRow) => string;
};

export type SparklineProps = {
	readonly ariaLabel: string;
	/** `accent` draws in the chart accent color, `muted` in a neutral. */
	readonly tone: "muted" | "accent";
	readonly points: ReadonlyArray<TimeSeriesPoint>;
};

type SeriesRow = { readonly ms: number; readonly value: null | number };

type CoverageSegment = {
	readonly key: string;
	readonly label: string;
	readonly value: number;
	/** `solid` for the primary share, `soft` for a secondary share, `empty` for what is missing. */
	readonly tone: "soft" | "solid" | "empty";
};

/** Rows sorted by descending value, each with a single-hue bar scaled to the largest value. */
export function RankedBarList({ rows, formatValue }: RankedBarListProps) {
	const ranked = [...rows].sort((left, right) => right.value - left.value);
	const max = Math.max(0, ...ranked.map(({ value }) => value));
	return (
		<ol className="flex flex-col gap-3">
			{ranked.map((row) => (
				<li key={row.key} className="flex flex-col gap-1">
					<div className="flex items-baseline justify-between gap-3 text-sm">
						<span className="min-w-0 truncate text-text">{row.label}</span>
						<span className="shrink-0 text-text-muted tabular-nums">{formatValue(row)}</span>
					</div>
					<div aria-hidden="true" className="h-2 overflow-hidden rounded-pill bg-chart-seq-0">
						<div
							className="h-full rounded-pill bg-chart-accent"
							style={{ width: `${max > 0 ? (Math.max(0, row.value) / max) * 100 : 0}%` }}
						/>
					</div>
				</li>
			))}
		</ol>
	);
}

const coverageTones = {
	soft: "bg-chart-seq-2",
	solid: "bg-chart-accent",
	empty: "bg-border-emphasis",
} as const;

export function CoverageBar(props: {
	readonly ariaLabel: string;
	readonly segments: ReadonlyArray<CoverageSegment>;
	readonly formatValue: (segment: CoverageSegment) => string;
}) {
	const total = props.segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
	return (
		<div className="flex min-w-0 flex-col gap-1.5">
			<div
				role="img"
				className="flex h-1.5 overflow-hidden rounded-pill bg-chart-seq-0"
				aria-label={`${props.ariaLabel}: ${props.segments
					.map((segment) => `${segment.label} ${props.formatValue(segment)}`)
					.join(", ")}`}
			>
				{total === 0
					? null
					: props.segments.map((segment) =>
							segment.value > 0 ? (
								<div
									key={segment.key}
									className={coverageTones[segment.tone]}
									style={{ width: `${(segment.value / total) * 100}%` }}
								/>
							) : null,
						)}
			</div>
			<ul aria-hidden="true" className="flex flex-wrap gap-x-3 gap-y-1 text-micro text-text-subtle">
				{props.segments.map((segment) => (
					<li key={segment.key} className="inline-flex items-center gap-1">
						<span className={clsx("size-2 rounded-xs", coverageTones[segment.tone])} />
						{segment.label} {props.formatValue(segment)}
					</li>
				))}
			</ul>
		</div>
	);
}

const WEEKDAY_LABEL_WIDTH = 28;
const MONTH_LABEL_HEIGHT = 16;
const MAX_CELL_PITCH = 26;
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const dayUnit: MetricUnit = { one: "day", kind: "count", other: "days" };

export function CalendarHeatmap<Day extends CalendarHeatmapDay>({
	days,
	unit,
	compact,
	onSelect,
	ariaLabel,
	weekStart,
}: CalendarHeatmapProps<Day>) {
	const layout = useMemo(() => calendarCells(days, weekStart), [days, weekStart]);
	const months = useMemo(() => monthLabels(layout.days, weekStart), [layout.days, weekStart]);
	const runs = useMemo(() => activityRuns(layout.days), [layout.days]);
	const [measure, width] = useElementWidth();
	const [view, setView] = useState<ChartView>("chart");
	const fallbackPitch = compact ? 12 : 15;
	const pitch =
		width === null || layout.weeks === 0
			? fallbackPitch
			: Math.max(
					fallbackPitch - 3,
					Math.min(MAX_CELL_PITCH, Math.floor((width - WEEKDAY_LABEL_WIDTH) / layout.weeks)),
				);
	const definition = useMemo(
		() =>
			defineChart({
				color: { domain: LEVELS, range: LEVEL_COLORS },
				tooltip: { portal, use: tooltip, anchor: "point", placement: ["top", "bottom"] },
				marks: [
					cell(layout.cells, {
						x: "week",
						radius: 2,
						inset: 1.5,
						y: "weekday",
						color: "level",
						key: (day) => day.date,
					}),
				],
				scales: {
					y: { axis: false, scale: scaleBand<number>().domain(WEEKDAYS) },
					x: {
						axis: false,
						scale: scaleBand<number>().domain(Array.from({ length: layout.weeks }, (_, i) => i)),
					},
				},
			}),
		[layout],
	);

	const chartWidth = pitch * layout.weeks;

	if (layout.days.length === 0) {
		return null;
	}
	return (
		<div ref={measure} className="flex min-w-0 flex-col gap-3 text-text">
			<ChartToolbar view={view} ariaLabel={ariaLabel} onViewChange={setView}>
				<dl className="flex flex-wrap gap-x-5 gap-y-1 text-label">
					<div className="flex gap-1.5">
						<dt className="text-text-muted">Active days</dt>
						<dd className="font-medium tabular-nums">
							{formatNumber(runs.active)} of {formatNumber(runs.total)}
						</dd>
					</div>
					<div className="flex gap-1.5">
						<dt className="text-text-muted">Longest streak</dt>
						<dd className="font-medium tabular-nums">{formatMetric(runs.longest, dayUnit)}</dd>
					</div>
				</dl>
			</ChartToolbar>
			{view === "table" ? (
				<ExactValuesTable
					headers={["Value"]}
					ariaLabel={ariaLabel}
					rows={layout.days.map((day) => {
						const period = reportingDate(day.date, UTC);
						return {
							period,
							key: day.date,
							cells: [
								{
									label: period,
									value: reportingValue(day, unit),
									select: onSelect && day.value !== null ? () => onSelect(day) : undefined,
								},
							],
						};
					})}
				/>
			) : (
				<>
					{/* Reversed flow makes the scroller start at its end, so the newest week shows without measuring layout. */}
					<div className="flex w-fit max-w-full flex-row-reverse overflow-x-auto">
						<div className="flex shrink-0">
							<div
								aria-hidden="true"
								className="shrink-0 text-micro text-text-subtle"
								style={{ width: WEEKDAY_LABEL_WIDTH, paddingTop: MONTH_LABEL_HEIGHT }}
							>
								{WEEKDAYS.map((row) => {
									const weekday = (weekStart + row) % 7;
									return (
										<div key={row} style={{ height: pitch }} className="flex items-center">
											{weekday % 2 === 1 ? WEEKDAY_NAMES[weekday] : null}
										</div>
									);
								})}
							</div>
							<div className="shrink-0" style={{ width: chartWidth }}>
								<div
									aria-hidden="true"
									style={{ height: MONTH_LABEL_HEIGHT }}
									className="relative text-micro text-text-subtle"
								>
									{months.map(({ week, label }) => (
										<span
											key={`${week}-${label}`}
											className="absolute top-0"
											style={{ left: week * pitch + 1.5 }}
										>
											{label}
										</span>
									))}
								</div>
								<Chart
									width={chartWidth}
									height={pitch * 7}
									ariaLabel={ariaLabel}
									definition={definition}
									onSelect={(point) => {
										if (point) {
											onSelect?.(point.datum.day);
										}
									}}
									renderTooltipBody={({ points }) => {
										const hovered = points[0]?.datum;
										return hovered === undefined
											? null
											: `${reportingValue(hovered.day, unit)} · ${reportingDate(hovered.date, UTC)}`;
									}}
								/>
							</div>
						</div>
					</div>
					<div aria-hidden="true" className="flex items-center gap-1 text-micro text-text-subtle">
						<span className="mr-1">Less</span>
						{LEVEL_COLORS.map((color) => (
							<span
								key={color}
								className="size-2.5 rounded-xs"
								style={{ backgroundColor: color }}
							/>
						))}
						<span className="ml-1">More</span>
					</div>
				</>
			)}
		</div>
	);
}
const ACCENT_COLOR = "var(--chart-accent)";
const SPARKLINE_WIDTH = 96;
const SPARKLINE_HEIGHT = 28;
const SPARKLINE_INSET = 3;
const TONE_COLORS = { accent: ACCENT_COLOR, muted: "var(--border-strong)" } as const;

const chronological = (points: ReadonlyArray<TimeSeriesPoint>): ReadonlyArray<SeriesRow> =>
	points.map(({ at, value }) => ({ value, ms: Date.parse(at) })).sort((a, b) => a.ms - b.ms);

export type TimeSeriesChartSeries = {
	readonly label: string;
	/** Precomputed smoothed values, drawn as the emphasised line. */
	readonly trend: ReadonlyArray<TimeSeriesPoint>;
	readonly formatValue: (value: number) => string;
	/** Raw observations, drawn as faint dots. */
	readonly readings: ReadonlyArray<TimeSeriesPoint>;
};

export type TimeSeriesChartProps = {
	/** Trend lines break between consecutive trend points further apart than this. */
	readonly gapMs: number;
	/** Smaller height for touch layouts. */
	readonly compact: boolean;
	readonly ariaLabel: string;
	readonly primary: TimeSeriesChartSeries;
	/** Drawn against its own right-hand axis. */
	readonly compare?: TimeSeriesChartSeries;
	/** X domain as ISO datetimes. */
	readonly range: { readonly endAt: string; readonly startAt: string };
};

/** A fixed-size trend line with a soft area fill and an emphasised last point; no axes or tooltip. */
export function Sparkline({ tone, points, ariaLabel }: SparklineProps) {
	const rows = useMemo(() => chronological(points), [points]);
	const knownRows = useMemo(() => rows.filter((row) => row.value !== null), [rows]);
	const definition = useMemo(() => {
		const color = TONE_COLORS[tone];
		const last = knownRows.slice(-1);
		const knownValues = rows.flatMap(({ value }) => (value === null ? [] : [value]));
		const floor = knownValues.length === 0 ? 0 : Math.min(...knownValues);
		return defineChart({
			guides: false,
			pointer: false,
			tooltip: false,
			keyboard: false,
			margin: SPARKLINE_INSET,
			scales: { x: { axis: false, scale: scaleLinear }, y: { axis: false, scale: scaleLinear } },
			marks: [
				areaY(rows, { x: "ms", y1: floor, fill: color, y2: "value", fillOpacity: 0.16 }),
				lineY(rows, { x: "ms", y: "value", stroke: color, strokeWidth: 1.5 }),
				dot(last, { r: 2.5, x: "ms", y: "value", fill: color }),
			],
		});
	}, [knownRows, rows, tone]);

	if (knownRows.length < 2) {
		return (
			<span
				role="img"
				aria-label={ariaLabel}
				className="inline-block"
				style={{ width: SPARKLINE_WIDTH, height: SPARKLINE_HEIGHT }}
			/>
		);
	}
	return (
		<Chart
			tabIndex={-1}
			ariaLabel={ariaLabel}
			definition={definition}
			width={SPARKLINE_WIDTH}
			height={SPARKLINE_HEIGHT}
		/>
	);
}

const COMPARE_COLOR = "var(--info)";
const COMPARE_WINDOW_MS = 2 * DAY_MS;
const TIME_AXIS_STEPS_DAYS = [1, 2, 7, 14] as const;
const TIME_AXIS_STEPS_MONTHS = [1, 2, 3, 6, 12] as const;
const TIME_AXIS_MAX_TICKS = 6;

const withGaps = (rows: ReadonlyArray<SeriesRow>, gapMs: number): ReadonlyArray<SeriesRow> =>
	rows.flatMap((row, index) => {
		const previous = rows[index - 1];
		return previous !== undefined && row.ms - previous.ms > gapMs
			? [{ ms: row.ms, value: null }, row]
			: [row];
	});

const dateFormat = new Intl.DateTimeFormat(REPORTING_LOCALE, { day: "numeric", month: "short" });
const monthFormat = new Intl.DateTimeFormat(REPORTING_LOCALE, { month: "short", year: "2-digit" });
const fullDateFormat = new Intl.DateTimeFormat(REPORTING_LOCALE, {
	day: "numeric",
	month: "short",
	year: "numeric",
});

const nearestRow = (rows: ReadonlyArray<SeriesRow>, ms: number, within: number) =>
	rows.reduce<SeriesRow | undefined>((best, row) => {
		const distance = Math.abs(row.ms - ms);
		return distance <= within && (best === undefined || distance < Math.abs(best.ms - ms))
			? row
			: best;
	}, undefined);

const timeTicks = (startMs: number, endMs: number): ReadonlyArray<number> => {
	const spanDays = (endMs - startMs) / DAY_MS;
	const start = new Date(startMs);
	const ticksFor = (advance: (date: Date, step: number) => Date, first: Date, step: number) => {
		const ticks: number[] = [];
		for (let date = first; date.getTime() <= endMs; date = advance(date, step)) {
			if (date.getTime() >= startMs) {
				ticks.push(date.getTime());
			}
		}
		return ticks;
	};
	const dayStep = TIME_AXIS_STEPS_DAYS.find((step) => spanDays / step <= TIME_AXIS_MAX_TICKS);
	if (dayStep !== undefined) {
		return ticksFor(
			(date, step) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + step),
			new Date(start.getFullYear(), start.getMonth(), start.getDate()),
			dayStep,
		);
	}
	const monthStep =
		TIME_AXIS_STEPS_MONTHS.find((step) => spanDays / (30.4 * step) <= TIME_AXIS_MAX_TICKS) ?? 12;
	return ticksFor(
		(date, step) => new Date(date.getFullYear(), date.getMonth() + step, 1),
		new Date(start.getFullYear(), start.getMonth(), 1),
		monthStep,
	);
};

type SeriesRows = {
	readonly trend: ReadonlyArray<SeriesRow>;
	readonly readings: ReadonlyArray<SeriesRow>;
};

const seriesRows = (series: TimeSeriesChartSeries): SeriesRows => ({
	trend: chronological(series.trend),
	readings: chronological(series.readings),
});

export type ChartView = "chart" | "table";

export type PeriodTrendPoint = ReportingChartValue & {
	/** A reporting bucket's ISO instant or YYYY-MM-DD calendar date. */
	readonly at: string;
};

export type HourlyHistogramBucket = ReportingChartValue & {
	/** Local reporting hour, 0–23, already aggregated in timeZone. */
	readonly hour: number;
};

export type ReportingChartValue = {
	readonly value: null | number;
	/** Quantity coverage, estimate provenance, or other domain-owned context. */
	readonly detail?: string | undefined;
};

export type HourlyHistogramProps<Bucket extends HourlyHistogramBucket> = ReportingChartProps & {
	/** Omitted hours are missing, not zero. Supply explicit zeros for known empty hours. */
	readonly buckets: ReadonlyArray<Bucket>;
	readonly onSelect?: undefined | ((bucket: Bucket) => void);
};

export type PeriodTrendChartProps<Point extends PeriodTrendPoint> = ReportingChartProps & {
	readonly label: string;
	/** Bars suit per-bucket totals; lines suit levels such as averages. Defaults to bars. */
	readonly mark?: "bar" | "line";
	/** Resolved bucket size; it chooses axis and tooltip date formats. */
	readonly grouping: ChartGrouping;
	/** Ordered buckets. Include null values to preserve missing-data gaps. */
	readonly current: ReadonlyArray<Point>;
	readonly onSelect?: undefined | ((point: Point, period: "current" | "previous") => void);
	/** Same-unit buckets aligned to `current` by index; a longer period extends the x-axis. */
	readonly previous?: undefined | { readonly label: string; readonly points: ReadonlyArray<Point> };
};

type ExactRow = {
	readonly key: string;
	readonly period: string;
	readonly cells: ReadonlyArray<null | ExactCell>;
};

type ExactCell = {
	readonly label: string;
	readonly value: string;
	readonly detail?: string | undefined;
	readonly select?: undefined | (() => void);
};

type PeriodChartRow<Point> = {
	readonly point: Point;
	readonly index: number;
	readonly value: null | number;
	readonly period: "current" | "previous";
};

type ReportingChartProps = {
	readonly compact: boolean;
	/** Formats axes, tooltips, and the exact-value table. */
	readonly unit: MetricUnit;
	readonly ariaLabel: string;
	readonly timeZone: TimeZone;
	/** Hold the Chart/Table choice above a query boundary so it survives reloads; uncontrolled otherwise. */
	readonly view?:
		undefined | { readonly value: ChartView; readonly onChange: (view: ChartView) => void };
};

const useChartView = (controlled: ReportingChartProps["view"]) => {
	const [own, setOwn] = useState<ChartView>("chart");
	return controlled === undefined
		? ([own, setOwn] as const)
		: ([controlled.value, controlled.onChange] as const);
};

/** Readings, a smoothed trend and an optional second series on its own right-hand axis. */
export function TimeSeriesChart({
	gapMs,
	range,
	compare,
	primary,
	compact,
	ariaLabel,
}: TimeSeriesChartProps) {
	const startMs = Date.parse(range.startAt);
	const endMs = Date.parse(range.endAt);
	const primaryRows = useMemo(() => seriesRows(primary), [primary]);
	const compareRows = useMemo(() => (compare ? seriesRows(compare) : undefined), [compare]);
	const definition = useMemo(() => {
		const values = primaryRows.readings.flatMap(({ value }) => (value === null ? [] : [value]));
		const band =
			values.length === 0
				? []
				: [
						decorative(
							areaY(
								[startMs, endMs].map((ms) => ({ ms })),
								{
									x: "ms",
									fillOpacity: 0.1,
									fill: ACCENT_COLOR,
									y1: Math.min(...values),
									y2: Math.max(...values),
								},
							),
						),
					];
		const primaryMarks = [
			...band,
			decorative(
				lineY(withGaps(primaryRows.trend, gapMs), {
					x: "ms",
					y: "value",
					strokeWidth: 2,
					stroke: ACCENT_COLOR,
				}),
			),
			decorative(
				dot(primaryRows.trend.filter(({ value }) => value !== null).slice(-1), {
					r: 4,
					x: "ms",
					y: "value",
					fill: ACCENT_COLOR,
				}),
			),
			dot(primaryRows.readings, {
				r: 2,
				x: "ms",
				y: "value",
				fillOpacity: 0.4,
				fill: ACCENT_COLOR,
			}),
		];
		const compareMarks = compareRows
			? [
					decorative(
						lineY(withGaps(compareRows.trend, gapMs), {
							x: "ms",
							y: "value",
							strokeWidth: 2,
							yScale: "compare",
							stroke: COMPARE_COLOR,
						}),
					),
					decorative(
						dot(compareRows.readings, {
							r: 2,
							x: "ms",
							y: "value",
							fillOpacity: 0.4,
							yScale: "compare",
							fill: COMPARE_COLOR,
						}),
					),
				]
			: [];
		return defineChart({
			clip: true,
			focus: "nearest-x",
			marks: [...primaryMarks, ...compareMarks],
			maxFocusDistance: Number.POSITIVE_INFINITY,
			scales: {
				y: {
					nice: true,
					grid: true,
					scale: scaleLinear,
					axis: { ticks: { format: primary.formatValue } },
				},
				x: {
					scale: scaleLinear().domain([startMs, endMs]),
					axis: {
						ticks: {
							values: timeTicks(startMs, endMs),
							format: (ms: number) =>
								(endMs - startMs > 180 * DAY_MS ? monthFormat : dateFormat).format(ms),
						},
					},
				},
				...(compare && {
					compare: {
						nice: true,
						channel: "y",
						side: "right",
						scale: scaleLinear,
						axis: { ticks: { format: compare.formatValue } },
					},
				}),
			},
			tooltip: {
				portal,
				use: tooltip,
				anchor: "point",
				placement: ["top", "bottom"],
				content: (points) => {
					const reading = points[0]?.datum;
					if (reading?.value == null) {
						return { rows: [] };
					}
					const trend = nearestRow(primaryRows.trend, reading.ms, Number.POSITIVE_INFINITY);
					const other =
						compareRows && nearestRow(compareRows.readings, reading.ms, COMPARE_WINDOW_MS);
					return {
						title: fullDateFormat.format(reading.ms),
						rows: [
							{
								color: ACCENT_COLOR,
								label: primary.label,
								value: primary.formatValue(reading.value),
							},
							...(trend?.value == null
								? []
								: [
										{
											label: "Trend",
											color: ACCENT_COLOR,
											value: primary.formatValue(trend.value),
										},
									]),
							...(compare
								? [
										{
											color: COMPARE_COLOR,
											label: compare.label,
											value: other?.value == null ? "not logged" : compare.formatValue(other.value),
										},
									]
								: []),
						],
					};
				},
			},
		});
	}, [primary, compare, primaryRows, compareRows, startMs, endMs, gapMs]);

	return (
		<div className="text-text">
			<Chart ariaLabel={ariaLabel} definition={definition} height={compact ? 160 : 240} />
		</div>
	);
}

const COMPARE_FILL = "var(--border-emphasis)";
const COMPARE_STROKE = "var(--border-strong)";
const Y_AXIS = { line: false, ticks: { size: 0, padding: 8 } } as const;

const chartHeight = (compact: boolean) => (compact ? 200 : 260);

const yScale = (values: ReadonlyArray<number>, unit: MetricUnit, compact: boolean) => {
	const ticks = axisTicks(Math.min(0, ...values), Math.max(0, ...values), unit, compact ? 3 : 4);
	return {
		grid: true,
		scale: scaleLinear().domain([ticks[0] ?? 0, ticks.at(-1) ?? 1]),
		axis: {
			...Y_AXIS,
			ticks: {
				...Y_AXIS.ticks,
				values: ticks,
				format: (value: number) => formatAxisValue(value, unit),
			},
		},
	};
};

const emptyMessage = (values: ReadonlyArray<null | number>) => {
	if (values.every((value) => value === null)) {
		return "No recorded values in this period.";
	}
	return values.every((value) => value === null || value === 0)
		? "Nothing recorded in this period."
		: null;
};

const periodRows = <Point extends PeriodTrendPoint>(
	points: ReadonlyArray<Point>,
	period: "current" | "previous",
): ReadonlyArray<PeriodChartRow<Point>> =>
	points.map((point, index) => ({ point, index, period, value: point.value }));

export function PeriodTrendChart<Point extends PeriodTrendPoint>({
	unit,
	label,
	current,
	compact,
	previous,
	grouping,
	timeZone,
	onSelect,
	ariaLabel,
	mark = "bar",
	view: controlledView,
}: PeriodTrendChartProps<Point>) {
	const [view, setView] = useChartView(controlledView);
	const previousLabel = previous?.label;
	const previousPoints = previous?.points;
	const currentRows = useMemo(() => periodRows(current, "current"), [current]);
	const previousRows = useMemo(
		() => periodRows(previousPoints ?? [], "previous"),
		[previousPoints],
	);
	const length = Math.max(currentRows.length, previousRows.length);
	const pointAt = (index: number) => currentRows[index]?.point ?? previousRows[index]?.point;
	const fullLabel = (row: PeriodChartRow<Point>) =>
		bucketLabel(row.point.at, grouping, timeZone, "full");
	const definition = useMemo(() => {
		const indices = Array.from({ length }, (_, index) => index);
		const known = [...currentRows, ...previousRows].flatMap(({ value }) =>
			value === null ? [] : [value],
		);
		const tickStep = Math.max(1, Math.ceil(length / (compact ? 3 : 6)));
		const at = (index: number) => (currentRows[index] ?? previousRows[index])?.point.at;
		const firstAt = at(0);
		const lastAt = at(length - 1);
		const multiYear =
			firstAt !== undefined &&
			lastAt !== undefined &&
			reportingDate(firstAt, timeZone, "year") !== reportingDate(lastAt, timeZone, "year");
		const tooltipRow = (row: undefined | PeriodChartRow<Point>, color: string) =>
			row === undefined
				? []
				: [
						{
							color,
							value: tooltipValue(row.point, unit),
							label: bucketLabel(row.point.at, grouping, timeZone, "full"),
						},
					];
		const marks =
			mark === "bar"
				? [
						barY(previousRows, {
							inset: 1,
							radius: 3,
							x: "index",
							y: "value",
							maxThickness: 44,
							fill: COMPARE_FILL,
						}),
						barY(currentRows, {
							radius: 3,
							x: "index",
							y: "value",
							maxThickness: 32,
							fill: ACCENT_COLOR,
							inset: previousRows.length > 0 ? 4 : 1.5,
						}),
					]
				: [
						decorative(
							lineY(previousRows, {
								x: "index",
								y: "value",
								strokeWidth: 1.5,
								stroke: COMPARE_STROKE,
								strokeDasharray: "4 4",
							}),
						),
						decorative(
							lineY(currentRows, {
								x: "index",
								y: "value",
								strokeWidth: 2.5,
								stroke: ACCENT_COLOR,
							}),
						),
						dot(previousRows, { r: 2, x: "index", y: "value", fill: COMPARE_STROKE }),
						dot(currentRows, {
							x: "index",
							y: "value",
							fill: ACCENT_COLOR,
							r: length > 24 ? 2 : 3.5,
						}),
					];
		return defineChart({
			marks,
			focus: "group-x",
			maxFocusDistance: Number.POSITIVE_INFINITY,
			tooltip: {
				portal,
				use: tooltip,
				motion: false,
				anchor: "point",
				placement: ["top", "bottom"],
				content: (points) => {
					const index = points[0]?.datum.index;
					return {
						rows:
							index === undefined
								? []
								: [
										...tooltipRow(currentRows[index], ACCENT_COLOR),
										...tooltipRow(previousRows[index], COMPARE_STROKE),
									],
					};
				},
			},
			scales: {
				y: yScale(known, unit, compact),
				x: {
					scale:
						mark === "bar"
							? scaleBand<number>().domain(indices)
							: scaleLinear().domain(length <= 1 ? [-0.5, 0.5] : [0, length - 1]),
					axis: {
						ticks: {
							size: 0,
							values: indices.filter((index) => index % tickStep === 0),
							format: (index: number) => {
								const value = at(index);
								return value === undefined
									? ""
									: bucketLabel(value, grouping, timeZone, multiYear ? "axis-multi-year" : "axis");
							},
						},
					},
				},
			},
		});
	}, [currentRows, previousRows, length, compact, timeZone, grouping, mark, unit]);
	const empty = emptyMessage([...currentRows, ...previousRows].map(({ value }) => value));
	if (empty !== null) {
		return <ChartEmpty message={empty} compact={compact} />;
	}
	const exactCell = (row: undefined | PeriodChartRow<Point>): null | ExactCell => {
		if (row === undefined) {
			return null;
		}
		const period = fullLabel(row);
		return {
			label: period,
			value: reportingValue(row.point, unit),
			select: onSelect && row.value !== null ? () => onSelect(row.point, row.period) : undefined,
			detail:
				row.period === "previous"
					? [period, row.point.detail].filter(Boolean).join(" · ")
					: row.point.detail,
		};
	};
	return (
		<div className="flex min-w-0 flex-col gap-3 text-text">
			<ChartToolbar view={view} ariaLabel={ariaLabel} onViewChange={setView}>
				{previousLabel === undefined ? null : (
					<div className="flex flex-wrap gap-x-4 gap-y-1 text-label text-text-muted">
						<span className="inline-flex items-center gap-1.5">
							<LegendSwatch mark={mark} color={ACCENT_COLOR} />
							{label}
						</span>
						<span className="inline-flex items-center gap-1.5">
							<LegendSwatch
								dashed
								mark={mark}
								color={mark === "bar" ? COMPARE_FILL : COMPARE_STROKE}
							/>
							{previousLabel}
						</span>
					</div>
				)}
			</ChartToolbar>
			{view === "table" ? (
				<ExactValuesTable
					ariaLabel={ariaLabel}
					headers={previousLabel === undefined ? ["Value"] : [label, previousLabel]}
					rows={Array.from({ length }, (_, index) => {
						const point = pointAt(index);
						return {
							key: String(index),
							period: point === undefined ? "" : bucketLabel(point.at, grouping, timeZone, "full"),
							cells: [
								exactCell(currentRows[index]),
								...(previousLabel === undefined ? [] : [exactCell(previousRows[index])]),
							],
						};
					})}
				/>
			) : (
				<Chart
					ariaLabel={ariaLabel}
					definition={definition}
					height={chartHeight(compact)}
					onSelect={(point) => {
						if (point && onSelect) {
							onSelect(point.datum.point, point.datum.period);
						}
					}}
					ariaDescription="Use left and right arrow keys to inspect buckets. Missing values are gaps. Switch to the table for exact values and record links."
				/>
			)}
		</div>
	);
}

function ChartEmpty(props: { readonly message: string; readonly compact: boolean }) {
	return (
		<div
			style={{ height: chartHeight(props.compact) }}
			className="flex items-center justify-center rounded-md border border-dashed border-border px-4"
		>
			<p className="text-label text-text-muted">{props.message}</p>
		</div>
	);
}

function LegendSwatch(props: {
	readonly color: string;
	readonly dashed?: boolean;
	readonly mark: "bar" | "line";
}) {
	return props.mark === "bar" ? (
		<span
			aria-hidden="true"
			className="size-2.5 rounded-xs"
			style={{ backgroundColor: props.color }}
		/>
	) : (
		<span
			aria-hidden="true"
			style={{ borderColor: props.color }}
			className={clsx("w-4 border-t-2", props.dashed === true && "border-dashed")}
		/>
	);
}

function exactValue(entry: null | ExactCell) {
	if (entry === null) {
		return <span className="text-text-subtle">—</span>;
	}
	return (
		<span className="flex flex-col items-end">
			{entry.select ? (
				<Button
					variant="linkPlain"
					onClick={entry.select}
					className="tabular-nums hover:underline"
					aria-label={`View records: ${entry.label} · ${entry.value}`}
				>
					{entry.value}
				</Button>
			) : (
				entry.value
			)}
			{entry.detail === undefined || entry.detail === "" ? null : (
				<span className="text-micro text-text-subtle">{entry.detail}</span>
			)}
		</span>
	);
}

function ChartToolbar(props: {
	readonly view: ChartView;
	readonly ariaLabel: string;
	readonly children?: ReactNode;
	readonly onViewChange: (view: ChartView) => void;
}) {
	return (
		<div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
			<div className="min-w-0">{props.children}</div>
			<SegmentedControl
				value={props.view}
				optionClassName="px-2.5"
				onChange={props.onViewChange}
				label={`${props.ariaLabel} display`}
				options={[
					{ value: "chart", label: "Chart", content: "Chart" },
					{ value: "table", label: "Table", content: "Table" },
				]}
			/>
		</div>
	);
}

const exactColumns = (headers: ReadonlyArray<string>): ReadonlyArray<DataTableColumn<ExactRow>> => [
	{
		id: "period",
		header: "Period",
		cell: (row) => row.period,
		headerClassName: "px-3 py-2 font-medium",
		cellClassName: "px-3 py-2 align-middle text-text",
	},
	...headers.map((header, index) => ({
		header,
		id: `value-${index}`,
		headerClassName: "px-3 py-2 text-right font-medium",
		cell: (row: ExactRow) => exactValue(row.cells[index] ?? null),
		cellClassName: "px-3 py-2 text-right align-middle text-text tabular-nums",
	})),
];

function ExactValuesTable(props: {
	readonly ariaLabel: string;
	readonly rows: ReadonlyArray<ExactRow>;
	readonly headers: ReadonlyArray<string>;
}) {
	return (
		<div className="max-h-80 overflow-y-auto rounded-md border border-border">
			<DataTable
				data={props.rows}
				getRowId={(row) => row.key}
				columns={exactColumns(props.headers)}
				rowClassName="border-t border-border"
				aria-label={`${props.ariaLabel} exact values`}
				className="w-full border-collapse text-left text-label"
				headerClassName="sticky top-0 bg-surface-2 text-text-muted"
			/>
		</div>
	);
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

type HourRow<Bucket> = ReportingChartValue & {
	readonly hour: number;
	readonly bucket: null | Bucket;
};

export function HourlyHistogram<Bucket extends HourlyHistogramBucket>({
	unit,
	buckets,
	compact,
	onSelect,
	ariaLabel,
	view: controlledView,
}: HourlyHistogramProps<Bucket>) {
	const [view, setView] = useChartView(controlledView);
	const rows = useMemo(() => {
		const byHour = new Map(buckets.map((bucket) => [bucket.hour, bucket]));
		return HOURS.map((hour): HourRow<Bucket> => {
			const bucket = byHour.get(hour) ?? null;
			return { hour, bucket, detail: bucket?.detail, value: bucket?.value ?? null };
		});
	}, [buckets]);
	const definition = useMemo(
		() =>
			defineChart({
				focus: "group-x",
				maxFocusDistance: Number.POSITIVE_INFINITY,
				marks: [
					barY(rows, {
						radius: 2,
						x: "hour",
						y: "value",
						inset: 1.5,
						maxThickness: 24,
						fill: ACCENT_COLOR,
					}),
				],
				scales: {
					y: yScale(
						rows.map(({ value }) => value ?? 0),
						unit,
						compact,
					),
					x: {
						scale: scaleBand<number>().domain(HOURS),
						axis: {
							ticks: {
								size: 0,
								format: hourLabel,
								values: HOURS.filter((hour) => hour % (compact ? 6 : 3) === 0),
							},
						},
					},
				},
				tooltip: {
					portal,
					use: tooltip,
					motion: false,
					anchor: "point",
					placement: ["top", "bottom"],
					content: (points) => {
						const row = points[0]?.datum;
						return {
							rows: row
								? [
										{
											color: ACCENT_COLOR,
											value: tooltipValue(row, unit),
											label: `${hourLabel(row.hour)}–${hourLabel(row.hour + 1)}`,
										},
									]
								: [],
						};
					},
				},
			}),
		[rows, compact, unit],
	);
	const empty = emptyMessage(buckets.length === 0 ? [] : rows.map(({ value }) => value));
	if (empty !== null) {
		return <ChartEmpty message={empty} compact={compact} />;
	}
	return (
		<div className="flex min-w-0 flex-col gap-3 text-text">
			<ChartToolbar view={view} ariaLabel={ariaLabel} onViewChange={setView} />
			{view === "table" ? (
				<ExactValuesTable
					headers={["Value"]}
					ariaLabel={ariaLabel}
					rows={rows.map((row) => {
						const bucket = row.bucket;
						const period = `${hourLabel(row.hour)}–${hourLabel(row.hour + 1)}`;
						return {
							period,
							key: String(row.hour),
							cells: [
								{
									label: period,
									detail: row.detail,
									value: reportingValue(row, unit),
									select:
										onSelect && bucket !== null && bucket.value !== null
											? () => onSelect(bucket)
											: undefined,
								},
							],
						};
					})}
				/>
			) : (
				<Chart
					ariaLabel={ariaLabel}
					definition={definition}
					height={chartHeight(compact)}
					onSelect={(point) => {
						if (point?.datum.bucket && onSelect) {
							onSelect(point.datum.bucket);
						}
					}}
					ariaDescription="Local hour of day. Use left and right arrow keys to inspect hours. Switch to the table for exact values and record links."
				/>
			)}
		</div>
	);
}
