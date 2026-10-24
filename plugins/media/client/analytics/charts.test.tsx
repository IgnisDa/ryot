import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
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
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { act, type ComponentType, useState } from "react";

import { mediaConsumptionReportRecipe } from "../../shared/consumption-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { MediaAnalyticsCharts } from "./charts";
import {
	type AnalyticsInput,
	analyticsWindow,
	periodCaption,
	reportingExecution,
	type SummaryChartsProps,
} from "./model";

afterEach(disposePluginBridges);

const owner: AnalyticsInput["reference"] = {
	kind: "local",
	pluginId: PluginId.make("media-owner"),
};
const now = Date.parse("2026-03-05T18:00:00Z");
const documentText = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const aggregate = (
	items: readonly Record<string, null | number | string>[],
	hasMore = false,
): {
	readonly type: "aggregate";
	readonly items: readonly Record<string, null | number | string>[];
	readonly pageInfo: { readonly limit: number; readonly hasMore: boolean };
} => ({ items, type: "aggregate", pageInfo: { hasMore, limit: 1000 } });

const inputFor = (selection: AnalyticsInput["selection"]): AnalyticsInput => ({
	selection,
	reference: owner,
	timeZone: "America/New_York",
});

const reportFor = (input: AnalyticsInput, processing: "ready" | "failed" | "pending" = "ready") => {
	const pending = processing === "pending" ? 1 : 0;
	const failed = processing === "failed" ? 1 : 0;
	const totals = {
		pagesMissing: 0,
		pagesRecorded: 0,
		pagesEstimated: 0,
		minutesMissing: 0,
		volumesMissing: 0,
		minutesRecorded: 0,
		episodesMissing: 0,
		chaptersMissing: 0,
		volumesRecorded: 0,
		titleCompletions: 0,
		minutesEstimated: 0,
		episodesRecorded: 0,
		chaptersRecorded: 0,
		volumesEstimated: 0,
		episodesEstimated: 0,
		chaptersEstimated: 0,
		episodeCompletions: 0,
		activeObservations: 0,
	};
	const data = Result.getOrThrow(
		mediaConsumptionReportRecipe({ ...input, now }).decode({
			data: {
				hourly: aggregate([]),
				trends: aggregate([]),
				reviews: aggregate([]),
				rankings: aggregate([]),
				previous: aggregate([]),
				current: aggregate([
					{ ...totals, mediaType: "book" },
					{ ...totals, mediaType: "show-episode" },
				]),
				coverage: aggregate([
					{ failed, pending, unknownDate: 0, mediaType: "book" },
					{ failed, pending, unknownDate: 0, mediaType: "show-episode" },
				]),
			},
		}),
	);
	return { ...data, reporting: reportingExecution(input, now) };
};

const chartProps = (
	input: AnalyticsInput,
	processing: "ready" | "failed" | "pending" = "ready",
	requests: Parameters<SummaryChartsProps["onDrill"]>[0][] = [],
): SummaryChartsProps => ({
	input,
	report: reportFor(input, processing),
	onDrill: (request) => requests.push(request),
});

const mountPage = (clock: ReturnType<typeof createTestRyotClock>, component: ComponentType) =>
	mountPluginPage(component, {
		bootstrap: clock.bootstrap,
		location: routeLocation("/v/k/analytics"),
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
	pagesKnown: 1,
	pagesMissing: 0,
	minutesKnown: 0,
	volumesKnown: 0,
	at: "2026-03-02",
	episodesKnown: 0,
	chaptersKnown: 0,
	precision: "date",
	mediaType: "book",
	pagesEstimated: 0,
	minutesMissing: 0,
	volumesMissing: 0,
	pagesSuperseded: 0,
	minutesRecorded: 0,
	episodesMissing: 0,
	chaptersMissing: 0,
	volumesRecorded: 0,
	titleCompletions: 1,
	pagesRecorded: 12.5,
	minutesEstimated: 0,
	episodesRecorded: 0,
	chaptersRecorded: 0,
	volumesEstimated: 0,
	minutesSuperseded: 0,
	episodesEstimated: 0,
	chaptersEstimated: 0,
	volumesSuperseded: 0,
	episodeCompletions: 0,
	activeObservations: 1,
	episodesSuperseded: 0,
	chaptersSuperseded: 0,
	...overrides,
});

