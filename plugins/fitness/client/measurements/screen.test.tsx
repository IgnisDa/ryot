import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/client-sdk/effect";
import {
	disposePluginBridges,
	mountPluginPage,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/client-sdk/testing";
import { fireEvent, waitFor, within } from "@testing-library/dom";

import MeasurementsPage from "./screen";

afterEach(disposePluginBridges);

const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

const rows = (items: readonly Record<string, unknown>[]) => ({
	items,
	type: "rows",
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

const summary = (
	id: string,
	name: string,
	unit: string,
	rangeCount: number,
	latestValue: number,
	latestAt: string,
) => ({ id, name, unit, latestAt, rangeCount, latestValue, firstAt: latestAt });

const metrics = rows([
	summary("weight", "Weight", "kg", 3, 73.6, daysAgo(2)),
	summary("waist", "Waist", "cm", 1, 82, daysAgo(100)),
	summary("sugar", "Sugar level", "mg/dL", 0, 130, daysAgo(400)),
]);

const series = (counts: readonly number[], values: readonly number[]) => ({
	type: "timeSeries",
	buckets: counts.map((_, index) => ({
		value: values[index],
		endAt: daysAgo(9 - index),
		startAt: daysAgo(10 - index),
	})),
});

const reading = (
	id: string,
	metricId: string,
	name: string,
	value: number,
	occurredAt: string,
) => ({
	id,
	value,
	metricId,
	occurredAt,
	unit: null,
	comment: null,
	metricName: name,
	metricKey: metricId,
});

const readingsAt = daysAgo(2);
const logRows = rows([
	reading("r1", "weight", "Weight", 73.6, readingsAt),
	reading("r2", "sugar", "Sugar level", 130, readingsAt),
	reading("r3", "weight", "Weight", 73.1, daysAgo(5)),
]);

const queryData = (queries: Record<string, unknown>, metricRows: typeof metrics) =>
	Object.fromEntries(
		Object.keys(queries).map((key) => {
			if (key === "metrics") {
				return [key, metricRows];
			}
			if (key === "readings") {
				return [key, logRows];
			}
			const average = key.startsWith("average");
			const metric = Number(key.slice(average ? 7 : 5));
			const weight = [
				series([1, 1, 1], average ? [0, 73, 74] : [0, 1, 1]),
				series([1, 1, 1], average ? [82, 0, 0] : [1, 0, 0]),
			][metric];
			return [key, weight ?? series([0, 0, 0], [0, 0, 0])];
		}),
	);

const openPage = (metricRows = metrics) => {
	const page = mountPluginPage(MeasurementsPage, {
		location: routeLocation("/v/all-measurements"),
		page: savedViewPageContext({
			settings: {},
			dataSources: { queries: {} },
			rendererName: "measurements",
			savedViewId: "all-measurements",
			view: { icon: "ruler", name: "All Measurements" },
		}),
	});
	const answered = new Set<string>();
	const answerPending = () => {
		for (const request of page.queryRequests()) {
			if (!answered.has(request.requestId)) {
				answered.add(request.requestId);
				page.replyQuery(request.requestId, {
					outcome: "success",
					response: { data: queryData(request.document.queries, metricRows) },
				});
			}
		}
	};
	return { page, answerPending };
};

const text = (element: Element | null) => element?.textContent ?? "";

describe("measurements page", () => {
	it.live(
		"shows tiles for metrics logged in range, a chart, the metric list and the grouped log",
		() =>
			Effect.gen(function* () {
				const { page, answerPending } = openPage();
				const body = within(document.body);
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(body.getByRole("group", { name: "Top metrics" })).toBeTruthy();
						expect(body.getByRole("region", { name: "Log" }).querySelector("table")).not.toBeNull();
					}),
				);
				const chart = body.getByRole("region", { name: "Metric chart" });
				const metricList = body.getByRole("region", { name: "All metrics" });
				const log = body.getByRole("region", { name: "Log" });
				expect(page.container?.querySelector("h1")?.textContent).toBe("All Measurements");
				const tiles = within(body.getByRole("group", { name: "Top metrics" })).getAllByRole(
					"button",
				);
				expect(tiles.map((tile) => text(tile))).toEqual([
					expect.stringContaining("Weight"),
					expect.stringContaining("Waist"),
				]);
				expect(text(tiles[0] ?? null)).toContain("73.6 kg");
				expect(text(tiles[1] ?? null)).toContain("last");
				expect(within(chart).getByRole("heading").textContent).toBe("Weight (kg)");
				expect(within(metricList).getAllByRole("row")).toHaveLength(4);

				fireEvent.click(within(metricList).getByRole("button", { name: "Waist" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(within(chart).getByRole("heading").textContent).toBe("Waist (cm)")),
				);

				fireEvent.click(within(metricList).getByRole("button", { name: "Sugar level" }));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(text(chart)).toContain("No sugar level readings in the last 12 months."),
					),
				);

				expect(text(log)).toContain("2 readings");
				fireEvent.click(within(log).getByRole("button", { name: "+1" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(text(log)).toContain("Sugar level130 mg/dL")),
				);
			}),
	);

	it.live("prompts to log or import when the user has no metrics", () =>
		Effect.gen(function* () {
			const { answerPending } = openPage(rows([]));
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(within(document.body).getByText("No measurements yet")).toBeTruthy();
				}),
			);
			expect(within(document.body).getByRole("button", { name: "Log measurement" })).toBeTruthy();
		}),
	);
});
