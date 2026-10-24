import { afterEach, assert, describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	disposePluginBridges,
	mountPluginPage,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import { waitFor, within } from "@testing-library/dom";

import { buildMetricRows } from "../../shared/measurement-metrics";
import type { MeasurementSummary } from "../../shared/measurement-recipes";
import { ChartCard, MetricTiles } from "./overview";

afterEach(disposePluginBridges);

const now = new Date("2026-01-05T12:00:00.000Z");
const summary: MeasurementSummary = {
	id: "custom",
	key: "custom",
	unit: "mg/dL",
	rangeCount: 5,
	name: "Custom",
	latestValue: 74,
	firstAt: "2026-01-01T00:00:00.000Z",
	latestAt: "2026-01-05T00:00:00.000Z",
	pinnedAt: "2026-01-01T00:00:00.000Z",
};

function Overview() {
	const rows = buildMetricRows(
		[summary],
		[{ metricId: summary.id, points: [{ value: 74, at: "2026-01-05T00:00:00.000Z" }] }],
		{ bucket: "day", timeZone: "UTC" },
	);
	const selected = rows[0];
	assert(selected !== undefined);
	return (
		<>
			<MetricTiles
				now={now}
				range="1M"
				rows={rows}
				timeZone="UTC"
				onSelect={() => {}}
				selectedId={summary.id}
			/>
			<ChartCard
				now={now}
				range="1M"
				others={[]}
				compare={null}
				timeZone="UTC"
				compact={false}
				selected={selected}
				onCompareChange={() => {}}
				window={{ endAt: "2026-01-06T00:00:00.000Z", startAt: "2025-12-07T00:00:00.000Z" }}
			/>
		</>
	);
}

describe("measurement overview source labels", () => {
	it.live("labels grouped averages and uses source reading counts rather than bucket counts", () =>
		Effect.gen(function* () {
			mountPluginPage(Overview, {
				location: routeLocation("/v/all-measurements"),
				page: savedViewPageContext({
					settings: {},
					dataSources: { queries: {} },
					rendererName: "measurements",
					savedViewId: "all-measurements",
					view: { icon: "ruler", name: "All Measurements" },
				}),
			});
			const body = within(document.body);
			yield* Effect.promise(() =>
				waitFor(() => expect(body.getByRole("region", { name: "Metric chart" })).toBeTruthy()),
			);
			expect(body.getByRole("group", { name: "Pinned metrics" }).textContent).toContain(
				"5 readings in 30 days",
			);
			const chart = body.getByRole("region", { name: "Metric chart" });
			expect(chart.textContent).toContain("3- or 7-bucket smoothing within continuous runs");
			expect(chart.textContent).toContain(
				"Dots and the shaded low-to-high band show grouped averages",
			);
			expect(chart.textContent).toContain("Smoothing restarts after missing buckets");
			expect(chart.textContent).not.toContain("dots are readings");
			expect(chart.textContent).toContain("mg/dL");
		}),
	);
});
