import { afterEach, assert, describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { type AnalyticsSectionProps, PluginId } from "@ryot-app/plugin-client-sdk/plugin";
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
import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import { act, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import MediaAnalyticsSection from "./section";

afterEach(disposePluginBridges);

const scopeFor = (pluginId = "media-owner"): AnalyticsSectionProps => ({
	timeZone: TimeZone.make("UTC"),
	owner: { kind: "local", pluginId: PluginId.make(pluginId) },
	selection: { grouping: "day", comparison: "none", range: { days: 7, kind: "rolling" } },
});

function FixedPeriodAnalyticsHost() {
	return (
		<MediaAnalyticsSection
			{...scopeFor()}
			selection={{
				grouping: "day",
				comparison: "none",
				range: { kind: "custom", endDate: "2026-09-07", startDate: "2026-09-01" },
			}}
		/>
	);
}

function AnalyticsHost() {
	const [scope, setScope] = useState(scopeFor());
	return (
		<>
			<h1>Analytics host</h1>
			<button
				type="button"
				onClick={() =>
					setScope((current) => ({
						...current,
						timeZone: TimeZone.make("America/Los_Angeles"),
						selection: {
							grouping: "week",
							comparison: "none",
							range: { days: 30, kind: "rolling" },
						},
					}))
				}
			>
				Change reporting scope
			</button>
			<button
				type="button"
				onClick={() => setScope((current) => ({ ...current, ...scopeFor("media-other") }))}
			>
				Change owner
			</button>
			<MediaAnalyticsSection {...scope} />
		</>
	);
}

const mountSection = (clock: ReturnType<typeof createTestRyotClock>, Component = AnalyticsHost) =>
	mountPluginPage(Component, {
		bootstrap: clock.bootstrap,
		location: routeLocation("/v/analytics"),
		page: {
			...savedViewPageContext({
				settings: {},
				savedViewId: "analytics",
				rendererName: "analytics",
				dataSources: { queries: {} },
				view: { name: "Analytics", icon: "chart-column" },
			}),
			contributors: ["media-owner", "media-other"].map((pluginId) =>
				pluginContributor({ pluginId, name: "Media", packageId: PLUGIN_PACKAGE_ID }),
			),
		},
	});

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

const reportRequests = (page: ReturnType<typeof mountSection>) => page.queryRequests("coverage");
const statsRequests = (page: ReturnType<typeof mountSection>) =>
	page.queryRequests("currentGlobal");
const queryText = (request: ReturnType<ReturnType<typeof mountSection>["queryRequests"]>[number]) =>
	JSON.stringify(request.document);

const waitForRequest = <Request,>(get: () => readonly Request[]) =>
	waitFor(() => {
		const request = get()[0];
		assert(request);
		return request;
	});

const replyReport = (page: ReturnType<typeof mountSection>, requestId: string, pending = 0) =>
	page.replyQuery(requestId, { outcome: "success", response: reportResponse(pending) });

const replyStats = (page: ReturnType<typeof mountSection>, requestId: string) =>
	page.replyQuery(requestId, { outcome: "success", response: statsResponse });

describe("media analytics section", () => {
	it.live("retries the primary report and mounts accessible tabs lazily", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountSection(clock);
			try {
				const first = yield* Effect.promise(() => waitForRequest(() => reportRequests(page)));
				expect(screen.getByRole("status").textContent).toContain("Loading media analytics");
				page.replyQuery(first.requestId, { outcome: "failure", reason: "query-failed" });
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("alert").textContent).toContain("could not be loaded"),
					),
				);
				expect(statsRequests(page)).toHaveLength(0);

				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "Retry report" }));
				});
				const retry = yield* Effect.promise(() =>
					waitFor(() => {
						const request = reportRequests(page)[1];
						assert(request);
						return request;
					}),
				);
				replyReport(page, retry.requestId);
				const stats = yield* Effect.promise(() => waitForRequest(() => statsRequests(page)));
				replyStats(page, stats.requestId);
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByRole("tablist")).toBeDefined()),
				);
				expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
				expect(screen.getByRole("tab", { name: "Charts" }).getAttribute("aria-selected")).toBe(
					"true",
				);
				const panel = screen.getByRole("tabpanel");
				expect(panel.getAttribute("aria-labelledby")).toBe(
					screen.getByRole("tab", { name: "Charts" }).id,
				);
				expect(page.queryRequests("ranking")).toHaveLength(0);

				act(() => {
					fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
				});
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(
							screen.getByRole("tab", { name: "Rankings" }).getAttribute("aria-selected"),
						).toBe("true"),
					),
				);
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("ranking").length).toBeGreaterThan(0)),
				);
				expect(page.queryRequests("records")).toHaveLength(0);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live(
		"keeps the report active through independent breakdown failures and refreshes on readiness",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-01T18:00:00Z")));
				const page = mountSection(clock);
				try {
					const firstReport = yield* Effect.promise(() =>
						waitForRequest(() => reportRequests(page)),
					);
					replyReport(page, firstReport.requestId, 1);
					const firstStats = yield* Effect.promise(() => waitForRequest(() => statsRequests(page)));
					page.replyQuery(firstStats.requestId, { outcome: "failure", reason: "query-failed" });
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByRole("alert").textContent).toContain(
								"breakdowns could not be loaded",
							),
						),
					);
					expect(screen.getByRole("tab", { name: "Charts" })).toBeDefined();

					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "Retry breakdowns" }));
					});
					const statsRetry = yield* Effect.promise(() =>
						waitFor(() => {
							const request = statsRequests(page)[1];
							assert(request);
							return request;
						}),
					);
					replyStats(page, statsRetry.requestId);
					yield* Effect.promise(() => clock.advance(1000));
					const pendingReport = yield* Effect.promise(() =>
						waitFor(() => {
							const request = reportRequests(page)[1];
							assert(request);
							return request;
						}),
					);
					replyReport(page, pendingReport.requestId, 1);
					yield* waitForMessagePortMacrotask;
					yield* Effect.promise(() => clock.advance(1000));
					const readyReport = yield* Effect.promise(() =>
						waitFor(() => {
							const request = reportRequests(page)[2];
							assert(request);
							return request;
						}),
					);
					replyReport(page, readyReport.requestId);
					expect(statsRequests(page)).toHaveLength(2);
					const readyStats = yield* Effect.promise(() =>
						waitFor(() => {
							const request = statsRequests(page)[2];
							assert(request);
							return request;
						}),
					);
					expect(queryText(readyStats)).toBe(queryText(statsRetry));
					page.replyQuery(readyStats.requestId, { outcome: "failure", reason: "query-failed" });
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByRole("alert").textContent).toContain(
								"breakdowns could not be refreshed",
							),
						),
					);
					expect(screen.getByRole("tablist")).toBeDefined();
					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "Retry breakdowns" }));
					});
					const refreshedStats = yield* Effect.promise(() =>
						waitFor(() => {
							const request = statsRequests(page)[3];
							assert(request);
							return request;
						}),
					);
					replyStats(page, refreshedStats.requestId);
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(
								screen.queryByText(
									"Media analytics breakdowns could not be refreshed. The last loaded breakdowns are still shown.",
								),
							).toBeNull(),
						),
					);
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);

	it.live("retains report content after a failed pending refresh and retries the report", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-01T18:00:00Z")));
			const page = mountSection(clock);
			try {
				const firstReport = yield* Effect.promise(() => waitForRequest(() => reportRequests(page)));
				replyReport(page, firstReport.requestId, 1);
				const firstStats = yield* Effect.promise(() => waitForRequest(() => statsRequests(page)));
				replyStats(page, firstStats.requestId);
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByRole("tablist")).toBeDefined()),
				);

				yield* Effect.promise(() => clock.advance(1000));
				const refresh = yield* Effect.promise(() =>
					waitFor(() => {
						const request = reportRequests(page)[1];
						assert(request);
						return request;
					}),
				);
				page.replyQuery(refresh.requestId, { outcome: "failure", reason: "query-failed" });
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("alert").textContent).toContain("could not be refreshed"),
					),
				);
				expect(screen.getByRole("tablist")).toBeDefined();
				expect(screen.queryByText("Loading media analytics…")).toBeNull();

				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "Retry report" }));
				});
				const retry = yield* Effect.promise(() =>
					waitFor(() => {
						const request = reportRequests(page)[2];
						assert(request);
						return request;
					}),
				);
				replyReport(page, retry.requestId);
				const statsRefresh = yield* Effect.promise(() =>
					waitFor(() => {
						const request = statsRequests(page)[1];
						assert(request);
						return request;
					}),
				);
				replyStats(page, statsRefresh.requestId);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(
							screen.queryByText("Media history repair is pending. These analytics are not final."),
						).toBeNull(),
					),
				);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("closes records on an owner change and ignores the late old-owner response", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-01T18:00:00Z")));
			const page = mountSection(clock);
			try {
				const firstReport = yield* Effect.promise(() => waitForRequest(() => reportRequests(page)));
				replyReport(page, firstReport.requestId);
				const firstStats = yield* Effect.promise(() => waitForRequest(() => statsRequests(page)));
				replyStats(page, firstStats.requestId);
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByRole("tablist")).toBeDefined()),
				);
				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "View contributing records" }));
				});
				const records = yield* Effect.promise(() =>
					waitFor(() => {
						const request = page.queryRequests("records")[0];
						assert(request);
						return request;
					}),
				);
				expect(screen.getByRole("dialog")).toBeDefined();

				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "Change owner" }));
				});
				yield* Effect.promise(() => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()));
				const nextReport = yield* Effect.promise(() =>
					waitFor(() => {
						const request = reportRequests(page)[1];
						assert(request);
						return request;
					}),
				);
				expect(queryText(nextReport)).toContain("media-other");
				replyReport(page, nextReport.requestId);
				const nextStats = yield* Effect.promise(() =>
					waitFor(() => {
						const request = statsRequests(page)[1];
						assert(request);
						return request;
					}),
				);
				replyStats(page, nextStats.requestId);
				page.replyQuery(records.requestId, {
					outcome: "success",
					response: {
						data: {
							records: {
								type: "rows",
								pageInfo: { limit: 100, hasMore: false, nextCursor: null },
								items: [
									{
										facts: {},
										id: "late-record",
										mediaType: "music",
										entityId: "old-title",
										eventType: "complete",
										orderKey: "late-record",
										name: "Late old-owner record",
										occurredAt: "2026-10-29T12:00:00Z",
										orderCreatedAt: "2026-10-29T12:00:00Z",
										contribution: {
											titleCompletions: 1,
											episodeCompletions: 0,
											activeObservation: true,
											attribution: { kind: "instant", value: "2026-10-29T12:00:00Z" },
										},
									},
								],
							},
						},
					},
				});
				yield* waitForMessagePortMacrotask;
				expect(screen.queryByRole("dialog")).toBeNull();
				expect(screen.queryByText("Late old-owner record")).toBeNull();
				expect(page.queryRequests("records")).toHaveLength(1);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("opens one ranking records dialog and restores focus after Escape", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			yield* Effect.promise(() => clock.setTime(Date.parse("2026-10-15T12:00:00Z")));
			const page = mountSection(clock, FixedPeriodAnalyticsHost);
			try {
				const report = yield* Effect.promise(() => waitForRequest(() => reportRequests(page)));
				replyReport(page, report.requestId);
				const stats = yield* Effect.promise(() => waitForRequest(() => statsRequests(page)));
				replyStats(page, stats.requestId);
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByRole("tablist")).toBeDefined()),
				);

				act(() => {
					fireEvent.click(screen.getByRole("tab", { name: "Rankings" }));
				});
				const ranking = yield* Effect.promise(() =>
					waitForRequest(() => page.queryRequests("ranking")),
				);
				expect(queryText(ranking)).toContain("2026-09-01");
				expect(queryText(ranking)).toContain("2026-09-07");
				page.replyQuery(ranking.requestId, {
					outcome: "success",
					response: {
						data: {
							ranking: {
								type: "rows",
								pageInfo: { limit: 100, hasMore: false, nextCursor: null },
								items: [
									{
										mediaType: "book",
										titleCompletions: 1,
										name: "Ranked title",
										activeObservations: 1,
										episodeCompletions: 0,
										entityId: "title/ranked-title",
									},
								],
							},
						},
					},
				});
				const action = yield* Effect.promise(() =>
					waitFor(() =>
						screen.getByRole("button", { name: "View records contributing to Ranked title" }),
					),
				);
				action.focus();
				act(() => {
					fireEvent.click(action);
				});

				const records = yield* Effect.promise(() =>
					waitForRequest(() => page.queryRequests("records")),
				);
				expect(page.queryRequests("records")).toHaveLength(1);
				expect(queryText(records)).toContain("title/ranked-title");
				expect(queryText(records)).toContain("2026-09-01");
				expect(queryText(records)).toContain("2026-09-07");
				const dialog = yield* Effect.promise(() => waitFor(() => screen.getByRole("dialog")));
				expect(screen.getAllByRole("dialog")).toHaveLength(1);
				expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1);

				page.replyQuery(records.requestId, {
					outcome: "success",
					response: {
						data: {
							records: {
								type: "rows",
								pageInfo: { limit: 100, hasMore: false, nextCursor: null },
								items: [
									{
										facts: {},
										mediaType: "book",
										eventType: "progress",
										id: "record/ranked-title",
										entityId: "title/ranked-title",
										name: "One contributing record",
										orderKey: "record/ranked-title",
										occurredAt: "2026-09-04T12:00:00Z",
										orderCreatedAt: "2026-09-04T12:00:00Z",
										contribution: {
											titleCompletions: 1,
											episodeCompletions: 0,
											activeObservation: true,
											attribution: { kind: "instant", value: "2026-09-04T12:00:00Z" },
										},
									},
								],
							},
						},
					},
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(within(dialog).getByText("One contributing record")).toBeDefined()),
				);
				expect(within(dialog).getAllByRole("row")).toHaveLength(2);
				expect(page.queryRequests("records")).toHaveLength(1);

				act(() => {
					fireEvent.keyDown(dialog, { key: "Escape" });
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.queryAllByRole("dialog", { hidden: true })).toHaveLength(0)),
				);
				yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(action)));
				expect(page.queryRequests("records")).toHaveLength(1);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);
});
