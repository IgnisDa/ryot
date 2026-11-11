import { afterEach, describe, expect } from "bun:test";

import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { PluginId } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createTestRyotClock,
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
	savedViewPageContext,
	waitForMessagePortMacrotask,
} from "@ryot-app/plugin-client-sdk/testing";
import { TimeZone } from "@ryot-app/plugin-kit/schema";
import { bindTestRequest, requireInlineDocument } from "@ryot-app/ryotql-recipes/test-utils";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";
import { act, type ComponentType } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	analyticsSummary,
	reportingSelectionResponse,
	zeroMeasures,
} from "../../tests/client/analytics-fixture";
import { MediaAnalyticsCharts } from "./charts";
import type { AnalyticsInput, SummaryChartsProps } from "./model";

afterEach(disposePluginBridges);

const owner: AnalyticsInput["reference"] = {
	kind: "local",
	pluginId: PluginId.make("media-owner"),
};
const now = Date.parse("2026-03-05T18:00:00Z");
const documentText = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const aggregate = (items: readonly Record<string, null | number | string>[]) => ({
	items,
	type: "aggregate" as const,
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

const inputFor = (selection: AnalyticsInput["selection"]): AnalyticsInput => ({
	selection,
	reference: owner,
	timeZone: TimeZone.make("America/New_York"),
});

const chartProps = (
	input: AnalyticsInput,
	requests: Parameters<SummaryChartsProps["onDrill"]>[0][] = [],
): SummaryChartsProps => ({
	input,
	summary: analyticsSummary(input, { now }),
	onDrill: (request) => requests.push(request),
});

const mountPage = (clock: ReturnType<typeof createTestRyotClock>, component: ComponentType) =>
	mountPluginPage(component, {
		bootstrap: clock.bootstrap,
		location: routeLocation("/v/k/analytics"),
		queryExecution: () => ({ now: clock.now(), timeZone: TimeZone.make("America/New_York") }),
		page: {
			...savedViewPageContext({
				settings: {},
				savedViewId: "analytics",
				rendererName: "analytics",
				dataSources: { queries: {} },
				view: { icon: "chart", name: "Analytics" },
			}),
			contributors: [
				pluginContributor({ name: "Media", pluginId: "media-owner", packageId: PLUGIN_PACKAGE_ID }),
			],
		},
	});

const mountCharts = (clock: ReturnType<typeof createTestRyotClock>, props: SummaryChartsProps) =>
	mountPage(clock, () => <MediaAnalyticsCharts {...props} />);

const trendRow = (overrides: Record<string, null | number | string> = {}) => ({
	...zeroMeasures,
	pagesKnown: 1,
	at: "2026-03-02",
	titleCompletions: 1,
	pagesRecorded: 12.5,
	activeObservations: 1,
	...overrides,
});

const hourRow = { ...trendRow({ titleCompletions: 2 }), hour: 8 };

const requestsNotReplied = (
	page: ReturnType<typeof mountCharts>,
	replied: Set<string>,
	query?: string,
) => page.queryRequests(query).filter((request) => !replied.has(request.requestId));

const replyRequests = (
	page: ReturnType<typeof mountCharts>,
	replied: Set<string>,
	options: { readonly trendAt?: string; readonly includeTrendRow?: boolean } = {},
) => {
	for (const request of requestsNotReplied(page, replied)) {
		replied.add(request.requestId);
		const queries = bindTestRequest(request.request).queries;
		const series = aggregate(
			options.includeTrendRow
				? [trendRow(options.trendAt === undefined ? {} : { at: options.trendAt })]
				: [],
		);
		page.replyQuery(request.requestId, {
			outcome: "success",
			response: {
				data: Object.hasOwn(queries, "hourly")
					? { hourly: aggregate([hourRow]) }
					: {
							current: series,
							selection: reportingSelectionResponse(request.request.arguments ?? {}),
							...(Object.hasOwn(queries, "previous")
								? {
										previous: aggregate([
											trendRow({ at: "2026-01-29" }),
											trendRow({ at: "2026-01-31" }),
										]),
									}
								: {}),
						},
			},
		});
	}
};

const choose = (label: string, selected: string, option: string) =>
	Effect.gen(function* () {
		yield* Effect.promise(() =>
			act(() => fireEvent.click(screen.getByRole("button", { name: `${label}: ${selected}` }))),
		);
		yield* Effect.promise(() =>
			act(() => fireEvent.click(screen.getByRole("menuitemradio", { name: option }))),
		);
	});

const tableToggles = () => screen.getAllByRole("radio", { name: "Table" });

const openExactValues = (index: number) =>
	Effect.gen(function* () {
		const toggle = tableToggles()[index];
		expect(toggle).toBeDefined();
		if (toggle === undefined) {
			return;
		}
		if (toggle.getAttribute("aria-checked") !== "true") {
			yield* Effect.promise(() => act(() => fireEvent.click(toggle)));
		}
	});

describe("Media analytics charts UI", () => {
	it.live(
		"keeps null quantity gaps, selects exact metric/type, and drills into trend, hour, and day scopes",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				yield* Effect.promise(() => clock.setTime(now));
				const input = inputFor({
					grouping: "day",
					comparison: "none",
					range: { kind: "custom", endDate: "2026-03-03", startDate: "2026-03-02" },
				});
				const requests: Parameters<SummaryChartsProps["onDrill"]>[0][] = [];
				const page = mountCharts(clock, chartProps(input, requests));
				const replied = new Set<string>();
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests().length).toBeGreaterThanOrEqual(3)),
					);
					replyRequests(page, replied, { includeTrendRow: true });
					yield* Effect.promise(() => waitFor(() => expect(tableToggles()).toHaveLength(3)));
					const requestTexts = yield* Effect.forEach(page.queryRequests(), (request) =>
						documentText(requireInlineDocument(request.request)),
					);
					expect(requestTexts.every((text) => text.includes('"name":"reportingTimeZone"'))).toBe(
						true,
					);
					yield* choose("Show", "Activity entries", "Pages");
					yield* choose("Type", "All", "Book");
					yield* Effect.promise(() =>
						waitFor(() => expect(requestsNotReplied(page, replied).length).toBe(2)),
					);
					expect(
						yield* documentText(
							bindTestRequest(requestsNotReplied(page, replied, "current")[0]?.request),
						),
					).toContain('"book"');
					replyRequests(page, replied, { includeTrendRow: true });
					yield* Effect.promise(() => waitFor(() => expect(tableToggles()).toHaveLength(3)));
					yield* openExactValues(0);
					const trendValues = screen.getByRole("table", {
						name: "Pages by reporting period exact values",
					});
					expect(trendValues.textContent).toContain("12.5 pages");
					expect(trendValues.textContent).toContain("Not recorded");
					fireEvent.click(
						screen.getByRole("button", { name: "View records: Mar 2, 2026 · 12.5 pages" }),
					);
					expect(requests.at(-1)).toMatchObject({
						mediaType: "book",
						selection: {
							comparison: "none",
							range: { kind: "custom", endDate: "2026-03-02", startDate: "2026-03-02" },
						},
					});
					yield* choose("Show", "Pages", "Titles completed");
					yield* openExactValues(0);
					fireEvent.click(
						screen.getByRole("button", { name: "View records: Mar 2, 2026 · 1 title" }),
					);
					expect(requests.at(-1)?.mediaType).toBe("book");
					yield* openExactValues(1);
					fireEvent.click(screen.getByRole("button", { name: /View records: 08:00–09:00/ }));
					expect(requests.at(-1)).toMatchObject({
						hour: 8,
						mediaType: "book",
						selection: {
							range: { kind: "custom", endDate: "2026-03-03", startDate: "2026-03-02" },
						},
					});
					yield* openExactValues(2);
					fireEvent.click(
						within(
							screen.getByRole("table", { name: /^Daily activity entries .* exact values$/ }),
						).getByRole("button", { name: /View records: Mar 2, 2026/ }),
					);
					expect(requests.at(-1)).toMatchObject({
						activeOnly: true,
						selection: {
							range: { kind: "custom", endDate: "2026-03-02", startDate: "2026-03-02" },
						},
					});
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
		testTimeout,
	);

	it.live(
		"lists extra previous dates in the exact values instead of aligning them to invented zero buckets",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				yield* Effect.promise(() => clock.setTime(now));
				const input = inputFor({
					grouping: "day",
					comparison: "previous-period",
					range: { offset: -1, unit: "month", kind: "calendar" },
				});
				const page = mountCharts(clock, chartProps(input));
				const replied = new Set<string>();
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("previous")).toHaveLength(2)),
					);
					replyRequests(page, replied, { includeTrendRow: true, trendAt: "2026-02-10" });
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getAllByText("Feb 1 – 28, 2026").length).toBeGreaterThan(0),
						),
					);
					yield* openExactValues(0);
					const trendValues = screen.getByRole("table", {
						name: "Activity entries by reporting period exact values",
					});
					expect(trendValues.textContent).toContain("Jan 29, 2026");
					expect(trendValues.textContent).toContain("Jan 31, 2026");
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
		testTimeout,
	);

	it.live(
		"clips the all-time heatmap and preserves each region's successful values after refresh errors",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				yield* Effect.promise(() => clock.setTime(now));
				const input = inputFor({
					grouping: "day",
					comparison: "none",
					range: { kind: "all-time" },
				});
				const page = mountCharts(clock, chartProps(input));
				const replied = new Set<string>();
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests().length).toBeGreaterThanOrEqual(3)),
					);
					const requests = page.queryRequests("current");
					expect(
						requests.filter(({ request }) => request.arguments?.["consistency"] === true),
					).toHaveLength(1);
					expect(requests.every(({ request }) => request.arguments?.["range"] === "all-time")).toBe(
						true,
					);
					replyRequests(page, replied, { includeTrendRow: true });
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByText(/All media types · .* · last 366 days/)).toBeDefined(),
						),
					);
					yield* openExactValues(0);
					yield* openExactValues(1);
					yield* openExactValues(2);
					const tables = screen.getAllByRole("table");
					const loaded = tables.map((table) => table.textContent);
					expect(loaded.join(" ")).toContain("1 entry");
					page.send({ type: "page-refresh" });
					yield* waitForMessagePortMacrotask;
					yield* Effect.promise(() => clock.advance(250));
					yield* Effect.promise(() =>
						waitFor(() => expect(requestsNotReplied(page, replied).length).toBe(3)),
					);
					for (const request of requestsNotReplied(page, replied)) {
						replied.add(request.requestId);
						page.replyQuery(request.requestId, { outcome: "failure", reason: "query-failed" });
					}
					yield* Effect.promise(() => clock.advance(0));
					for (const label of ["Retry trend", "Retry hourly activity", "Retry consistency"]) {
						yield* Effect.promise(() =>
							waitFor(() => expect(screen.getByRole("button", { name: label })).toBeDefined()),
						);
					}
					expect(tables.map((table) => table.textContent)).toEqual(loaded);
					yield* Effect.promise(() =>
						act(() => fireEvent.click(screen.getByRole("button", { name: "Retry consistency" }))),
					);
					yield* Effect.promise(() =>
						waitFor(() => expect(requestsNotReplied(page, replied).length).toBe(1)),
					);
					replyRequests(page, replied);
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.queryByRole("button", { name: "Retry consistency" })).toBeNull(),
						),
					);
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
		testTimeout,
	);
});
