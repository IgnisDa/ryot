import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { PluginId } from "@ryot-app/plugin-client-sdk/plugin";
import { useRyotInfiniteQuery, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	createTestRyotClock,
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import { TimeZone } from "@ryot-app/plugin-kit/schema";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { act, type ComponentType, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	analyticsCalendarInput,
	type AnalyticsInput,
	analyticsWindowInput,
	calendarReportingExecution,
	type MediaAnalyticsRecord,
	periodCaption,
	type ReportingExecution,
	reportingExecution,
} from "./model";
import {
	analyticsPageInput,
	mediaAnalyticsConsistencyQuery,
	mediaAnalyticsHoursQuery,
	mediaAnalyticsRankingQuery,
	mediaAnalyticsRecordsQuery,
	mediaAnalyticsReportQuery,
	mediaAnalyticsStatsQuery,
	mediaAnalyticsTrendQuery,
	nextAnalyticsPage,
} from "./queries";

afterEach(disposePluginBridges);
const documentText = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const input = {
	timeZone: TimeZone.make("America/New_York"),
	reference: { kind: "local", pluginId: PluginId.make("media-owner") },
	selection: {
		grouping: "day",
		comparison: "previous-period",
		range: { days: 7, kind: "rolling" },
	},
} as const;
const aggregate = (items: readonly Record<string, null | number | string>[]) => ({
	items,
	type: "aggregate" as const,
	pageInfo: { limit: 100, hasMore: false },
});
const reportResponse = (pending = 0) => ({
	data: {
		hourly: aggregate([]),
		trends: aggregate([]),
		current: aggregate([]),
		reviews: aggregate([]),
		previous: aggregate([]),
		rankings: aggregate([]),
		coverage: aggregate(
			pending === 0 ? [] : [{ pending, failed: 0, unknownDate: 0, mediaType: "book" }],
		),
	},
});
const cursorResponse = (
	key: "ranking" | "records",
	nextCursor: null | string,
	items: readonly Record<string, unknown>[] = [],
) => ({
	data: {
		[key]: {
			items,
			type: "rows" as const,
			pageInfo: { limit: 100, nextCursor, hasMore: nextCursor !== null },
		},
	},
});

function ReportProbe() {
	const query = useRyotQuery(mediaAnalyticsReportQuery, input);
	return (
		<>
			<button onClick={query.refetch}>Refresh report</button>
			<output>{query.data?.processing ?? "Loading"}</output>
			<output aria-label="Period">
				{query.data === undefined ? "" : periodCaption(query.data.reporting.resolved.current)}
			</output>
			<output aria-label="Previous">
				{query.data === undefined ? "" : periodCaption(query.data.reporting.resolved.previous)}
			</output>
		</>
	);
}
function RankingProbe() {
	const query = useRyotInfiniteQuery(
		mediaAnalyticsRankingQuery,
		{ ...input, processing: "ready" as const },
		{
			initialPageParam: null,
			getPageInput: analyticsPageInput,
			getNextPageParam: nextAnalyticsPage,
		},
	);
	return (
		<>
			<button onClick={query.fetchNextPage}>More</button>
			<button onClick={query.refetch}>Refresh pages</button>
			<output>{query.pages.length} pages</output>
			<output aria-label="Page clock">{query.pages.at(-1)?.reporting.now ?? "None"}</output>
			<output>{query.errorOperation ?? "No error"}</output>
			<button onClick={query.retry}>Retry</button>
		</>
	);
}
function RecordsProbe() {
	const [owner, setOwner] = useState("media-owner");
	const [processing, setProcessing] = useState<"ready" | "pending">("pending");
	const query = useRyotInfiniteQuery(
		mediaAnalyticsRecordsQuery,
		{
			...input,
			hour: 1,
			processing,
			entityId: "original-title",
			reference: { kind: "local" as const, pluginId: PluginId.make(owner) },
		},
		{
			initialPageParam: null,
			getPageInput: analyticsPageInput,
			getNextPageParam: nextAnalyticsPage,
		},
	);
	return (
		<>
			<button onClick={query.fetchNextPage}>More</button>
			<button onClick={query.refetch}>Refresh pages</button>
			<button onClick={() => setOwner("media-other")}>Other owner</button>
			<button onClick={() => setProcessing("ready")}>Processing ready</button>
			<output>{query.pages.length} pages</output>
			<output aria-label="Page clock">{query.pages.at(-1)?.reporting.now ?? "None"}</output>
			<output aria-label="Source rows">
				{query.pages.flatMap((page) => page.items.map((row) => row.name)).join(",")}
			</output>
			<output>{query.errorOperation ?? "No error"}</output>
			<button onClick={query.retry}>Retry</button>
		</>
	);
}
const captured = reportingExecution(input, Date.parse("2026-11-01T18:00:00Z"));
function UnmountProbe() {
	const [visible, setVisible] = useState(true);
	return (
		<>
			<button onClick={() => setVisible(false)}>Hide</button>
			{visible ? <ReportProbe /> : null}
		</>
	);
}
function SnapshotProbe() {
	const query = useRyotQuery(mediaAnalyticsConsistencyQuery, analyticsWindowInput(input, captured));
	return (
		<>
			<output>{query.data === undefined ? "Loading" : periodCaption(query.data.period)}</output>
			<output aria-label="Supplement clock">{query.data?.reporting.now ?? "None"}</output>
		</>
	);
}
const presence = {
	activeDays: 1,
	pagesKnown: 0,
	minutesKnown: 1,
	volumesKnown: 0,
	episodesKnown: 0,
	chaptersKnown: 0,
	distinctTitles: 1,
	pagesSuperseded: 0,
	minutesSuperseded: 0,
	volumesSuperseded: 0,
	episodesSuperseded: 0,
	chaptersSuperseded: 0,
};
const hourRow = {
	...presence,
	hour: 1,
	pagesMissing: 0,
	pagesRecorded: 0,
	minutesMissing: 0,
	pagesEstimated: 0,
	volumesMissing: 0,
	mediaType: "music",
	episodesMissing: 0,
	chaptersMissing: 0,
	volumesRecorded: 0,
	titleCompletions: 1,
	minutesEstimated: 0,
	episodesRecorded: 0,
	chaptersRecorded: 0,
	volumesEstimated: 0,
	episodesEstimated: 0,
	chaptersEstimated: 0,
	episodeCompletions: 0,
	activeObservations: 1,
	minutesRecorded: 2.125,
};
const statsResponse = {
	data: {
		currentTypes: aggregate([]),
		previousTypes: aggregate([]),
		currentReviewTypes: aggregate([]),
		previousReviewTypes: aggregate([]),
		currentGlobal: aggregate([presence]),
		previousGlobal: aggregate([presence]),
		currentReviews: aggregate([{ rated: 0, reviews: 0, averageRating: null }]),
		previousReviews: aggregate([{ rated: 0, reviews: 0, averageRating: null }]),
	},
};
function CoupledProbe() {
	const report = useRyotQuery(mediaAnalyticsReportQuery, input);
	return (
		<>
			<button onClick={report.refetch}>Refresh primary</button>
			<output aria-label="Primary clock">{report.data?.reporting.now ?? "None"}</output>
			{report.data === undefined ? null : <SupplementalProbe reporting={report.data.reporting} />}
		</>
	);
}
function SupplementalProbe({ reporting }: { readonly reporting: ReportingExecution }) {
	const calendar = analyticsCalendarInput(input, reporting);
	const window = analyticsWindowInput(input, reporting);
	const stats = useRyotQuery(mediaAnalyticsStatsQuery, calendar);
	const hours = useRyotQuery(mediaAnalyticsHoursQuery, calendar);
	const trend = useRyotQuery(mediaAnalyticsTrendQuery, window);
	const daily = useRyotQuery(mediaAnalyticsConsistencyQuery, window);
	return (
		<>
			<button onClick={hours.refetch}>Refresh hours</button>
			<output aria-label="Calendar input">{documentText(calendar)}</output>
			<output aria-label="Window input">{documentText(window)}</output>
			<output aria-label="Hour rows">{hours.data?.items.length ?? "None"}</output>
			<output aria-label="Hours state">
				{hours.error === null ? "Hours ready" : "Hours failed"}
			</output>
			<output aria-label="Supplement clocks">
				{[
					stats.data?.reporting.now,
					hours.data?.reporting.now,
					trend.data?.reporting.now,
					daily.data?.reporting.now,
				]
					.map((value) => value ?? "None")
					.join(",")}
			</output>
			{stats.data !== undefined &&
			hours.data !== undefined &&
			trend.data !== undefined &&
			daily.data !== undefined ? (
				<output>Supplement ready</output>
			) : null}
		</>
	);
}
const monthProbe = (selected: AnalyticsInput, capturedNow: number): ComponentType => {
	const parent = reportingExecution(selected, capturedNow);
	return function MonthProbe() {
		const stats = useRyotQuery(mediaAnalyticsStatsQuery, analyticsCalendarInput(selected, parent));
		const trend = useRyotQuery(mediaAnalyticsTrendQuery, analyticsWindowInput(selected, parent));
		return (
			<>
				<output aria-label="Month current">
					{stats.data === undefined ? "None" : periodCaption(stats.data.reporting.resolved.current)}
				</output>
				<output aria-label="Month prior">
					{stats.data === undefined
						? "None"
						: periodCaption(stats.data.reporting.resolved.previous)}
				</output>
				<output aria-label="Month clock">{stats.data?.reporting.now ?? "None"}</output>
				<output aria-label="Prior chart">
					{trend.data === undefined ? "None" : periodCaption(trend.data.previous?.period ?? null)}
				</output>
			</>
		);
	};
};
const sourceRecord = (name: string): MediaAnalyticsRecord => ({
	name,
	id: name,
	facts: {},
	orderKey: name,
	mediaType: "music",
	eventType: "complete",
	entityId: "original-title",
	occurredAt: "2026-10-29T12:00:00Z",
	orderCreatedAt: "2026-10-29T12:00:00Z",
	contribution: {
		titleCompletions: 1,
		episodeCompletions: 0,
		activeObservation: true,
		attribution: { kind: "instant", value: "2026-10-29T12:00:00Z" },
	},
});
const mount = (clock: ReturnType<typeof createTestRyotClock>, Probe: ComponentType) =>
	mountPluginPage(Probe, {
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
			contributors: ["media-owner", "media-other"].map((pluginId) =>
				pluginContributor({ pluginId, name: "Media", packageId: PLUGIN_PACKAGE_ID }),
			),
		},
	});
