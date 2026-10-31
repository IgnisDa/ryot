import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
	CalendarHeatmap,
	type CalendarHeatmapDay,
	formatReportingDateTime,
	HourlyHistogram,
	PeriodTrendChart,
	type PeriodTrendChartProps,
	type PeriodTrendPoint,
	RankedBarList,
	Sparkline,
	TimeSeriesChart,
	type TimeSeriesChartProps,
	type TimeSeriesChartSeries,
	type TimeSeriesPoint,
} from "./charts";

const renderHeatmap = (
	days: ReadonlyArray<CalendarHeatmapDay>,
	weekStart: 0 | 1 = 1,
	onSelect?: (day: CalendarHeatmapDay) => void,
) =>
	render(
		<CalendarHeatmap
			days={days}
			compact={false}
			onSelect={onSelect}
			ariaLabel="Activity"
			weekStart={weekStart}
			formatValue={(value) => `${value} events`}
		/>,
	);

const cellsOf = (container: HTMLElement) => [
	...container.querySelectorAll<SVGRectElement>(".ts-chart__rect rect"),
];

const cellOn = (container: HTMLElement, date: string) =>
	container.querySelector(`.ts-chart__rect rect[data-ts-key$=":${date}"]`);

describe("CalendarHeatmap", () => {
	it("spans whole weeks between the earliest and latest day and leaves missing and unknown days blank", () => {
		const { container } = renderHeatmap([
			{ value: 3, date: "2026-09-25" },
			{ value: null, date: "2026-09-03" },
			{ value: 1, date: "2026-09-02" },
		]);

		expect(cellsOf(container)).toHaveLength(2);
		expect(screen.getByRole("img", { name: "Activity" }).getAttribute("viewBox")).toBe(
			"0 0 60 105",
		);
	});

	it("labels the weeks where months begin and shows the level legend", () => {
		const { container } = renderHeatmap([
			{ value: 1, date: "2026-09-07" },
			{ value: 2, date: "2026-11-08" },
		]);

		expect(
			[...container.querySelectorAll<HTMLElement>(".relative > span")].map((label) => [
				label.textContent,
				label.style.left,
			]),
		).toEqual([
			["Oct", "45px"],
			["Nov", "105px"],
		]);
		expect(container.textContent).toContain("Less");
		expect(container.textContent).toContain("More");
	});

	it("places the first day in its weekday row for the chosen week start", () => {
		const week = [
			{ value: 1, date: "2026-09-20" },
			{ value: 1, date: "2026-09-26" },
		];
		const sundayStart = renderHeatmap(week, 0);
		const sundayFirstRow = cellOn(sundayStart.container, "2026-09-20")?.getAttribute("y");
		const sundayViewBox = screen.getByRole("img").getAttribute("viewBox");
		sundayStart.unmount();
		const mondayStart = renderHeatmap(week, 1);

		expect(sundayViewBox).toBe("0 0 15 105");
		expect(sundayFirstRow).toBe("1.5");
		expect(screen.getByRole("img").getAttribute("viewBox")).toBe("0 0 30 105");
		expect(cellOn(mondayStart.container, "2026-09-20")?.getAttribute("y")).toBe("91.5");
	});

	it("buckets zero into level 0 and positive values into five levels of the maximum", () => {
		const { container } = renderHeatmap(
			[0, 2, 4, 6, 8, 10, 1].map((value, index) => ({ value, date: `2026-09-${21 + index}` })),
		);

		expect(cellsOf(container).map((cell) => cell.getAttribute("fill"))).toEqual([
			"var(--chart-seq-0)",
			"var(--chart-seq-1)",
			"var(--chart-seq-2)",
			"var(--chart-seq-3)",
			"var(--chart-seq-4)",
			"var(--chart-seq-5)",
			"var(--chart-seq-1)",
		]);
	});

	it("shows the formatted day in a tooltip when keyboard focus enters the chart", () => {
		renderHeatmap([
			{ value: 4, date: "2026-09-21" },
			{ value: 0, date: "2026-09-22" },
		]);

		fireEvent.focus(screen.getByRole("img", { name: "Activity" }));

		expect(screen.getByText("4 events · Sep 21, 2026")).toBeDefined();
	});

	it("lists exact values, including unknown days, with record links for known days", () => {
		const selected: string[] = [];
		renderHeatmap(
			[
				{ value: 4, date: "2026-09-21" },
				{ value: null, date: "2026-09-22" },
			],
			1,
			(day) => selected.push(day.date),
		);
		fireEvent.click(screen.getByText("View exact values"));
		const table = screen.getByRole("table", { name: "Activity exact values" });
		expect(within(table).getByText("Not recorded")).toBeDefined();
		expect(within(table).getAllByRole("button")).toHaveLength(1);
		fireEvent.click(within(table).getByRole("button", { name: /Sep 21, 2026/ }));
		expect(selected).toEqual(["2026-09-21"]);
	});

	it("renders nothing without days", () => {
		const { container } = renderHeatmap([]);

		expect(container.innerHTML).toBe("");
	});
});