const hourRow = { ...trendRow({ titleCompletions: 2, pagesRecorded: 12.5 }), hour: 8 };

const requestsNotReplied = (
	page: ReturnType<typeof mountCharts>,
	replied: Set<string>,
	query?: string,
) => page.queryRequests(query).filter((request) => !replied.has(request.requestId));

const replyRequests = (
	page: ReturnType<typeof mountCharts>,
	replied: Set<string>,
	options: { readonly includeTrendRow?: boolean; readonly fail?: (query: string) => boolean } = {},
) => {
	for (const request of requestsNotReplied(page, replied)) {
		replied.add(request.requestId);
		const keys = Object.keys(request.document.queries);
		let query = keys.join(",");
		if (keys.includes("trend")) {
			query = "trend";
		} else if (keys.includes("hourly")) {
			query = "hourly";
		} else if (keys.includes("dates") || keys.includes("instants")) {
			query = "consistency";
		}
		if (options.fail?.(query)) {
			page.replyQuery(request.requestId, { outcome: "failure", reason: "query-failed" });
			continue;
		}
		if (query === "trend") {
			page.replyQuery(request.requestId, {
				outcome: "success",
				response: { data: { trend: aggregate(options.includeTrendRow ? [trendRow()] : []) } },
			});
		} else if (query === "hourly") {
			page.replyQuery(request.requestId, {
				outcome: "success",
				response: { data: { hourly: aggregate([hourRow]) } },
			});
		} else {
			page.replyQuery(request.requestId, {
				outcome: "success",
				response: {
					data: { instants: aggregate([]), dates: aggregate([{ events: 2, day: "2026-03-02" }]) },
				},
			});
		}
	}
};

const choose = (label: string, selected: string, option: string) =>
	Effect.gen(function* () {
		yield* Effect.promise(() =>
			act(() => fireEvent.click(screen.getByRole("button", { name: `${label}: ${selected}` }))),
		);
		yield* Effect.promise(() =>
			act(() => fireEvent.click(screen.getByRole("radio", { name: option }))),
		);
	});

const openExactValues = (index: number) =>
	Effect.gen(function* () {
		const summary = screen.getAllByText("View exact values")[index];
		expect(summary).toBeDefined();
		if (summary === undefined) {
			return;
		}
		if (summary.closest("details")?.open !== true) {
			yield* Effect.promise(() => act(() => fireEvent.click(summary)));
		}
	});

