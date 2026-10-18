import { areaY, defineChart, dot, lineY } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import { Chart } from "@tanstack/charts/react/tooltip";
import { cell } from "@tanstack/charts/rect";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { portal } from "@tanstack/charts/tooltip/portal";
import { useMemo } from "react";

const DAY_MS = 86_400_000;
const LEVELS = [0, 1, 2, 3, 4, 5] as const;
const LEVEL_COLORS = LEVELS.map((level) => `var(--chart-seq-${level})`);
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const MIN_MONTH_LABEL_GAP_WEEKS = 3;
const calendarMonthFormat = new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" });

/** One calendar day: `date` is `YYYY-MM-DD`, `value` is the day's activity amount. */
export type CalendarHeatmapDay = { readonly date: string; readonly value: number };

export type CalendarHeatmapLevel = (typeof LEVELS)[number];

export type CalendarHeatmapProps = {
	/** Days in any order. Dates missing between the earliest and latest day render as zero. */
	readonly days: ReadonlyArray<CalendarHeatmapDay>;
	/** First row of each week column: 0 = Sunday, 1 = Monday. */
	readonly weekStart: 0 | 1;
	/** Tooltip text for one day; also used as the chart's accessible point text. */
	readonly formatTooltip: (day: CalendarHeatmapDay) => string;
	/** Smaller cells for touch layouts. */
	readonly compact: boolean;
	/** Accessible chart name. */
	readonly ariaLabel: string;
};

type CalendarCell = CalendarHeatmapDay & {
	readonly week: number;
	readonly weekday: number;
	readonly level: CalendarHeatmapLevel;
};

const dayNumber = (date: string) => {
	const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
	return Date.UTC(year, month - 1, day) / DAY_MS;
};

const isoDate = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** Level 0 is no activity; positive values split into five equal bands of the maximum value. */
const levelOf = (value: number, max: number): CalendarHeatmapLevel =>
	value <= 0 ? 0 : (LEVELS[Math.min(5, Math.ceil((value / max) * 5))] ?? 5);

const calendarCells = (
	days: ReadonlyArray<CalendarHeatmapDay>,
	weekStart: 0 | 1,
): ReadonlyArray<CalendarCell> => {
	if (days.length === 0) {
		return [];
	}
	const values = new Map(days.map((day) => [dayNumber(day.date), day.value]));
	const first = Math.min(...values.keys());
	const last = Math.max(...values.keys());
	const max = Math.max(...values.values());
	const leading = (new Date(first * DAY_MS).getUTCDay() - weekStart + 7) % 7;
	return Array.from({ length: last - first + 1 }, (_, index) => {
		const value = values.get(first + index) ?? 0;
		return {
			value,
			level: levelOf(value, max),
			date: isoDate(first + index),
			weekday: (index + leading) % 7,
			week: Math.floor((index + leading) / 7),
		};
	});
};

const monthLabels = (cells: ReadonlyArray<CalendarCell>) => {
	const labels: { readonly week: number; readonly label: string }[] = [];
	for (const day of cells) {
		const previous = labels.at(-1);
		if (
			day.date.endsWith("-01") &&
			(previous === undefined || day.week - previous.week >= MIN_MONTH_LABEL_GAP_WEEKS)
		) {
			labels.push({
				week: day.week,
				label: calendarMonthFormat.format(new Date(`${day.date}T00:00:00Z`)),
			});
		}
	}
	return labels;
};

