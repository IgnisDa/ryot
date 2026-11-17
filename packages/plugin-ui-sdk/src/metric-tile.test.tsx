import { describe, expect, it } from "bun:test";

import { testText } from "@ryot-app/kernel-messages/testing";
import { screen } from "@testing-library/react";

import { render } from "./i18n.test-support";
import { countUnit, durationUnit, metricDelta } from "./metric-format";
import { ChartCard, MetricGrid } from "./metric-tile";

const plural = (one: string, other: string) => countUnit((count) => (count === 1 ? one : other));

describe("MetricGrid", () => {
	it("pairs each formatted value with its label and change against the comparison period", () => {
		render(
			<MetricGrid
				variant="tiles"
				compact={false}
				comparisonLabel={testText("vs previous period")}
				metrics={[
					{
						value: 1771,
						key: "titles",
						label: testText("Completed"),
						delta: metricDelta(1771, 2040),
						unit: plural("title", "titles"),
					},
					{
						key: "time",
						value: 89239,
						atLeast: true,
						unit: durationUnit("seconds"),
						label: testText("Active time"),
						hint: "16 of 20 workouts timed",
						delta: metricDelta(89239, 89239),
					},
					{
						value: 2,
						key: "new",
						delta: metricDelta(2, 0),
						label: testText("Awards"),
						unit: plural("award", "awards"),
					},
					{ value: 1, key: "plain", label: testText("Sets"), unit: plural("set", "sets") },
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
				title={testText("Trend")}
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