function ProcessingProbe(props: {
	readonly input: AnalyticsInput;
	readonly requests: Parameters<SummaryChartsProps["onDrill"]>[0][];
}) {
	const [processing, setProcessing] = useState<"ready" | "pending">("pending");
	return (
		<>
			<button onClick={() => setProcessing("ready")}>Finish repair</button>
			<MediaAnalyticsCharts {...chartProps(props.input, processing, props.requests)} />
		</>
	);
}

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
				const page = mountCharts(clock, chartProps(input, "ready", requests));
				const replied = new Set<string>();
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests().length).toBeGreaterThanOrEqual(3)),
					);
					replyRequests(page, replied, { includeTrendRow: true });
					const trendLabel = `Trend window · ${periodCaption(analyticsWindow(chartProps(input).report.reporting, "trend").period)}`;
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getByText(trendLabel)).toBeDefined()),
					);
					expect(
						page
							.queryRequests()
							.some((request) => documentText(request.document).includes("America/New_York")),
					).toBe(true);
					yield* choose("Trend metric", "Active observations", "Pages");
					yield* choose("Media type", "All media types", "Book");
					yield* openExactValues(0);
					const trendValues = screen.getByRole("table", {
						name: "Pages by reporting period exact values",
					});
					expect(trendValues.textContent).toContain("12.5 pages");
					expect(trendValues.textContent).toContain("Not recorded");
					fireEvent.click(
						screen.getByRole("button", { name: /View records: .*2026-03-02.*12\.5 pages/ }),
					);
					expect(requests.at(-1)).toMatchObject({
						mediaType: "book",
						selection: {
							comparison: "none",
							range: { kind: "custom", endDate: "2026-03-02", startDate: "2026-03-02" },
						},
					});
					yield* choose("Trend metric", "Pages", "Title completions");
					yield* openExactValues(0);
					fireEvent.click(
						screen.getByRole("button", { name: /View records: .*2026-03-02.*1 title completions/ }),
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
					fireEvent.click(screen.getByText("View exact daily values (2 days)"));
					fireEvent.click(screen.getByRole("button", { name: "View records for 2026-03-02" }));
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
	);

	it.live(
		"keeps extra previous dates exact instead of aligning them to invented zero buckets",
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
						waitFor(() => expect(page.queryRequests("trend")).toHaveLength(2)),
					);
					replyRequests(page, replied);
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByText("Additional previous-period dates (3)")).toBeDefined(),
						),
					);
					expect(screen.getAllByText(/2026-02-01 – 2026-02-28/).length).toBeGreaterThan(0);
					fireEvent.click(screen.getByText("Additional previous-period dates (3)"));
					expect(screen.getAllByText("2026-01-29").length).toBeGreaterThan(0);
					expect(screen.getAllByText("2026-01-31").length).toBeGreaterThan(0);
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);

	it.live(
		"masks pending values and refetches all mounted chart supplements when processing becomes ready",
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
				const page = mountPage(clock, () => <ProcessingProbe input={input} requests={requests} />);
				const replied = new Set<string>();
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests().length).toBeGreaterThanOrEqual(3)),
					);
					replyRequests(page, replied, { includeTrendRow: true });
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByText(/View exact daily values \(2 days\)/)).toBeDefined(),
						),
					);
					fireEvent.click(screen.getByText("View exact daily values (2 days)"));
					expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
					expect(screen.queryByRole("button", { name: /View records/ })).toBeNull();
					yield* Effect.promise(() =>
						act(() => fireEvent.click(screen.getByRole("button", { name: "Finish repair" }))),
					);
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(requestsNotReplied(page, replied).length).toBeGreaterThanOrEqual(3),
						),
					);
					replyRequests(page, replied, { includeTrendRow: true });
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(
								screen.getByRole("button", {
									name: /View records: 2026-03-02 – 2026-03-03 .*1 observations/,
								}),
							).toBeDefined(),
						),
					);
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);

	it.live(
		"bounds all-time windows and preserves each region's successful values after refresh errors",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				yield* Effect.promise(() => clock.setTime(now));
				const input = inputFor({
					grouping: "day",
					comparison: "none",
					range: { kind: "all-time" },
				});
				const props = chartProps(input);
				const page = mountCharts(clock, props);
				const replied = new Set<string>();
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests().length).toBeGreaterThanOrEqual(3)),
					);
					replyRequests(page, replied, { includeTrendRow: true });
					const firstTrend = analyticsWindow(props.report.reporting, "trend");
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(
								screen.getByText(`Trend window · ${periodCaption(firstTrend.period)}`),
							).toBeDefined(),
						),
					);
					const dailyRequest = page
						.queryRequests()
						.find(({ document }) => Object.hasOwn(document.queries, "dates"));
					expect(dailyRequest).toBeDefined();
					expect(documentText(dailyRequest?.document)).toContain('"limit":400');
					expect(documentText(dailyRequest?.document)).not.toContain('"now"');
					yield* Effect.promise(() =>
						act(() => fireEvent.click(screen.getByRole("button", { name: "Older periods" }))),
					);
					yield* Effect.promise(() =>
						waitFor(() => expect(requestsNotReplied(page, replied, "trend").length).toBe(1)),
					);
					const olderTrendRequest = requestsNotReplied(page, replied, "trend")[0];
					expect(olderTrendRequest).toBeDefined();
					expect(documentText(olderTrendRequest?.document)).not.toContain('"now"');
					const olderTrend = analyticsWindow(
						props.report.reporting,
						"trend",
						firstTrend.previousCursor ?? undefined,
					);
					if (olderTrendRequest !== undefined) {
						replied.add(olderTrendRequest.requestId);
						page.replyQuery(olderTrendRequest.requestId, {
							outcome: "success",
							response: {
								data: { trend: aggregate([trendRow({ at: olderTrend.period.endDate })]) },
							},
						});
					}
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(
								screen.getByText(`Trend window · ${periodCaption(olderTrend.period)}`),
							).toBeDefined(),
						),
					);
					yield* openExactValues(0);
					yield* openExactValues(1);
					yield* Effect.promise(() =>
						act(() => fireEvent.click(screen.getByText(/^View exact daily values/))),
					);
					const trendValues = screen.getByRole("table", {
						name: "Active observations by reporting period exact values",
					});
					const hourlyValues = screen.getByRole("table", {
						name: "Active observations by local hour exact values",
					});
					const dailyValues = screen.getByRole("table", {
						name: "Daily active observations and record links",
					});
					const loadedTrendValues = trendValues.textContent;
					const loadedHourlyValues = hourlyValues.textContent;
					const loadedDailyValues = dailyValues.textContent;
					expect(loadedTrendValues).toContain("1 observations");
					expect(loadedHourlyValues).toContain("1 observations");
					expect(loadedDailyValues).toContain("2 observations");
					const loadedRecordLabels = screen
						.getAllByRole("button", { name: /View records:/ })
						.map((button) => button.getAttribute("aria-label"))
						.filter((label): label is string => label !== null);
					expect(loadedRecordLabels.length).toBeGreaterThan(0);
					page.send({ type: "page-refresh" });
					yield* waitForMessagePortMacrotask;
					yield* Effect.promise(() => clock.advance(250));
					const refreshQueryKeys = ["trend", "hourly", "dates", "instants"] as const;
					for (const query of refreshQueryKeys) {
						yield* Effect.promise(() =>
							waitFor(() =>
								expect(requestsNotReplied(page, replied, query).length).toBeGreaterThan(0),
							),
						);
					}
					const refreshRequests = requestsNotReplied(page, replied).filter(({ document }) =>
						refreshQueryKeys.some((query) => Object.hasOwn(document.queries, query)),
					);
					for (const request of refreshRequests) {
						replied.add(request.requestId);
						page.replyQuery(request.requestId, { outcome: "failure", reason: "query-failed" });
					}
					yield* Effect.promise(() => clock.advance(0));
					for (const label of ["Retry trend", "Retry hourly activity", "Retry consistency"]) {
						yield* Effect.promise(() =>
							waitFor(() => expect(screen.getByText(label)).toBeDefined()),
						);
						expect(screen.getByRole("button", { name: label })).toBeDefined();
					}
					expect(trendValues.textContent).toBe(loadedTrendValues);
					expect(hourlyValues.textContent).toBe(loadedHourlyValues);
					expect(dailyValues.textContent).toBe(loadedDailyValues);
					for (const label of loadedRecordLabels) {
						expect(screen.getByRole("button", { name: label })).toBeDefined();
					}
					const retryTargets: ReadonlyArray<{ readonly label: string; readonly query: string }> = [
						{ query: "trend", label: "Retry trend" },
						{ query: "hourly", label: "Retry hourly activity" },
						{ query: "dates", label: "Retry consistency" },
					];
					for (const { label, query } of retryTargets) {
						yield* Effect.promise(() =>
							act(() => fireEvent.click(screen.getByRole("button", { name: label }))),
						);
						yield* Effect.promise(() =>
							waitFor(() =>
								expect(requestsNotReplied(page, replied, query).length).toBeGreaterThan(0),
							),
						);
						if (query === "dates") {
							yield* Effect.promise(() =>
								waitFor(() =>
									expect(requestsNotReplied(page, replied, "instants").length).toBeGreaterThan(0),
								),
							);
						}
						const expectedDocument =
							query === "trend"
								? olderTrendRequest?.document
								: page.queryRequests(query)[0]?.document;
						for (const request of requestsNotReplied(page, replied, query)) {
							expect(documentText(request.document)).toBe(documentText(expectedDocument));
						}
						replyRequests(page, replied);
						yield* Effect.promise(() => clock.advance(0));
						yield* Effect.promise(() =>
							waitFor(() => {
								expect(screen.queryByText(label)).toBeNull();
								expect(screen.queryByText(`${label.replace("Retry ", "Refreshing ")}…`)).toBeNull();
							}),
						);
					}
					expect(periodCaption(reportingExecution(input, now).resolved.current)).toBe("All time");
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);
});
