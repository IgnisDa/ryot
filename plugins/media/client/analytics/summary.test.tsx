import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect, Result } from "@ryot-app/plugin-client-sdk/effect";
import { PluginId, reportingExecution } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createTestRyotClock,
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import { TimeZone } from "@ryot-app/plugin-kit/schema";
import { screen, waitFor } from "@testing-library/dom";

import { mediaAnalyticsStatsRecipe } from "../../shared/analytics-recipes";
import { mediaConsumptionReportRecipe } from "../../shared/consumption-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	analyticsCalendarInput,
	type AnalyticsInput,
	type MediaAnalyticsStats,
	type MediaConsumptionReport,
	type SummaryChartsProps,
} from "./model";
import { MediaAnalyticsSummary } from "./summary";

afterEach(disposePluginBridges);

const owner: AnalyticsInput["reference"] = {
	kind: "local",
	pluginId: PluginId.make("media-owner"),
};
const input: AnalyticsInput = {
	reference: owner,
	timeZone: TimeZone.make("America/New_York"),
	selection: {
		grouping: "day",
		comparison: "previous-period",
		range: { offset: 0, unit: "month", kind: "calendar" },
	},
};
const now = Date.parse("2026-03-15T12:00:00Z");

const aggregate = (
	items: readonly Record<string, unknown>[],
	hasMore = false,
): {
	readonly type: "aggregate";
	readonly items: readonly Record<string, unknown>[];
	readonly pageInfo: { readonly limit: number; readonly hasMore: boolean };
} => ({ items, type: "aggregate", pageInfo: { hasMore, limit: 100 } });

const rowTotals = (overrides: Record<string, number> = {}) => ({
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
	...overrides,
});

const reportData = (
	processing: "ready" | "failed" | "pending" = "ready",
	partial = false,
	pageAmounts: { readonly pagesRecorded: number; readonly pagesEstimated: number } = {
		pagesRecorded: 0,
		pagesEstimated: 0,
	},
): MediaConsumptionReport => {
	const pending = processing === "pending" ? 1 : 0;
	const failed = processing === "failed" ? 1 : 0;
	const current = [
		{
			...rowTotals({
				episodesMissing: 2,
				chaptersMissing: 1,
				titleCompletions: 2,
				episodeCompletions: 1,
				activeObservations: 4,
				...pageAmounts,
			}),
			mediaType: "book",
		},
		{ ...rowTotals({ titleCompletions: 1 }), mediaType: "show" },
		{ ...rowTotals({ minutesRecorded: 20, episodeCompletions: 3 }), mediaType: "show-episode" },
	];
	const previous = [
		{ ...rowTotals(), mediaType: "book" },
		{ ...rowTotals(), mediaType: "show" },
		{ ...rowTotals(), mediaType: "show-episode" },
	];
	return Result.getOrThrow(
		mediaConsumptionReportRecipe({ ...input, now }).decode({
			data: {
				hourly: aggregate([]),
				trends: aggregate([]),
				reviews: aggregate([]),
				rankings: aggregate([]),
				previous: aggregate(previous),
				current: aggregate(current, partial),
				activeWork: {
					items: [],
					type: "rows",
					pageInfo: { limit: 1, hasMore: false, nextCursor: null },
				},
				coverage: aggregate([
					{ failed, pending, unknownDate: 2, mediaType: "book" },
					{ failed, pending, unknownDate: 1, mediaType: "show" },
					{ failed, pending, unknownDate: 0, mediaType: "show-episode" },
				]),
			},
		}),
	);
};

const statsData = (): MediaAnalyticsStats => {
	const reporting = reportingExecution(input.selection, { now: now, timeZone: input.timeZone });
	const presence = {
		activeDays: 2,
		pagesKnown: 1,
		minutesKnown: 2,
		volumesKnown: 0,
		episodesKnown: 0,
		chaptersKnown: 0,
		distinctTitles: 2,
		pagesSuperseded: 0,
		minutesSuperseded: 0,
		volumesSuperseded: 0,
		episodesSuperseded: 0,
		chaptersSuperseded: 0,
	};
	const typeRows = ["book", "show", "show-episode"].map((mediaType) => ({
		mediaType,
		activeDays: 2,
		pagesKnown: 1,
		minutesKnown: 2,
		volumesKnown: 0,
		episodesKnown: 0,
		chaptersKnown: 0,
		distinctTitles: 2,
		pagesSuperseded: 0,
		minutesSuperseded: 0,
		volumesSuperseded: 0,
		episodesSuperseded: 0,
		chaptersSuperseded: 0,
	}));
	return Result.getOrThrow(
		mediaAnalyticsStatsRecipe({ ...analyticsCalendarInput(input, reporting), now }).decode({
			data: {
				currentTypes: aggregate(typeRows),
				previousTypes: aggregate(typeRows),
				previousReviewTypes: aggregate([]),
				currentGlobal: aggregate([presence]),
				currentReviews: aggregate([{ rated: 1, reviews: 2, averageRating: 40 }]),
				previousReviews: aggregate([{ rated: 0, reviews: 0, averageRating: null }]),
				previousGlobal: aggregate([{ ...presence, activeDays: 0, distinctTitles: 0 }]),
				currentReviewTypes: aggregate([
					{ rated: 1, reviews: 1, averageRating: 0, mediaType: "person" },
					{ rated: 1, reviews: 1, averageRating: 80, mediaType: "show-episode" },
				]),
			},
		}),
	);
};

