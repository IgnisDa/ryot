import { afterEach, describe, expect, it } from "@effect/vitest";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { PluginId } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createTestRyotClock,
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import { TimeZone } from "@ryot-app/plugin-kit/schema";
import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import { useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { AnalyticsMeasurements } from "./measurements";
import type { AnalyticsScope, MeasurementReading } from "./reporting-model";

afterEach(disposePluginBridges);

const documentText = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
type QueryReply = Parameters<ReturnType<typeof mountPluginPage>["replyQuery"]>[1];

const selection: AnalyticsScope["selection"] = {
	grouping: "day",
	comparison: "none",
	range: { kind: "custom", endDate: "2026-03-07", startDate: "2026-03-01" },
};
const comparisonSelection: AnalyticsScope["selection"] = {
	grouping: "month",
	comparison: "previous-period",
	range: { kind: "custom", endDate: "2026-03-31", startDate: "2026-03-01" },
};

const metric = (id: string, name: string, unit: null | string) => ({
	id,
	name,
	unit,
	key: null,
	firstAt: null,
	rangeCount: 0,
	latestAt: null,
	pinnedAt: null,
	latestValue: null,
});
const pageResponse = (
	key: string,
	items: readonly Record<string, unknown>[],
	nextCursor: null | string = null,
	limit = 100,
) => ({
	data: {
		[key]: {
			items,
			type: "rows" as const,
			pageInfo: { limit, nextCursor, hasMore: nextCursor !== null },
		},
	},
});
const trendResponse = (points: readonly Readonly<Record<string, JsonValue>>[]) => ({
	data: {
		trend: {
			items: points,
			type: "aggregate" as const,
			pageInfo: { limit: 366, hasMore: false, nextCursor: null },
		},
	},
});
const reading = (
	input: Omit<MeasurementReading, "comment"> & { readonly comment?: MeasurementReading["comment"] },
) => ({ ...input, comment: input.comment ?? null });
const trendPoint = (at: string, value: null | number, readings: number, unit: null | string) => ({
	at,
	unit,
	value,
	readings,
});

const scopeFor = (owner = "fitness-owner", selected = selection): AnalyticsScope => ({
	selection: selected,
	timeZone: TimeZone.make("America/New_York"),
	reference: { kind: "local", pluginId: PluginId.make(owner) },
});

const mountMeasurements = (clock: ReturnType<typeof createTestRyotClock>, selected = selection) => {
	const page = mountPluginPage(
		() => <AnalyticsMeasurements compact={false} scope={scopeFor("fitness-owner", selected)} />,
		{
			bootstrap: clock.bootstrap,
			location: routeLocation("/v/analytics"),
			page: {
				...savedViewPageContext({
					settings: {},
					savedViewId: "analytics",
					rendererName: "analytics",
					dataSources: { queries: {} },
					view: { icon: "chart", name: "Analytics" },
				}),
				contributors: ["fitness-owner", "fitness-other"].map((pluginId) =>
					pluginContributor({ pluginId, name: "Fitness", packageId: PLUGIN_PACKAGE_ID }),
				),
			},
		},
	);
	return page;
};

const mountOwnerSwitch = (clock: ReturnType<typeof createTestRyotClock>) =>
	mountPluginPage(
		function OwnerSwitch() {
			const [owner, setOwner] = useState("fitness-owner");
			return (
				<>
					<button onClick={() => setOwner("fitness-other")}>Switch owner</button>
					<AnalyticsMeasurements compact={false} scope={scopeFor(owner)} />
				</>
			);
		},
		{
			bootstrap: clock.bootstrap,
			location: routeLocation("/v/analytics"),
			page: {
				...savedViewPageContext({
					settings: {},
					savedViewId: "analytics",
					rendererName: "analytics",
					dataSources: { queries: {} },
					view: { icon: "chart", name: "Analytics" },
				}),
				contributors: ["fitness-owner", "fitness-other"].map((pluginId) =>
					pluginContributor({ pluginId, name: "Fitness", packageId: PLUGIN_PACKAGE_ID }),
				),
			},
		},
	);

const replyMetrics = (
	page: ReturnType<typeof mountPluginPage>,
	items: readonly ReturnType<typeof metric>[],
	nextCursor: null | string = null,
) => {
	const request = page.queryRequests("metrics").at(-1);
	if (request !== undefined) {
		page.replyQuery(request.requestId, {
			outcome: "success",
			response: pageResponse("metrics", items, nextCursor),
		});
	}
};

const replyRequest = (
	page: ReturnType<typeof mountPluginPage>,
	queryKey: string,
	index: number,
	outcome: QueryReply,
) => {
	const request = page.queryRequests(queryKey)[index];
	if (request === undefined) {
		throw new Error(`Missing ${queryKey} query request at index ${index}`);
	}
	page.replyQuery(request.requestId, outcome);
};

const metricOptionName = (name: string) => new RegExp(`^${name}`);

const chooseMetric = (
	page: ReturnType<typeof mountPluginPage>,
	name: string,
	metricData: ReturnType<typeof metric>,
) =>
	Effect.gen(function* () {
		yield* openPicker(page);
		replyMetrics(page, [metricData]);
		const option = yield* Effect.promise(() =>
			screen.findByRole("button", { name: metricOptionName(name) }),
		);
		fireEvent.click(option);
		yield* Effect.promise(() =>
			waitFor(() => expect(page.queryRequests("trend")).not.toHaveLength(0)),
		);
		yield* Effect.promise(() =>
			waitFor(() => expect(page.queryRequests("readings")).toHaveLength(1)),
		);
	});

const openPicker = (page: ReturnType<typeof mountPluginPage>) =>
	Effect.gen(function* () {
		const trigger = yield* Effect.promise(() =>
			screen.findByRole("button", { name: "Choose a metric" }),
		);
		fireEvent.click(trigger);
		yield* Effect.promise(() =>
			waitFor(() => expect(page.queryRequests("metrics")).not.toHaveLength(0)),
		);
		return trigger;
	});

const dispose = (
	page: ReturnType<typeof mountPluginPage>,
	clock: ReturnType<typeof createTestRyotClock>,
) =>
	Effect.gen(function* () {
		page.dispose();
		yield* Effect.promise(() => clock.dispose());
	});

describe("Fitness analytics measurements", () => {
	it.live("does not query until the picker opens and selection starts owner-scoped data", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountMeasurements(clock);
			try {
				expect(page.queryRequests()).toHaveLength(0);
				yield* openPicker(page);
				const metricRequest = page.queryRequests("metrics")[0];
				expect(yield* documentText(metricRequest?.document)).toContain("fitness-owner");
				replyMetrics(page, [metric("custom-metric", "Custom measure", "stone")]);
				const metricOption = yield* Effect.promise(() =>
					screen.findByRole("button", { name: metricOptionName("Custom measure") }),
				);
				fireEvent.click(metricOption);
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("trend")).toHaveLength(1)),
				);
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("readings")).toHaveLength(1)),
				);
				for (const request of [...page.queryRequests("trend"), ...page.queryRequests("readings")]) {
					expect(yield* documentText(request.document)).toContain("fitness-owner");
					expect(yield* documentText(request.document)).toContain("custom-metric");
				}
			} finally {
				yield* dispose(page, clock);
			}
		}),
	);

	it.live("pages beyond 100 metrics and retains the selected metric's custom unit and zero", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountMeasurements(clock);
			try {
				yield* openPicker(page);
				const firstPage = Array.from({ length: 100 }, (_, index) =>
					metric(`metric-${index}`, `Metric ${index}`, index === 99 ? "stone" : "unit"),
				);
				replyMetrics(page, firstPage, "metrics-cursor");
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("Metric 99")).toBeDefined()),
				);
				expect(screen.queryByText("Metric 100")).toBeNull();
				fireEvent.click(screen.getByRole("button", { name: "Load more metrics" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("metrics")).toHaveLength(2)),
				);
				expect(yield* documentText(page.queryRequests("metrics")[1]?.document)).toContain(
					"metrics-cursor",
				);
				replyMetrics(page, [metric("metric-100", "Metric 100", "stone")]);
				const metricOption = yield* Effect.promise(() =>
					screen.findByRole("button", { name: metricOptionName("Metric 100") }),
				);
				fireEvent.click(metricOption);
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("trend")).toHaveLength(1)),
				);
				replyRequest(page, "trend", 0, {
					outcome: "success",
					response: trendResponse([
						trendPoint("2026-03-01T05:00:00.000Z", 0, 2, "stone"),
						trendPoint("2026-03-03T05:00:00.000Z", 4, 1, "stone"),
					]),
				});
				replyRequest(page, "readings", 0, {
					outcome: "success",
					response: pageResponse("readings", []),
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByLabelText("Metric 100 bucket averages")).toBeDefined()),
				);
				fireEvent.click(screen.getByText("View exact values"));
				yield* Effect.promise(() => screen.findByText(/^0 stone/));
				expect(screen.getAllByText(/Not recorded · No readings/)).toHaveLength(5);
			} finally {
				yield* dispose(page, clock);
			}
		}),
	);

	it.live("labels smoothing, preserves source averages, and keeps exact readings raw", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountMeasurements(clock);
			try {
				yield* chooseMetric(page, "Body measure", metric("body", "Body measure", "custom-u"));
				replyRequest(page, "trend", 0, {
					outcome: "success",
					response: trendResponse([
						trendPoint("2026-03-01T05:00:00.000Z", 2, 1, "custom-u"),
						trendPoint("2026-03-02T05:00:00.000Z", 6, 3, "custom-u"),
						trendPoint("2026-03-03T05:00:00.000Z", 4, 2, "custom-u"),
					]),
				});
				replyRequest(page, "readings", 0, {
					outcome: "success",
					response: pageResponse("readings", [
						reading({
							value: 12.75,
							id: "raw-one",
							unit: "custom-u",
							comment: "Reading comment",
							entryId: "entry-plain-text",
							occurredAt: "2026-03-02T15:30:00.000Z",
						}),
					]),
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("1 loaded")).toBeDefined()),
				);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByLabelText("Body measure bucket averages")).toBeDefined(),
					),
				);
				fireEvent.click(
					screen.getByRole("checkbox", { name: "Smooth bucket averages (3/7-point)" }),
				);
				expect(
					screen.getByText(/Smoothing uses rolling averages of the grouped bucket averages/),
				).toBeDefined();
				fireEvent.click(screen.getByText("View exact values"));
				yield* Effect.promise(() => screen.findByText(/source average 2 custom-u/));
				const readingsTable = screen.getByRole("table", { name: /Loaded measurement readings/ });
				expect(within(readingsTable).getByText("12.75 custom-u")).toBeDefined();
				expect(within(readingsTable).getByText("entry-plain-text").closest("a")).toBeNull();
				expect(within(readingsTable).getByText("Reading comment")).toBeDefined();
				expect(within(readingsTable).getByText("Mar 2, 2026, 10:30 AM")).toBeDefined();
			} finally {
				yield* dispose(page, clock);
			}
		}),
	);

	it.live("shows actual previous dates and unequal extra buckets in the exact values", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountMeasurements(clock, comparisonSelection);
			try {
				yield* chooseMetric(page, "Weight", metric("weight", "Weight", "kg"));
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("trend")).toHaveLength(2)),
				);
				replyRequest(page, "trend", 0, {
					outcome: "success",
					response: trendResponse([trendPoint("2026-03-01T05:00:00.000Z", 8, 2, "kg")]),
				});
				replyRequest(page, "trend", 1, {
					outcome: "success",
					response: trendResponse([
						trendPoint("2026-01-01", 2, 1, "kg"),
						trendPoint("2026-02-01", 4, 3, "kg"),
					]),
				});
				replyRequest(page, "readings", 0, {
					outcome: "success",
					response: pageResponse("readings", []),
				});
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByText("Previous · 2026-01-29 – 2026-02-28")).toBeDefined(),
					),
				);
				fireEvent.click(screen.getByText("View exact values"));
				const table = yield* Effect.promise(() =>
					screen.findByRole("table", { name: "Weight bucket averages exact values" }),
				);
				expect(within(table).getAllByRole("row")).toHaveLength(4);
				expect(within(table).getByText(/Feb 1, 2026/)).toBeDefined();
			} finally {
				yield* dispose(page, clock);
			}
		}),
	);

	it.live("warns when trends mix units instead of drawing a misleading axis", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountMeasurements(clock);
			try {
				yield* chooseMetric(page, "Weight", metric("weight", "Weight", "kg"));
				replyRequest(page, "trend", 0, {
					outcome: "success",
					response: trendResponse([
						trendPoint("2026-03-01T05:00:00.000Z", 8, 2, "kg"),
						trendPoint("2026-03-02T05:00:00.000Z", 16, 1, "lb"),
					]),
				});
				replyRequest(page, "readings", 0, {
					outcome: "success",
					response: pageResponse("readings", []),
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("Mixed units")).toBeDefined()),
				);
				expect(screen.queryByLabelText("Weight bucket averages")).toBeNull();
			} finally {
				yield* dispose(page, clock);
			}
		}),
	);

	it.live("retains loaded rows after append failure and retry without claiming a full count", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountMeasurements(clock);
			try {
				yield* chooseMetric(page, "Weight", metric("weight", "Weight", "kg"));
				replyRequest(page, "trend", 0, { outcome: "success", response: trendResponse([]) });
				replyRequest(page, "readings", 0, {
					outcome: "success",
					response: pageResponse(
						"readings",
						[
							reading({
								value: 0,
								unit: "kg",
								id: "row-1",
								entryId: "entry-one",
								occurredAt: "2026-03-03T15:30:00.000Z",
							}),
						],
						"readings-cursor",
					),
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("1 loaded")).toBeDefined()),
				);
				fireEvent.click(screen.getByRole("button", { name: "Load more readings" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("readings")).toHaveLength(2)),
				);
				replyRequest(page, "readings", 1, { outcome: "failure", reason: "query-failed" });
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText(/Could not update readings/)).toBeDefined()),
				);
				expect(screen.getByText("Loaded readings")).toBeDefined();
				expect(screen.getByText("1 loaded")).toBeDefined();
				expect(screen.getByText("entry-one")).toBeDefined();
				fireEvent.click(screen.getByRole("button", { name: "Retry readings" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("readings")).toHaveLength(3)),
				);
				expect(yield* documentText(page.queryRequests("readings")[2]?.document)).toContain(
					"readings-cursor",
				);
				replyRequest(page, "readings", 2, {
					outcome: "success",
					response: pageResponse("readings", [
						reading({
							value: 6.5,
							unit: "kg",
							id: "row-2",
							entryId: "entry-two",
							occurredAt: "2026-03-02T15:30:00.000Z",
						}),
					]),
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("2 loaded")).toBeDefined()),
				);
				expect(screen.queryByText(/of \d+ readings/)).toBeNull();
			} finally {
				yield* dispose(page, clock);
			}
		}),
	);

	it.live("uses modal dismissal to restore picker focus", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountMeasurements(clock);
			try {
				const trigger = yield* openPicker(page);
				trigger.focus();
				fireEvent.keyDown(document, { key: "Escape" });
				yield* Effect.promise(() => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()));
				expect(document.activeElement).toBe(trigger);
				expect(page.queryRequests("trend")).toHaveLength(0);
				expect(page.queryRequests("readings")).toHaveLength(0);
			} finally {
				yield* dispose(page, clock);
			}
		}),
	);

	it.live("clears owner selection and ignores a late picker page from the prior owner", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountOwnerSwitch(clock);
			try {
				yield* openPicker(page);
				const firstRequest = page.queryRequests("metrics")[0];
				if (firstRequest === undefined) {
					return;
				}
				const switchOwner = yield* Effect.promise(() =>
					screen.findByRole("button", { name: "Switch owner" }),
				);
				fireEvent.click(switchOwner);
				yield* Effect.promise(() => screen.findByRole("button", { name: "Choose a metric" }));
				page.replyQuery(firstRequest.requestId, {
					outcome: "success",
					response: pageResponse("metrics", [metric("old", "Old owner metric", "kg")]),
				});
				yield* openPicker(page);
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("metrics")).toHaveLength(2)),
				);
				expect(yield* documentText(page.queryRequests("metrics")[1]?.document)).toContain(
					"fitness-other",
				);
				expect(screen.queryByText("Old owner metric")).toBeNull();
				replyMetrics(page, [metric("new", "New owner metric", "kg")]);
				const metricOption = yield* Effect.promise(() =>
					screen.findByRole("button", { name: metricOptionName("New owner metric") }),
				);
				fireEvent.click(metricOption);
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("trend")).toHaveLength(1)),
				);
				expect(yield* documentText(page.queryRequests("trend")[0]?.document)).toContain(
					"fitness-other",
				);
				expect(yield* documentText(page.queryRequests("trend")[0]?.document)).not.toContain(
					"fitness-owner",
				);
			} finally {
				yield* dispose(page, clock);
			}
		}),
	);
});
