import { afterEach, describe, expect } from "bun:test";

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
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { screen, waitFor } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";

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
		userPreferences: { ratingScale: "ten", timeZone: TimeZone.make("UTC") },
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
		"lists only known amounts per unit and every active media type",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const props = summaryProps();
				const page = mountSummary(clock, props);
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getByRole("heading", { name: "Amounts" })).toBeDefined()),
					);
					expect(screen.getByRole("img", { name: /^Pages sources/ })).toBeDefined();
					expect(screen.getByRole("img", { name: /^Time spent sources/ })).toBeDefined();
					expect(screen.queryByRole("img", { name: /^Episodes sources/ })).toBeNull();
					expect(screen.queryByRole("img", { name: /^Chapters sources/ })).toBeNull();
					expect(screen.queryByRole("img", { name: /^Volumes sources/ })).toBeNull();
					expect(screen.getAllByText("0 pages").length).toBeGreaterThan(0);
					const rows = screen.getAllByRole("rowheader").map((row) => row.textContent);
					expect(rows).toEqual(["Book", "Show", "Show episode", "Person", "Show episode"]);
					expect(screen.getByText("Not counted in any period: 3 undated entries.")).toBeDefined();
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
		testTimeout,
	);

	it.live(
		"marks activity after an empty previous period as new instead of an infinite percent",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const props = summaryProps();
				const page = mountSummary(clock, props);
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getByText("+3 titles vs previous period")).toBeDefined()),
					);
					expect(screen.getByText("Changes compare with Feb 1 – 28, 2026.")).toBeDefined();
					expect(screen.queryByText(/Infinity|%/)).toBeNull();
					expect(screen.getByText("Episodes finished")).toBeDefined();
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
		testTimeout,
	);

	it.live(
		"splits each unit into recorded and estimated shares without combining units",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const props = summaryProps("ready", { pagesRecorded: 70.125, pagesEstimated: 29.875 });
				const page = mountSummary(clock, props);
				try {
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(
								screen.getByRole("img", {
									name: "Pages sources: Recorded 70.1 pages, Estimated 29.9 pages",
								}),
							).toBeDefined(),
						),
					);
					expect(
						screen.getByRole("img", { name: "Time spent sources: Recorded 20m, Estimated 0s" }),
					).toBeDefined();
					expect(screen.getAllByText("100 pages").length).toBeGreaterThan(0);
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
		testTimeout,
	);

	it.live(
		"keeps consumption and review values visible while processing is pending",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const page = mountSummary(
					clock,
					summaryProps("pending", { pagesRecorded: 70.125, pagesEstimated: 29.875 }),
				);
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getAllByText("100 pages").length).toBeGreaterThan(0)),
					);
					expect(screen.getByText("Average rating", { selector: "dt" })).toBeDefined();
					yield* Effect.promise(() => waitFor(() => expect(screen.getByText("4.0")).toBeDefined()));
					expect(screen.getByText("0.0 / 10")).toBeDefined();
					expect(screen.getByText("8.0 / 10")).toBeDefined();
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
		testTimeout,
	);
});
