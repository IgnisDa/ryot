import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CalendarHeatmap, type CalendarHeatmapDay, RankedBarList } from "./charts";

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
					{ value: 5, key: "book", label: "Books" },
					{ value: 20, key: "movie", label: "Movies" },
					{ value: 10, key: "show", label: "Shows" },
				]}
			/>,
		);

		const items = within(screen.getByRole("list")).getAllByRole("listitem");
		expect(items.map((item) => item.textContent)).toEqual([
			"Movies20 events",
			"Shows10 events",
			"Books5 events",
		]);
		expect(
			items.map((item) => item.querySelector<HTMLElement>(".bg-chart-accent")?.style.width),
		).toEqual(["100%", "50%", "25%"]);
	});
});