describe("formatReportingDateTime", () => {
	it("formats an instant in the reporting time zone", () => {
		expect(
			formatReportingDateTime("2026-09-02T01:30:00.000Z", TimeZone.make("America/New_York")),
		).toMatch(/^Sep 1, 2026(?:,| at)\s9:30\sPM$/u);
	});
});

describe("RankedBarList", () => {
	it("orders rows by descending value with formatted values and proportional bars", () => {
		render(
			<RankedBarList
				formatValue={(row) => `${row.value} events`}
				rows={[
					{ value: 5, key: "unit", label: "Units" },
					{ value: 20, key: "record", label: "Records" },
					{ value: 10, key: "show", label: "Shows" },
				]}
			/>,
		);

		const items = within(screen.getByRole("list")).getAllByRole("listitem");
		expect(items.map((item) => item.textContent)).toEqual([
			"Records20 events",
			"Shows10 events",
			"Units5 events",
		]);
		expect(
			items.map((item) => item.querySelector<HTMLElement>(".bg-chart-accent")?.style.width),
		).toEqual(["100%", "50%", "25%"]);
	});
});

const DAY_MS = 86_400_000;

const septemberOn = (day: number) => new Date(Date.UTC(2026, 8, day)).toISOString();

const seriesOf = (days: ReadonlyArray<number>, value: number): ReadonlyArray<TimeSeriesPoint> =>
	days.map((day) => ({ value, at: septemberOn(day) }));

describe("Sparkline", () => {
	it("draws no line with fewer than two points but keeps the accessible name", () => {
		const { container } = render(
			<Sparkline tone="accent" ariaLabel="Weight trend" points={seriesOf([2], 80)} />,
		);

		expect(screen.getByRole("img", { name: "Weight trend" })).toBeDefined();
		expect(container.querySelector("path")).toBeNull();
	});

	it("draws the line in the tone color with an emphasised last point", () => {
		const { container } = render(
			<Sparkline tone="muted" ariaLabel="Weight trend" points={seriesOf([3, 1, 2], 80)} />,
		);

		expect(container.querySelector(".ts-chart__line path")?.getAttribute("stroke")).toBe(
			"var(--border-strong)",
		);
		expect(container.querySelectorAll(".ts-chart__dot circle")).toHaveLength(1);
	});

	it("keeps null values as line breaks and highlights the last known point", () => {
		const { container } = render(
			<Sparkline
				tone="accent"
				ariaLabel="Weight trend"
				points={[
					{ value: 70, at: septemberOn(2) },
					{ value: null, at: septemberOn(3) },
					{ value: 74, at: septemberOn(4) },
					{ value: null, at: septemberOn(5) },
				]}
			/>,
		);

		expect(container.querySelectorAll(".ts-chart__line path")).toHaveLength(2);
		expect(container.querySelectorAll(".ts-chart__dot circle")).toHaveLength(1);
	});

	it("draws known zeros on both sides of a gap and keeps missing-only or single-known inputs safe", () => {
		const zeros = render(
			<Sparkline
				tone="accent"
				ariaLabel="Weight trend"
				points={[
					{ value: 0, at: septemberOn(2) },
					{ value: 0, at: septemberOn(3) },
					{ value: null, at: septemberOn(4) },
					{ value: 0, at: septemberOn(5) },
					{ value: 0, at: septemberOn(6) },
				]}
			/>,
		);
		expect(zeros.container.querySelectorAll(".ts-chart__line path")).toHaveLength(2);
		expect(zeros.container.querySelectorAll(".ts-chart__dot circle")).toHaveLength(1);
		expect(zeros.container.innerHTML).not.toMatch(/NaN|Infinity/);
		zeros.unmount();

		for (const points of [
			[
				{ value: null, at: septemberOn(2) },
				{ value: null, at: septemberOn(3) },
			],
			[
				{ value: null, at: septemberOn(2) },
				{ value: 80, at: septemberOn(3) },
			],
		]) {
			const placeholder = render(
				<Sparkline tone="accent" points={points} ariaLabel="Weight trend" />,
			);
			expect(screen.getByRole("img", { name: "Weight trend" })).toBeDefined();
			expect(placeholder.container.querySelector("svg")).toBeNull();
			expect(placeholder.container.innerHTML).not.toMatch(/NaN|Infinity/);
			placeholder.unmount();
		}
	});
});

