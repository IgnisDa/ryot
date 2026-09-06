import { defineChart } from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react/tooltip";
import { cell } from "@tanstack/charts/rect";
import { scaleBand } from "@tanstack/charts/scales/band";
import { tooltip } from "@tanstack/charts/tooltip";
import { portal } from "@tanstack/charts/tooltip/portal";
import { useLayoutEffect, useMemo, useRef } from "react";

const DAY_MS = 86_400_000;
const LEVELS = [0, 1, 2, 3, 4, 5] as const;
const LEVEL_COLORS = LEVELS.map((level) => `var(--chart-seq-${level})`);
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

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

/** A 7-row by N-week activity calendar that scrolls to show the newest week. */
export function CalendarHeatmap({
	days,
	compact,
	ariaLabel,
	weekStart,
	formatTooltip,
}: CalendarHeatmapProps) {
	const scrollerRef = useRef<HTMLDivElement>(null);
	const cells = useMemo(() => calendarCells(days, weekStart), [days, weekStart]);
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

	useLayoutEffect(() => {
		const scroller = scrollerRef.current;
		if (scroller) {
			scroller.scrollLeft = scroller.scrollWidth;
		}
	}, [weeks, pitch]);

	if (cells.length === 0) {
		return null;
	}
	return (
		<div ref={scrollerRef} className="overflow-x-auto text-text">
			<Chart
				height={pitch * 7}
				ariaLabel={ariaLabel}
				width={pitch * weeks}
				definition={definition}
				renderTooltipBody={({ points }) => {
					const day = points[0]?.datum;
					return day === undefined ? null : formatTooltip(day);
				}}
			/>
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