/** A 7-row by N-week activity calendar with month labels and a level legend, opening on the newest week. */
export function CalendarHeatmap({
	days,
	compact,
	ariaLabel,
	weekStart,
	formatTooltip,
}: CalendarHeatmapProps) {
	const cells = useMemo(() => calendarCells(days, weekStart), [days, weekStart]);
	const months = useMemo(() => monthLabels(cells), [cells]);
	const weeks = (cells.at(-1)?.week ?? -1) + 1;
	const pitch = compact ? 12 : 15;
	const definition = useMemo(
		() =>
			defineChart({
				color: { domain: LEVELS, range: LEVEL_COLORS },
				tooltip: { portal, use: tooltip, anchor: "point", placement: ["top", "bottom"] },
				marks: [
					cell(cells, {
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
						scale: scaleBand<number>().domain(Array.from({ length: weeks }, (_, i) => i)),
					},
				},
			}),
		[cells, weeks],
	);

	const width = pitch * weeks;

	if (cells.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-2 text-text">
			{/* Reversed flow makes the scroller start at its end, so the newest week shows without measuring layout. */}
			<div className="flex w-fit max-w-full flex-row-reverse overflow-x-auto">
				<div style={{ width }} className="shrink-0">
					<div aria-hidden="true" className="relative h-4 text-xs text-text-subtle">
						{months.map(({ week, label }) => (
							<span
								key={`${week}-${label}`}
								className="absolute top-0"
								style={{ left: week * pitch }}
							>
								{label}
							</span>
						))}
					</div>
					<Chart
						width={width}
						height={pitch * 7}
						ariaLabel={ariaLabel}
						definition={definition}
						renderTooltipBody={({ points }) => {
							const day = points[0]?.datum;
							return day === undefined ? null : formatTooltip(day);
						}}
					/>
				</div>
			</div>
			<div aria-hidden="true" className="flex items-center gap-1 text-xs text-text-subtle">
				<span className="mr-1">Less</span>
				{LEVEL_COLORS.map((color) => (
					<span key={color} className="size-2.5 rounded-xs" style={{ backgroundColor: color }} />
				))}
				<span className="ml-1">More</span>
			</div>
		</div>
	);
}

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

export type TimeSeriesPoint = { readonly at: string; readonly value: number };

export type SparklineProps = {
	readonly points: ReadonlyArray<TimeSeriesPoint>;
	readonly ariaLabel: string;
	/** `accent` draws in the chart accent color, `muted` in a neutral. */
	readonly tone: "accent" | "muted";
};

type SeriesRow = { readonly ms: number; readonly value: number | null };

const ACCENT_COLOR = "var(--chart-accent)";
const SPARKLINE_WIDTH = 96;
const SPARKLINE_HEIGHT = 28;
const SPARKLINE_INSET = 3;
const TONE_COLORS = { accent: ACCENT_COLOR, muted: "var(--border-strong)" } as const;

const chronological = (points: ReadonlyArray<TimeSeriesPoint>): ReadonlyArray<SeriesRow> =>
	points.map(({ at, value }) => ({ value, ms: Date.parse(at) })).sort((a, b) => a.ms - b.ms);

/** A fixed-size trend line with a soft area fill and an emphasised last point; no axes or tooltip. */
export function Sparkline({ tone, points, ariaLabel }: SparklineProps) {
	const rows = useMemo(() => chronological(points), [points]);
	const definition = useMemo(() => {
		const color = TONE_COLORS[tone];
		const last = rows.slice(-1);
		const floor = Math.min(...rows.map((row) => row.value ?? 0));
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
	}, [rows, tone]);

	if (rows.length < 2) {
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

export type TimeSeriesChartSeries = {
	readonly label: string;
	/** Raw observations, drawn as faint dots. */
	readonly readings: ReadonlyArray<TimeSeriesPoint>;
	/** Precomputed smoothed values, drawn as the emphasised line. */
	readonly trend: ReadonlyArray<TimeSeriesPoint>;
	readonly formatValue: (value: number) => string;
};

export type TimeSeriesChartProps = {
	/** X domain as ISO datetimes. */
	readonly range: { readonly startAt: string; readonly endAt: string };
	readonly primary: TimeSeriesChartSeries;
	/** Drawn against its own right-hand axis. */
	readonly compare?: TimeSeriesChartSeries;
	/** Trend lines break between consecutive trend points further apart than this. */
	readonly gapMs: number;
	readonly ariaLabel: string;
	/** Smaller height for touch layouts. */
	readonly compact: boolean;
};

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

const dateFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const monthFormat = new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit" });
const fullDateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

type SeriesRows = {
	readonly readings: ReadonlyArray<SeriesRow>;
	readonly trend: ReadonlyArray<SeriesRow>;
};

const seriesRows = (series: TimeSeriesChartSeries): SeriesRows => ({
	trend: chronological(series.trend),
	readings: chronological(series.readings),
});

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
				dot(primaryRows.trend.slice(-1), { r: 4, x: "ms", y: "value", fill: ACCENT_COLOR }),
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
