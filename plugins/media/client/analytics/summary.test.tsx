import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
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
import { screen, waitFor } from "@testing-library/dom";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	analyticsReviewRow,
	analyticsSummary,
	analyticsTypeRow,
} from "../../tests/client/analytics-fixture";
import type { AnalyticsInput, MediaAnalyticsProcessing, SummaryChartsProps } from "./model";
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

const types = (pageAmounts: Record<string, number> = {}) => [
	analyticsTypeRow("book", "Book", {
		activeDays: 2,
		pagesKnown: 1,
		distinctTitles: 2,
		episodesMissing: 2,
		chaptersMissing: 1,
		titleCompletions: 2,
		episodeCompletions: 1,
		activeObservations: 4,
		...pageAmounts,
	}),
	analyticsTypeRow("show", "Show", { minutesKnown: 2, titleCompletions: 1 }),
	analyticsTypeRow("show-episode", "Show episode", {
		minutesKnown: 2,
		minutesRecorded: 20,
		episodeCompletions: 3,
	}),
];

const summaryProps = (
	processing: MediaAnalyticsProcessing = "ready",
	pageAmounts: Record<string, number> = {},
): SummaryChartsProps => ({
	input,
	onDrill: () => undefined,
	summary: analyticsSummary(input, {
		now,
		processing,
		unknownDate: 3,
		previous: { types: [analyticsTypeRow("book", "Book")] },
		current: {
			activeDays: 2,
			types: types(pageAmounts),
			reviews: [
				analyticsReviewRow("person", "Person", { rated: 1, reviews: 1, averageRating: 0 }),
				analyticsReviewRow("show-episode", "Show episode", {
					rated: 1,
					reviews: 1,
					averageRating: 80,
				}),
			],
		},
	}),
});

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
	it.live("distinguishes known zero, unknown and missing quantities by unit", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const props = summaryProps();
			const page = mountSummary(clock, props);
			try {
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("heading", { name: "Quantity coverage" })).toBeDefined(),
					),
				);
				expect(screen.getByText("0 pages")).toBeDefined();
				expect(screen.getAllByText("Unknown", { selector: "dd" }).length).toBeGreaterThan(0);
				expect(screen.getAllByText(/Missing observations · 0 observations/).length).toBeGreaterThan(
					0,
				);
				expect(screen.getAllByText(/Missing observations · 2 observations/).length).toBeGreaterThan(
					0,
				);
				expect(screen.getByText("Pages")).toBeDefined();
				expect(screen.getByText("Episodes")).toBeDefined();
				expect(screen.getByText("Chapters")).toBeDefined();
				expect(screen.getByText("Volumes")).toBeDefined();
				expect(screen.getByText("Minutes")).toBeDefined();
				expect(screen.getAllByText("Show episode").length).toBeGreaterThan(0);
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
			const props = summaryProps("ready", { pagesRecorded: 70.125, pagesEstimated: 29.875 });
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

	it.live("leaves reviews visible while processing masks consumption", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountSummary(clock, summaryProps("pending"));
			try {
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText(/source repair is pending/)).toBeDefined()),
				);
				expect(screen.getAllByText("Unknown").length).toBeGreaterThan(3);
				expect(screen.getByText("Source average · 40 /100")).toBeDefined();
				expect(screen.getByText("0 /100")).toBeDefined();
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);
});
