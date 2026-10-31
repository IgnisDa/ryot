import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { countUnit, durationUnit, metricDelta } from "./metric-format";
import { ChartCard, MetricGrid } from "./metric-tile";

describe("MetricGrid", () => {
	it("pairs each formatted value with its label and change against the comparison period", () => {
		render(
			<MetricGrid
				variant="tiles"
				compact={false}
				comparisonLabel="vs previous period"
				metrics={[
					{
						value: 1771,
						key: "titles",
						label: "Completed",
						unit: countUnit("title"),
						delta: metricDelta(1771, 2040),
					},
					{
						key: "time",
						value: 89239,
						atLeast: true,
						label: "Active time",
						unit: durationUnit("seconds"),
						hint: "16 of 20 workouts timed",
						delta: metricDelta(89239, 89239),
					},
					{
						value: 2,
						key: "new",
						label: "Awards",
						unit: countUnit("award"),
						delta: metricDelta(2, 0),
					},
					{ value: 1, key: "plain", label: "Sets", unit: countUnit("set") },
				]}
			/>,
		);
		expect(screen.getAllByRole("term").map((term) => term.textContent)).toEqual([
			"Completed",
			"Active time",
			"Awards",
			"Sets",
		]);
		expect(screen.getAllByRole("definition").map((value) => value.textContent)).toEqual([
			"1,771titles",
			"↓ 13%-269 titles vs previous period",
			"≥24h 47m",
			"No change0s vs previous period",
			"16 of 20 workouts timed",
			"2awards",
			"New+2 awards vs previous period",
			"1set",
		]);
	});
});

describe("ChartCard", () => {
	it("titles its content and keeps actions beside the heading", () => {
		render(
			<ChartCard
				title="Trend"
				description="Oct 2 – 31, 2026"
				actions={<button type="button">Metric</button>}
			>
				<p>Chart</p>
			</ChartCard>,
		);
		expect(screen.getByRole("heading", { name: "Trend" })).toBeDefined();
		expect(screen.getByText("Oct 2 – 31, 2026")).toBeDefined();
		expect(screen.getByRole("button", { name: "Metric" })).toBeDefined();
		expect(screen.getByText("Chart")).toBeDefined();
	});
});
