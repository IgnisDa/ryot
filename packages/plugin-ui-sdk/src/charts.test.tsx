import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
	CalendarHeatmap,
	type CalendarHeatmapDay,
	RankedBarList,
	Sparkline,
	TimeSeriesChart,
	type TimeSeriesChartProps,
	type TimeSeriesChartSeries,
	type TimeSeriesPoint,
} from "./charts";

const renderHeatmap = (days: ReadonlyArray<CalendarHeatmapDay>, weekStart: 0 | 1 = 1) =>
	render(
		<CalendarHeatmap
			days={days}
			compact={false}
			ariaLabel="Activity"
			weekStart={weekStart}
			formatTooltip={(day) => `${day.value} on ${day.date}`}
		/>,
	);

const cellsOf = (container: HTMLElement) => [
	...container.querySelectorAll<SVGRectElement>(".ts-chart__rect rect"),
];

const cellOn = (container: HTMLElement, date: string) =>
	container.querySelector(`.ts-chart__rect rect[data-ts-key$=":${date}"]`);

describe("CalendarHeatmap", () => {
	it("pads missing dates between the earliest and latest day into whole weeks", () => {
		const { container } = renderHeatmap([
			{ value: 3, date: "2026-09-25" },
			{ value: 1, date: "2026-09-02" },
		]);

		expect(cellsOf(container)).toHaveLength(24);
		expect(screen.getByRole("img", { name: "Activity" }).getAttribute("viewBox")).toBe(
			"0 0 60 105",
		);
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

		expect(screen.getByText("4 on 2026-09-21")).toBeDefined();
	});

	it("renders nothing without days", () => {
		const { container } = renderHeatmap([]);

		expect(container.innerHTML).toBe("");
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
});