const summaryProps = (
	processing: "ready" | "failed" | "pending" = "ready",
	partial = false,
	includeStats = true,
): SummaryChartsProps => {
	const stats = includeStats ? statsData() : undefined;
	return {
		input,
		report: {
			...reportData(processing, partial),
			reporting: reportingExecution(input.selection, { now: now, timeZone: input.timeZone }),
		},
		...(stats === undefined
			? {}
			: {
					stats: {
						...stats,
						reporting: reportingExecution(input.selection, { now: now, timeZone: input.timeZone }),
					},
				}),
		onDrill: () => undefined,
	};
};

const mountSummary = (clock: ReturnType<typeof createTestRyotClock>, props: SummaryChartsProps) =>
	mountPluginPage(() => <MediaAnalyticsSummary {...props} />, {
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

describe("Media analytics summary UI", () => {
	it.live(
		"distinguishes known zero, unknown and missing quantities by unit and marks partial totals",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const props = summaryProps("ready", true);
				const page = mountSummary(clock, props);
				try {
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByRole("heading", { name: "Quantity coverage" })).toBeDefined(),
						),
					);
					expect(screen.getByText("≥ 0 pages")).toBeDefined();
					expect(screen.getAllByText("Unknown", { selector: "dd" }).length).toBeGreaterThan(0);
					expect(
						screen.getAllByText(/Missing observations · 0 observations/).length,
					).toBeGreaterThan(0);
					expect(
						screen.getAllByText(/Missing observations · 2 observations/).length,
					).toBeGreaterThan(0);
					expect(screen.getByText("Pages")).toBeDefined();
					expect(screen.getByText("Episodes")).toBeDefined();
					expect(screen.getByText("Chapters")).toBeDefined();
					expect(screen.getByText("Volumes")).toBeDefined();
					expect(screen.getByText("Minutes")).toBeDefined();
					expect(screen.getByText(/partial lower bounds/i)).toBeDefined();
					expect(screen.getAllByText("Show episodes").length).toBeGreaterThan(0);
					expect(screen.getByText("Show")).toBeDefined();
					expect(
						screen.getByText(/Full-history source coverage includes 3 unknown-date observations/),
					).toBeDefined();
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);

	it.live(
		"shows actual unequal comparison dates and labels prior-zero activity without an infinite percent",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const props = summaryProps();
				const page = mountSummary(clock, props);
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getByText(/New activity · \+3 titles/)).toBeDefined()),
					);
					expect(
						screen.getAllByText(/2026-03-01 – 2026-03-31 vs 2026-02-01 – 2026-02-28/).length,
					).toBeGreaterThan(0);
					expect(screen.queryByText(/Infinity|%/)).toBeNull();
					expect(screen.getByText("Episode completion occurrences")).toBeDefined();
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);

	it.live("shows recorded and estimated precision without combining separate units", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const props = {
				...summaryProps("ready", false),
				report: {
					...reportData("ready", false, { pagesRecorded: 70.125, pagesEstimated: 29.875 }),
					reporting: reportingExecution(input.selection, { now: now, timeZone: input.timeZone }),
				},
			};
			const page = mountSummary(clock, props);
			try {
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("100 pages")).toBeDefined()),
				);
				expect(screen.getAllByText(/Recorded · 70\.125 pages/).length).toBeGreaterThan(0);
				expect(screen.getAllByText(/Estimated · 29\.875 pages/).length).toBeGreaterThan(0);
				expect(screen.getAllByText(/Recorded · 20 minutes/).length).toBeGreaterThan(0);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live(
		"keeps dependent counts unknown without stats and leaves reviews visible while repair masks consumption",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const props = summaryProps("pending", false);
				const page = mountSummary(clock, props);
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getByText(/source repair is pending/)).toBeDefined()),
					);
					expect(screen.getAllByText("Unknown").length).toBeGreaterThan(3);
					expect(screen.getByText("Source average · 40 /100")).toBeDefined();
					expect(screen.getByText("0 /100")).toBeDefined();
					page.dispose();
					const withoutStats = mountSummary(clock, summaryProps("ready", false, false));
					try {
						yield* Effect.promise(() =>
							waitFor(() =>
								expect(screen.getByText(/dependent values show Unknown/)).toBeDefined(),
							),
						);
						expect(screen.getByText("Distinct completed titles")).toBeDefined();
						expect(screen.getAllByText("Unknown").length).toBeGreaterThan(3);
					} finally {
						withoutStats.dispose();
					}
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);
});