const supplementalRequests = (page: ReturnType<typeof mount>) =>
	page.queryRequests().filter(({ document }) => !Object.hasOwn(document.queries, "coverage"));
const replySupplemental = (
	page: ReturnType<typeof mount>,
	requests = supplementalRequests(page),
) => {
	for (const request of requests) {
		if (Object.hasOwn(request.document.queries, "currentGlobal")) {
			page.replyQuery(request.requestId, { outcome: "success", response: statsResponse });
		} else if (Object.hasOwn(request.document.queries, "trend")) {
			page.replyQuery(request.requestId, {
				outcome: "success",
				response: { data: { trend: aggregate([]) } },
			});
		} else if (Object.hasOwn(request.document.queries, "instants")) {
			page.replyQuery(request.requestId, {
				outcome: "success",
				response: { data: { dates: aggregate([]), instants: aggregate([]) } },
			});
		} else {
			page.replyQuery(request.requestId, {
				outcome: "success",
				response: { data: { hourly: aggregate([hourRow]) } },
			});
		}
	}
};

describe("Media analytics query adapters", () => {
	it.live(
		"retains all supplemental cache entries through same-day primary refresh and pending polls, including a failed supplemental refresh",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const started = Date.parse("2026-11-01T18:00:00Z");
				yield* Effect.promise(() => clock.setTime(started));
				const page = mount(clock, CoupledProbe);
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("coverage")).toHaveLength(1)),
					);
					yield* Effect.promise(() => clock.advance(500));
					for (const request of page.queryRequests("coverage")) {
						page.replyQuery(request.requestId, { outcome: "success", response: reportResponse(1) });
					}
					yield* Effect.promise(() =>
						waitFor(() => expect(supplementalRequests(page)).toHaveLength(5)),
					);
					replySupplemental(page);
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getByText("Supplement ready")).toBeDefined()),
					);
					const calendarKey = screen.getByLabelText("Calendar input").textContent;
					const windowKey = screen.getByLabelText("Window input").textContent;
					expect(calendarKey).not.toContain('"now"');
					expect(windowKey).not.toContain('"now"');
					expect(screen.getByLabelText("Supplement clocks").textContent).toBe(
						Array.from({ length: 4 }, () => started + 500).join(","),
					);
					for (const [index, pending] of [1, 0].entries()) {
						yield* Effect.promise(() => clock.advance(1000));
						yield* Effect.promise(() =>
							waitFor(() => expect(page.queryRequests("coverage")).toHaveLength(index + 2)),
						);
						for (const request of page.queryRequests("coverage").slice(index + 1)) {
							page.replyQuery(request.requestId, {
								outcome: "success",
								response: reportResponse(pending),
							});
						}
						yield* Effect.promise(() =>
							waitFor(() =>
								expect(screen.getByLabelText("Primary clock").textContent).toBe(
									String(started + 1500 + index * 1000),
								),
							),
						);
						expect(screen.getByLabelText("Calendar input").textContent).toBe(calendarKey);
						expect(screen.getByLabelText("Window input").textContent).toBe(windowKey);
						expect(supplementalRequests(page)).toHaveLength(5);
						expect(screen.getByLabelText("Hour rows").textContent).toBe("1");
					}
					yield* Effect.promise(() => clock.advance(500));
					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "Refresh primary" }));
					});
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("coverage")).toHaveLength(4)),
					);
					for (const request of page.queryRequests("coverage").slice(3)) {
						page.replyQuery(request.requestId, { outcome: "success", response: reportResponse() });
					}
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByLabelText("Primary clock").textContent).toBe(
								String(started + 3000),
							),
						),
					);
					expect(supplementalRequests(page)).toHaveLength(5);
					expect(screen.getByLabelText("Calendar input").textContent).toBe(calendarKey);
					expect(screen.getByLabelText("Window input").textContent).toBe(windowKey);
					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "Refresh hours" }));
					});
					yield* Effect.promise(() =>
						waitFor(() => expect(supplementalRequests(page)).toHaveLength(6)),
					);
					expect(screen.getByLabelText("Hour rows").textContent).toBe("1");
					for (const request of supplementalRequests(page).slice(5)) {
						page.replyQuery(request.requestId, { outcome: "failure", reason: "query-failed" });
					}
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getByText("Hours failed")).toBeDefined()),
					);
					expect(screen.getByLabelText("Hour rows").textContent).toBe("1");
					yield* Effect.promise(() => clock.advance(500));
					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "Refresh hours" }));
					});
					yield* Effect.promise(() =>
						waitFor(() => expect(supplementalRequests(page)).toHaveLength(7)),
					);
					replySupplemental(page, supplementalRequests(page).slice(6));
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByLabelText("Supplement clocks").textContent).toBe(
								[started + 500, started + 3500, started + 500, started + 500].join(","),
							),
						),
					);
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);
	for (const sample of [
		{
			offset: -1,
			end: "2026-03-01T05:00:00.000Z",
			start: "2026-02-01T05:00:00.000Z",
			current: "2026-02-01 – 2026-02-28",
			previous: "2026-01-01 – 2026-01-31",
			previousStart: "2026-01-01T05:00:00.000Z",
		},
		{
			offset: 0,
			end: "2026-04-01T04:00:00.000Z",
			start: "2026-03-01T05:00:00.000Z",
			current: "2026-03-01 – 2026-03-31",
			previous: "2026-02-01 – 2026-02-28",
			previousStart: "2026-02-01T05:00:00.000Z",
		},
	] as const) {
		it.live(
			`keeps actual unequal calendar comparison dates and DST boundaries for offset ${sample.offset}`,
			() =>
				Effect.gen(function* () {
					const clock = createTestRyotClock();
					const executedAt = Date.parse("2026-11-02T18:00:00Z");
					yield* Effect.promise(() => clock.setTime(executedAt));
					const selected = {
						...input,
						selection: {
							...input.selection,
							range: { unit: "month", kind: "calendar", offset: sample.offset },
						},
					} as const;
					const page = mount(clock, monthProbe(selected, Date.parse("2026-03-15T12:00:00Z")));
					try {
						yield* Effect.promise(() =>
							waitFor(() => expect(page.queryRequests()).toHaveLength(3)),
						);
						for (const request of page.queryRequests("currentGlobal")) {
							expect(yield* documentText(request.document.queries["currentGlobal"])).toContain(
								sample.start,
							);
							expect(yield* documentText(request.document.queries["currentGlobal"])).toContain(
								sample.end,
							);
							expect(yield* documentText(request.document.queries["previousGlobal"])).toContain(
								sample.previousStart,
							);
						}
						replySupplemental(page);
						yield* Effect.promise(() =>
							waitFor(() =>
								expect(screen.getByLabelText("Month current").textContent).toBe(sample.current),
							),
						);
						expect(screen.getByLabelText("Month prior").textContent).toBe(sample.previous);
						yield* Effect.promise(() =>
							waitFor(() =>
								expect(screen.getByLabelText("Prior chart").textContent).toBe(sample.previous),
							),
						);
						expect(screen.getByLabelText("Month clock").textContent).toBe(String(executedAt));
					} finally {
						page.dispose();
						yield* Effect.promise(() => clock.dispose());
					}
				}),
		);
	}
	it.live(
		"executes one atomic seven-query report and labels it from the same captured clock across refresh",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-01T18:00:00Z")));
				const page = mount(clock, ReportProbe);
				try {
					yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(1)));
					for (const request of page.queryRequests()) {
						expect(Object.keys(request.document.queries)).toHaveLength(7);
						expect(yield* documentText(request.document)).toContain("2026-11-02T05:00:00.000Z");
						page.replyQuery(request.requestId, { outcome: "success", response: reportResponse() });
					}
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByLabelText("Period").textContent).toBe("2026-10-26 – 2026-11-01"),
						),
					);
					expect(screen.getByLabelText("Previous").textContent).toBe("2026-10-19 – 2026-10-25");
					yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-02T18:00:00Z")));
					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "Refresh report" }));
					});
					yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(2)));
					for (const request of page.queryRequests().slice(1)) {
						expect(yield* documentText(request.document)).toContain("2026-11-03T05:00:00.000Z");
						page.replyQuery(request.requestId, { outcome: "success", response: reportResponse() });
					}
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByLabelText("Period").textContent).toBe("2026-10-27 – 2026-11-02"),
						),
					);
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);
	it.live("refreshes pending processing and stops after readiness", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mount(clock, ReportProbe);
			try {
				yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(1)));
				for (const request of page.queryRequests()) {
					page.replyQuery(request.requestId, { outcome: "success", response: reportResponse(1) });
				}
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("pending")).toBeDefined()),
				);
				yield* Effect.promise(() => clock.advance(1000));
				yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(2)));
				for (const request of page.queryRequests().slice(1)) {
					page.replyQuery(request.requestId, { outcome: "success", response: reportResponse() });
				}
				yield* Effect.promise(() => waitFor(() => expect(screen.getByText("ready")).toBeDefined()));
				yield* Effect.promise(() => clock.advance(3000));
				expect(page.queryRequests()).toHaveLength(2);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);
	it.live(
		"keeps captured report dates while sampling the supplied execution clock across a day boundary",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-02T18:00:00Z")));
				const page = mount(clock, SnapshotProbe);
				try {
					yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(1)));
					for (const request of page.queryRequests()) {
						expect(yield* documentText(request.document)).toContain("2026-11-02T05:00:00.000Z");
						expect(yield* documentText(request.document)).not.toContain("2026-11-03T05:00:00.000Z");
						page.replyQuery(request.requestId, {
							outcome: "success",
							response: { data: { dates: aggregate([]), instants: aggregate([]) } },
						});
					}
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getByText("2026-10-26 – 2026-11-01")).toBeDefined()),
					);
					expect(screen.getByLabelText("Supplement clock").textContent).toBe(
						String(Date.parse("2026-11-02T18:00:00Z")),
					);
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);
	for (const { key, Probe } of [
		{ key: "ranking", Probe: RankingProbe },
		{ key: "records", Probe: RecordsProbe },
	] as const) {
		it.live(
			`pins ${key} continuations to the first page and refreshes the original selection to loaded depth only`,
			() =>
				Effect.gen(function* () {
					const clock = createTestRyotClock();
					yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-01T18:00:00Z")));
					const page = mount(clock, Probe);
					try {
						yield* Effect.promise(() =>
							waitFor(() => expect(page.queryRequests(key)).toHaveLength(1)),
						);
						for (const request of page.queryRequests(key)) {
							page.replyQuery(request.requestId, {
								outcome: "success",
								response: cursorResponse(key, "first-cursor"),
							});
						}
						yield* Effect.promise(() =>
							waitFor(() => expect(screen.getByText("1 pages")).toBeDefined()),
						);
						yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-02T18:00:00Z")));
						act(() => {
							fireEvent.click(screen.getByRole("button", { name: "More" }));
						});
						yield* Effect.promise(() =>
							waitFor(() => expect(page.queryRequests(key)).toHaveLength(2)),
						);
						for (const request of page.queryRequests(key).slice(1)) {
							const text = yield* documentText(request.document);
							expect(text).toContain("first-cursor");
							expect(text).toContain("2026-10-26T04:00:00.000Z");
							expect(text).toContain("2026-11-02T05:00:00.000Z");
							if (key === "records") {
								expect(text).toContain("original-title");
								expect(text).toContain("localHour");
							}
							page.replyQuery(request.requestId, {
								outcome: "success",
								response: cursorResponse(key, "second-cursor"),
							});
						}
						yield* Effect.promise(() =>
							waitFor(() => expect(screen.getByText("2 pages")).toBeDefined()),
						);
						expect(screen.getByLabelText("Page clock").textContent).toBe(
							String(Date.parse("2026-11-02T18:00:00Z")),
						);
						act(() => {
							fireEvent.click(screen.getByRole("button", { name: "Refresh pages" }));
						});
						yield* Effect.promise(() =>
							waitFor(() => expect(page.queryRequests(key)).toHaveLength(3)),
						);
						for (const request of page.queryRequests(key).slice(2)) {
							const text = yield* documentText(request.document);
							expect(text).not.toContain("first-cursor");
							expect(text).toContain("2026-10-27T04:00:00.000Z");
							expect(text).toContain("2026-11-03T05:00:00.000Z");
							page.replyQuery(request.requestId, {
								outcome: "success",
								response: cursorResponse(key, "refreshed-cursor"),
							});
						}
						yield* Effect.promise(() =>
							waitFor(() => expect(page.queryRequests(key)).toHaveLength(4)),
						);
						for (const request of page.queryRequests(key).slice(3)) {
							expect(yield* documentText(request.document)).toContain("refreshed-cursor");
							expect(yield* documentText(request.document)).toContain("2026-11-03T05:00:00.000Z");
							page.replyQuery(request.requestId, {
								outcome: "success",
								response: cursorResponse(key, "third-cursor"),
							});
						}
						yield* Effect.promise(() =>
							waitFor(() => expect(screen.getByText("2 pages")).toBeDefined()),
						);
						expect(page.queryRequests(key)).toHaveLength(4);
					} finally {
						page.dispose();
						yield* Effect.promise(() => clock.dispose());
					}
				}),
		);
	}
	it.live(
		"retains loaded source rows and depth when a captured-page refresh fails, then retries from the stable original selection",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-01T18:00:00Z")));
				const page = mount(clock, RecordsProbe);
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("records")).toHaveLength(1)),
					);
					for (const request of page.queryRequests("records")) {
						page.replyQuery(request.requestId, {
							outcome: "success",
							response: cursorResponse("records", "first", [sourceRecord("First")]),
						});
					}
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getByLabelText("Source rows").textContent).toBe("First")),
					);
					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "More" }));
					});
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("records")).toHaveLength(2)),
					);
					for (const request of page.queryRequests("records").slice(1)) {
						page.replyQuery(request.requestId, {
							outcome: "success",
							response: cursorResponse("records", "second", [sourceRecord("Second")]),
						});
					}
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByLabelText("Source rows").textContent).toBe("First,Second"),
						),
					);
					yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-02T18:00:00Z")));
					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "Refresh pages" }));
					});
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("records")).toHaveLength(3)),
					);
					for (const request of page.queryRequests("records").slice(2)) {
						expect(yield* documentText(request.document)).toContain("2026-10-27T04:00:00.000Z");
						page.replyQuery(request.requestId, {
							outcome: "success",
							response: cursorResponse("records", "replacement", [sourceRecord("Replacement")]),
						});
					}
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("records")).toHaveLength(4)),
					);
					expect(screen.getByLabelText("Source rows").textContent).toBe("First,Second");
					for (const request of page.queryRequests("records").slice(3)) {
						page.replyQuery(request.requestId, { outcome: "failure", reason: "query-failed" });
					}
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getByText("refresh")).toBeDefined()),
					);
					expect(screen.getByText("2 pages")).toBeDefined();
					expect(screen.getByLabelText("Source rows").textContent).toBe("First,Second");
					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "Retry" }));
					});
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("records")).toHaveLength(5)),
					);
					for (const request of page.queryRequests("records").slice(4)) {
						expect(yield* documentText(request.document)).not.toContain("replacement");
						expect(yield* documentText(request.document)).toContain("2026-11-03T05:00:00.000Z");
						page.replyQuery(request.requestId, {
							outcome: "success",
							response: cursorResponse("records", "retry-first", [sourceRecord("New first")]),
						});
					}
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("records")).toHaveLength(6)),
					);
					for (const request of page.queryRequests("records").slice(5)) {
						expect(yield* documentText(request.document)).toContain("retry-first");
						expect(yield* documentText(request.document)).toContain("2026-11-03T05:00:00.000Z");
						page.replyQuery(request.requestId, {
							outcome: "success",
							response: cursorResponse("records", "retry-second", [sourceRecord("New second")]),
						});
					}
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByLabelText("Source rows").textContent).toBe("New first,New second"),
						),
					);
					expect(screen.getByText("2 pages")).toBeDefined();
					expect(page.queryRequests("records")).toHaveLength(6);
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);
	it("rejects malformed, repeated, and cyclic continuations", () => {
		const reporting = reportingExecution(input, 0);
		const first = { reporting, pageInfo: { limit: 100, hasMore: true, nextCursor: "one" } };
		const second = { reporting, pageInfo: { limit: 100, hasMore: true, nextCursor: "two" } };
		expect(() =>
			nextAnalyticsPage({ ...first, pageInfo: { ...first.pageInfo, nextCursor: null } }),
		).toThrow();
		const capturedPage = nextAnalyticsPage(first);
		if (capturedPage === null) {
			throw new Error("Expected a continuation");
		}
		expect(capturedPage).not.toHaveProperty("reporting");
		expect(capturedPage).not.toHaveProperty("now");
		expect(() => nextAnalyticsPage(first, { ...capturedPage, after: "one" })).toThrow();
		expect(() =>
			nextAnalyticsPage(first, { ...capturedPage, after: "two" }, [first, second, first]),
		).toThrow();
		const later = calendarReportingExecution(
			{ ...input, periods: capturedPage.periods },
			reporting.now + 1234,
			capturedPage.anchorDate,
		);
		expect(nextAnalyticsPage({ ...first, reporting: later })).toEqual(capturedPage);
	});
	it.live("keeps append cursor errors visible and owner changes separate", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mount(clock, RecordsProbe);
			try {
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("records")).toHaveLength(1)),
				);
				for (const request of page.queryRequests("records")) {
					page.replyQuery(request.requestId, {
						outcome: "success",
						response: cursorResponse("records", "first"),
					});
				}
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("1 pages")).toBeDefined()),
				);
				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "More" }));
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("records")).toHaveLength(2)),
				);
				for (const request of page.queryRequests("records").slice(1)) {
					page.replyQuery(request.requestId, {
						outcome: "success",
						response: cursorResponse("records", "first"),
					});
				}
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("append")).toBeDefined()),
				);
				expect(screen.getByText("1 pages")).toBeDefined();
				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "Other owner" }));
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("records")).toHaveLength(3)),
				);
				expect(screen.getByText("0 pages")).toBeDefined();
				for (const request of page.queryRequests("records").slice(2)) {
					expect(yield* documentText(request.document)).toContain("media-other");
					expect(yield* documentText(request.document)).not.toContain("media-owner");
				}
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);
	it.live("reloads source pages when global consumption processing becomes ready", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mount(clock, RecordsProbe);
			try {
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("records")).toHaveLength(1)),
				);
				for (const request of page.queryRequests("records")) {
					page.replyQuery(request.requestId, {
						outcome: "success",
						response: cursorResponse("records", "partial-cursor"),
					});
				}
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("1 pages")).toBeDefined()),
				);
				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "Processing ready" }));
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("records")).toHaveLength(2)),
				);
				expect(screen.getByText("0 pages")).toBeDefined();
				for (const request of page.queryRequests("records").slice(1)) {
					expect(yield* documentText(request.document)).not.toContain("partial-cursor");
					page.replyQuery(request.requestId, {
						outcome: "success",
						response: cursorResponse("records", null),
					});
				}
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("1 pages")).toBeDefined()),
				);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);
	it.live("cancels the atomic report request when the section unmounts", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mount(clock, UnmountProbe);
			try {
				yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(1)));
				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "Hide" }));
				});
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(
							page.clientMessages().filter((message) => message.type === "ryotql-cancel"),
						).toHaveLength(1),
					),
				);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);
});