const renderTimeSeries = (overrides: Partial<TimeSeriesChartProps> = {}) =>
	render(
		<TimeSeriesChart
			compact={false}
			gapMs={3 * DAY_MS}
			ariaLabel="Weight over time"
			range={{ endAt: septemberOn(30), startAt: septemberOn(1) }}
			primary={{
				label: "Weight",
				trend: seriesOf([2, 3, 4, 5], 80),
				readings: seriesOf([2, 3, 4, 5], 80),
				formatValue: (value) => `${value} kg`,
			}}
			{...overrides}
		/>,
	);

const bodyFat = (readingDays: ReadonlyArray<number>): TimeSeriesChartSeries => ({
	label: "Body fat",
	trend: seriesOf(readingDays, 20),
	formatValue: (value) => `${value}%`,
	readings: seriesOf(readingDays, 20),
});

describe("TimeSeriesChart", () => {
	it("keeps one trend segment while consecutive points are within the gap", () => {
		const { container } = renderTimeSeries();

		expect(container.querySelectorAll(".ts-chart__line path")).toHaveLength(1);
	});

	it("breaks the trend path between consecutive points further apart than the gap", () => {
		const { container } = renderTimeSeries({
			primary: {
				label: "Weight",
				trend: seriesOf([2, 3, 20, 21], 80),
				formatValue: (value) => `${value} kg`,
				readings: seriesOf([2, 3, 20, 21], 80),
			},
		});

		expect(container.querySelectorAll(".ts-chart__line path")).toHaveLength(2);
	});

	it("draws the right-hand axis only when a compare series is given", () => {
		const withoutCompare = renderTimeSeries();
		const axisLabelsWithout = screen.queryAllByText(/%$/);
		withoutCompare.unmount();
		renderTimeSeries({ compare: bodyFat([2, 3]) });

		expect(axisLabelsWithout).toHaveLength(0);
		expect(screen.queryAllByText(/%$/).length).toBeGreaterThan(0);
	});

	it("shows the reading, its trend and the compare reading logged within two days", () => {
		renderTimeSeries({ compare: bodyFat([3]) });

		fireEvent.focus(screen.getByRole("img", { name: "Weight over time" }));

		const tooltip = screen.getByRole("status", { hidden: true });
		expect(tooltip.textContent).toContain("Weight80 kg");
		expect(tooltip.textContent).toContain("Trend80 kg");
		expect(tooltip.textContent).toContain("Body fat20%");
	});

	it("reports the compare series as not logged when its reading is more than two days away", () => {
		renderTimeSeries({ compare: bodyFat([10]) });

		fireEvent.focus(screen.getByRole("img", { name: "Weight over time" }));

		expect(screen.getByRole("status", { hidden: true }).textContent).toContain(
			"Body fatnot logged",
		);
	});

	it("keeps null readings out of primary and compare tooltips while preserving known zero", () => {
		const primaryFormatted: number[] = [];
		const compareFormatted: number[] = [];
		const { container } = renderTimeSeries({
			compare: {
				label: "Body fat",
				trend: [{ value: null, at: septemberOn(2) }],
				formatValue: (value) => {
					compareFormatted.push(value);
					return `${value}%`;
				},
				readings: [
					{ value: null, at: septemberOn(2) },
					{ value: null, at: septemberOn(3) },
					{ value: null, at: septemberOn(4) },
				],
			},
			primary: {
				label: "Weight",
				formatValue: (value) => {
					primaryFormatted.push(value);
					return `${value} kg`;
				},
				readings: [
					{ value: 0, at: septemberOn(2) },
					{ value: null, at: septemberOn(3) },
					{ value: 74, at: septemberOn(4) },
				],
				trend: [
					{ value: 70, at: septemberOn(2) },
					{ value: null, at: septemberOn(3) },
					{ value: 74, at: septemberOn(4) },
					{ value: null, at: septemberOn(5) },
				],
			},
		});

		expect(container.querySelectorAll(".ts-chart__line path")).toHaveLength(2);
		const dots = [...container.querySelectorAll(".ts-chart__dot circle")];
		expect(dots).toHaveLength(3);
		expect(
			new Set(dots.map((dot) => `${dot.getAttribute("cx")}:${dot.getAttribute("cy")}`)).size,
		).toBe(2);

		fireEvent.focus(screen.getByRole("img", { name: "Weight over time" }));
		const tooltip = screen.getByRole("status", { hidden: true });
		expect(tooltip.textContent).toContain("Weight0 kg");
		expect(tooltip.textContent).toContain("Body fatnot logged");
		expect(tooltip.textContent).not.toContain("Body fat0%");
		fireEvent.keyDown(screen.getByRole("img"), { key: "ArrowRight" });
		expect(tooltip.textContent).toContain("Weight74 kg");
		expect(tooltip.textContent).toContain("Body fatnot logged");
		expect(primaryFormatted.every(Number.isFinite)).toBe(true);
		expect(compareFormatted.every(Number.isFinite)).toBe(true);
	});
});

const losAngeles = TimeZone.make("America/Los_Angeles");

const renderPeriodTrend = (overrides: Partial<PeriodTrendChartProps<PeriodTrendPoint>> = {}) =>
	render(
		<PeriodTrendChart
			compact={false}
			timeZone={losAngeles}
			label="Current period"
			ariaLabel="Recorded activity"
			formatValue={(value) => `${value} minutes`}
			previous={{
				label: "Previous period",
				points: [
					{ value: 12.25, detail: "Estimated", at: "2026-08-02T01:00:00Z" },
					{ value: 0, at: "2026-08-03T01:00:00Z" },
				],
			}}
			current={[
				{ value: 12.25, at: "2026-09-02T01:00:00Z" },
				{ value: null, at: "2026-09-03T01:00:00Z", detail: "Duration missing" },
				{ value: 0, at: "2026-09-04T01:00:00Z" },
			]}
			{...overrides}
		/>,
	);

describe("PeriodTrendChart", () => {
	it("uses one axis for equal values, dashed comparison lines, and gaps for missing values", () => {
		const { container } = renderPeriodTrend();
		const lines = [...container.querySelectorAll(".ts-chart__line path")];
		expect(lines).toHaveLength(3);
		expect(lines.at(-1)?.getAttribute("stroke-dasharray")).toBe("5 4");
		const dots = [...container.querySelectorAll(".ts-chart__dot circle")];
		expect(dots).toHaveLength(4);
		expect(dots[0]?.getAttribute("cy")).toBe(dots[2]?.getAttribute("cy"));
	});

	it("shows actual period dates in the reporting timezone and exact provenance on keyboard focus", () => {
		renderPeriodTrend();
		fireEvent.focus(screen.getByRole("img", { name: "Recorded activity" }));
		const tooltip = screen.getByRole("status", { hidden: true });
		expect(tooltip.textContent).toContain("America/Los_Angeles");
		expect(tooltip.textContent).toContain("Current period · Sep 1, 202612.25 minutes");
		expect(tooltip.textContent).toContain("Previous period · Aug 1, 202612.25 minutes · Estimated");
		fireEvent.keyDown(screen.getByRole("img"), { key: "ArrowRight" });
		expect(tooltip.textContent).toContain("Not recorded · Duration missing");
		expect(tooltip.textContent).toContain("0 minutes");
	});

	it("keeps calendar dates fixed and returns the caller's point for each period", () => {
		const selected: string[] = [];
		const current = [{ value: 0, at: "2026-09-02", id: "current-bucket" }];
		const previous = [
			{ value: 2, at: "2026-08-02", id: "previous-bucket" },
			{ value: 3, at: "2026-08-03", id: "extra-bucket" },
		];
		render(
			<PeriodTrendChart
				compact={false}
				current={current}
				timeZone={losAngeles}
				label="Current period"
				ariaLabel="Recorded activity"
				formatValue={(value) => `${value} minutes`}
				previous={{ points: previous, label: "Previous period" }}
				onSelect={(point, period) => selected.push(`${period}:${point.id}`)}
			/>,
		);
		fireEvent.click(screen.getByText("View exact values"));
		const table = screen.getByRole("table", { name: "Recorded activity exact values" });
		expect(table.textContent).toContain("Sep 2, 2026");
		expect(within(table).getAllByRole("row")).toHaveLength(4);
		fireEvent.click(within(table).getByRole("button", { name: /Current period/ }));
		for (const button of within(table).getAllByRole("button", { name: /Previous period/ })) {
			fireEvent.click(button);
		}
		expect(selected).toEqual([
			"current:current-bucket",
			"previous:previous-bucket",
			"previous:extra-bucket",
		]);
	});

	it("draws a single recorded zero and distinguishes missing-only from empty data", () => {
		const single = renderPeriodTrend({
			previous: undefined,
			current: [{ value: 0, at: "2026-09-02" }],
		});
		expect(single.container.querySelectorAll(".ts-chart__dot circle")).toHaveLength(1);
		single.unmount();
		const missing = renderPeriodTrend({
			previous: undefined,
			current: [{ value: null, at: "2026-09-02" }],
		});
		expect(screen.getByText("No recorded values. Missing data is not zero.")).toBeDefined();
		expect(missing.container.querySelectorAll(".ts-chart__dot circle")).toHaveLength(0);
		missing.unmount();
		renderPeriodTrend({ current: [], previous: undefined });
		expect(screen.getByText("No data in this period.")).toBeDefined();
	});
});

describe("HourlyHistogram", () => {
	it("shows all 24 local hours, preserving missing hours and recorded zeros with accessible selection", () => {
		const selected: number[] = [];
		render(
			<HourlyHistogram
				compact={true}
				ariaLabel="Hourly activity"
				timeZone={TimeZone.make("Asia/Kolkata")}
				periodLabel="Observations · September 2026"
				formatValue={(value) => `${value} observations`}
				onSelect={(bucket) => selected.push(bucket.hour)}
				buckets={[
					{ hour: 0, value: 0 },
					{ hour: 23, value: 8, detail: "Exact instants only" },
				]}
			/>,
		);
		fireEvent.focus(screen.getByRole("img", { name: "Hourly activity" }));
		expect(screen.getByRole("status", { hidden: true }).textContent).toContain(
			"00:00–01:000 observations",
		);
		fireEvent.keyDown(screen.getByRole("img"), { key: "ArrowRight" });
		expect(screen.getByRole("status", { hidden: true }).textContent).toContain(
			"23:00–24:008 observations · Exact instants only",
		);
		fireEvent.click(screen.getByText("View exact values"));
		const table = screen.getByRole("table");
		expect(within(table).getAllByRole("row")).toHaveLength(25);
		expect(within(table).getAllByText("Not recorded")).toHaveLength(22);
		fireEvent.click(within(table).getByRole("button", { name: /23:00–24:00/ }));
		expect(selected).toEqual([23]);
	});
});
