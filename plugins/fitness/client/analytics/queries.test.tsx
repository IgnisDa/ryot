import { afterEach, describe, expect } from "bun:test";

import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { periodCaption, PluginId, TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import { useReportedPages, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	createTestRyotClock,
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import type { ReportingSelection } from "@ryot-app/plugin-kit/schema";
import { bindTestRequest } from "@ryot-app/ryotql-recipes/test-utils";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";
import { act, type ComponentType, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	analyticsMeasurementMetricsQuery,
	analyticsRankingQuery,
	analyticsSummaryQuery,
	analyticsWorkoutsQuery,
	measurementReadingsQuery,
} from "./queries";

afterEach(disposePluginBridges);

const aggregate = (item: Record<string, null | number>) => ({
	items: [item],
	type: "aggregate" as const,
});
const documentText = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const response = {
	data: {
		entries: aggregate({ entries: 0 }),
		readings: aggregate({ readings: 0 }),
		workouts: aggregate({
			workouts: 0,
			activeDays: 0,
			calories: null,
			timedWorkouts: 0,
			calorieWorkouts: 0,
			activeDuration: null,
		}),
		sets: aggregate({
			sets: 0,
			failed: 0,
			pending: 0,
			volume: null,
			distance: null,
			personalBests: 0,
			repetitions: null,
			plannedRest: null,
			setDuration: null,
			personalBestSets: 0,
		}),
	},
};

const mountSummary = (
	clock: ReturnType<typeof createTestRyotClock>,
	selection: ReportingSelection,
) => {
	function Probe() {
		const query = useRyotQuery(analyticsSummaryQuery, {
			selection,
			timeZone: TimeZone.make("America/New_York"),
			reference: { kind: "local", pluginId: PluginId.make("fitness-owner") },
		});
		let status = "Loading";
		if (query.data !== undefined) {
			status = query.data.previous === null ? "No comparison" : "Comparison ready";
		}
		return (
			<>
				<button onClick={query.refetch}>Refresh</button>
				<output>{status}</output>
				<output aria-label="Resolved comparison">
					{query.data === undefined ? "" : periodCaption(query.data.reporting.resolved.previous)}
				</output>
			</>
		);
	}
	return mountPluginPage(Probe, {
		bootstrap: clock.bootstrap,
		location: routeLocation("/v/analytics"),
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
				pluginContributor({
					name: "Fitness",
					pluginId: "fitness-owner",
					packageId: PLUGIN_PACKAGE_ID,
				}),
			],
		},
	});
};

describe("fitness analytics section queries", () => {
	it.live(
		"resolves actual previous dates and a fresh execution clock with stable inputs",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-01T18:00:00Z")));
				const page = mountSummary(clock, {
					grouping: "day",
					comparison: "previous-period",
					range: { days: 7, kind: "rolling" },
				});
				try {
					yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(2)));
					const documents = page
						.queryRequests()
						.map(({ request: executionRequest }) => executionRequest.arguments);
					expect(
						documents.some(
							(argumentsValue) =>
								argumentsValue?.["range"] === "rolling" &&
								argumentsValue["comparisonSide"] === "current" &&
								argumentsValue["startOffsetDays"] === -6 &&
								argumentsValue["endOffsetDays"] === 1,
						),
					).toBe(true);
					expect(
						documents.some(
							(argumentsValue) =>
								argumentsValue?.["range"] === "rolling" &&
								argumentsValue["comparisonSide"] === "previous" &&
								argumentsValue["previousStartOffsetDays"] === -13 &&
								argumentsValue["previousEndOffsetDays"] === -6,
						),
					).toBe(true);
					for (const request of page.queryRequests()) {
						expect(Object.keys(bindTestRequest(request.request).queries)).toHaveLength(4);
						page.replyQuery(request.requestId, { response, outcome: "success" });
					}
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getByText("Comparison ready")).toBeDefined()),
					);
					expect(screen.getByLabelText("Resolved comparison").textContent).toBe(
						"Oct 19 – 25, 2026",
					);
					yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-02T18:00:00Z")));
					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
					});
					yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(4)));
					const refreshed = page
						.queryRequests()
						.slice(2)
						.map(({ request: executionRequest }) => executionRequest.arguments);
					expect(
						refreshed.some(
							(argumentsValue) =>
								argumentsValue?.["range"] === "rolling" &&
								argumentsValue["comparisonSide"] === "current" &&
								argumentsValue["startOffsetDays"] === -6 &&
								argumentsValue["endOffsetDays"] === 1,
						),
					).toBe(true);
					expect(
						refreshed.some(
							(argumentsValue) =>
								argumentsValue?.["range"] === "rolling" &&
								argumentsValue["comparisonSide"] === "previous" &&
								argumentsValue["previousStartOffsetDays"] === -13 &&
								argumentsValue["previousEndOffsetDays"] === -6,
						),
					).toBe(true);
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
		testTimeout,
	);
	it.live(
		"omits the comparison query for all-time and disabled comparisons",
		() =>
			Effect.gen(function* () {
				for (const selection of [
					{ grouping: "auto", range: { kind: "all-time" }, comparison: "previous-period" },
					{ grouping: "day", comparison: "none", range: { days: 7, kind: "rolling" } },
				] as const) {
					const clock = createTestRyotClock();
					const page = mountSummary(clock, selection);
					try {
						yield* Effect.promise(() =>
							waitFor(() => expect(page.queryRequests()).toHaveLength(1)),
						);
						for (const request of page.queryRequests()) {
							page.replyQuery(request.requestId, { response, outcome: "success" });
						}
						yield* Effect.promise(() =>
							waitFor(() => expect(screen.getByText("No comparison")).toBeDefined()),
						);
						expect(page.queryRequests()).toHaveLength(1);
					} finally {
						page.dispose();
						yield* Effect.promise(() => clock.dispose());
					}
				}
			}),
		testTimeout,
	);
});

const pagedInput = {
	timeZone: TimeZone.make("America/New_York"),
	reference: { kind: "local", pluginId: PluginId.make("fitness-owner") },
	selection: { grouping: "day", comparison: "none", range: { days: 7, kind: "rolling" } },
} as const;
const filter = { kind: "targets", id: "retained-target" } as const;
function WorkoutsProbe() {
	const query = useReportedPages(analyticsWorkoutsQuery, { ...pagedInput, filter });
	return (
		<PageControls refresh={query.refetch} count={query.pages.length} next={query.fetchNextPage} />
	);
}
function ReadingsProbe() {
	const query = useReportedPages(measurementReadingsQuery, {
		...pagedInput,
		metricId: "metric-one",
	});
	return (
		<PageControls refresh={query.refetch} count={query.pages.length} next={query.fetchNextPage} />
	);
}
function RankingProbe() {
	const query = useReportedPages(analyticsRankingQuery, {
		...pagedInput,
		filter,
		kind: "targets" as const,
	});
	return (
		<PageControls refresh={query.refetch} count={query.pages.length} next={query.fetchNextPage} />
	);
}
function PageControls(props: {
	readonly count: number;
	readonly next: () => void;
	readonly refresh: () => void;
}) {
	return (
		<>
			<output>{props.count} pages</output>
			<button onClick={props.next}>More</button>
			<button onClick={props.refresh}>Refresh pages</button>
		</>
	);
}
function MetricsProbe() {
	const [owner, setOwner] = useState("fitness-owner");
	const query = useReportedPages(analyticsMeasurementMetricsQuery, {
		...pagedInput,
		reference: { kind: "local" as const, pluginId: PluginId.make(owner) },
	});
	return (
		<>
			<PageControls refresh={query.refetch} count={query.pages.length} next={query.fetchNextPage} />
			<button onClick={() => setOwner("fitness-other")}>Other owner</button>
			<output>
				{query.pages.flatMap((page) => page.items.map((item) => item.name)).join(",")}
			</output>
		</>
	);
}
const mountProbe = (clock: ReturnType<typeof createTestRyotClock>, Probe: ComponentType) =>
	mountPluginPage(Probe, {
		bootstrap: clock.bootstrap,
		location: routeLocation("/v/analytics"),
		queryExecution: () => ({ now: clock.now(), timeZone: TimeZone.make("America/New_York") }),
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
	});
const pageResponse = (
	key: string,
	nextCursor: null | string,
	items: readonly Record<string, unknown>[] = [],
) => ({
	data: {
		...(key === "targets"
			? {
					equipment: {
						items: [],
						type: "aggregate" as const,
						pageInfo: { limit: 100, hasMore: false, nextCursor: null },
					},
					exercises: {
						items: [],
						type: "aggregate" as const,
						pageInfo: { limit: 100, hasMore: false, nextCursor: null },
					},
				}
			: {}),
		[key]:
			key === "targets"
				? {
						items: [],
						type: "aggregate" as const,
						pageInfo: { limit: 100, nextCursor, hasMore: nextCursor !== null },
					}
				: {
						items,
						type: "rows" as const,
						pageInfo: { limit: 100, nextCursor, hasMore: nextCursor !== null },
					},
	},
});

describe("fitness analytics cursor adapters", () => {
	for (const { key, Probe, filtered } of [
		{ filtered: true, key: "workouts", Probe: WorkoutsProbe },
		{ key: "targets", filtered: true, Probe: RankingProbe },
		{ key: "readings", filtered: false, Probe: ReadingsProbe },
		{ key: "metrics", filtered: false, Probe: MetricsProbe },
	]) {
		it.live(
			`captures ${key} rolling boundaries for continuation and refreshes only loaded depth`,
			() =>
				Effect.gen(function* () {
					const clock = createTestRyotClock();
					yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-01T18:00:00Z")));
					const page = mountProbe(clock, Probe);
					try {
						yield* Effect.promise(() =>
							waitFor(() => expect(page.queryRequests(key)).toHaveLength(1)),
						);
						for (const request of page.queryRequests(key)) {
							page.replyQuery(request.requestId, {
								outcome: "success",
								response: pageResponse(key, "first-cursor"),
							});
						}
						yield* Effect.promise(() =>
							waitFor(() => expect(screen.getByText("1 pages")).toBeDefined()),
						);
						expect(page.queryRequests(key)).toHaveLength(1);
						yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-02T18:00:00Z")));
						act(() => {
							fireEvent.click(screen.getByRole("button", { name: "More" }));
						});
						yield* Effect.promise(() =>
							waitFor(() => expect(page.queryRequests(key)).toHaveLength(2)),
						);
						for (const request of page.queryRequests(key).slice(1)) {
							const document = yield* documentText(bindTestRequest(request.request));
							expect(document).toContain("first-cursor");
							expect(request.request.arguments).toMatchObject({
								range: "rolling",
								endOffsetDays: 1,
								startOffsetDays: -6,
							});
							expect(request.request.arguments).toMatchObject({
								range: "rolling",
								endOffsetDays: 1,
								startOffsetDays: -6,
							});
							expect(document).toContain("fitness-owner");
							if (filtered) {
								expect(document).toContain("retained-target");
							}
							page.replyQuery(request.requestId, {
								outcome: "success",
								response: pageResponse(key, "second-cursor"),
							});
						}
						yield* Effect.promise(() =>
							waitFor(() => expect(screen.getByText("2 pages")).toBeDefined()),
						);
						act(() => {
							fireEvent.click(screen.getByRole("button", { name: "Refresh pages" }));
						});
						yield* Effect.promise(() =>
							waitFor(() => expect(page.queryRequests(key)).toHaveLength(3)),
						);
						for (const request of page.queryRequests(key).slice(2)) {
							const document = yield* documentText(bindTestRequest(request.request));
							expect(document).not.toContain("first-cursor");
							expect(request.request.arguments).toMatchObject({
								range: "rolling",
								endOffsetDays: 1,
								startOffsetDays: -6,
							});
							expect(request.request.arguments).toMatchObject({
								range: "rolling",
								endOffsetDays: 1,
								startOffsetDays: -6,
							});
							page.replyQuery(request.requestId, {
								outcome: "success",
								response: pageResponse(key, "refreshed-cursor"),
							});
						}
						yield* Effect.promise(() =>
							waitFor(() => expect(page.queryRequests(key)).toHaveLength(4)),
						);
						for (const request of page.queryRequests(key).slice(3)) {
							const document = yield* documentText(bindTestRequest(request.request));
							expect(document).toContain("refreshed-cursor");
							expect(request.request.arguments).toMatchObject({
								range: "rolling",
								endOffsetDays: 1,
								startOffsetDays: -6,
							});
							expect(request.request.arguments).toMatchObject({
								range: "rolling",
								endOffsetDays: 1,
								startOffsetDays: -6,
							});
							page.replyQuery(request.requestId, {
								outcome: "success",
								response: pageResponse(key, "third-cursor"),
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
			testTimeout,
		);
	}
	it.live(
		"keeps metric pages owner-isolated and does not download unseen pages",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const page = mountProbe(clock, MetricsProbe);
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("metrics")).toHaveLength(1)),
					);
					for (const request of page.queryRequests("metrics")) {
						page.replyQuery(request.requestId, {
							outcome: "success",
							response: pageResponse("metrics", "more", [
								{
									unit: "kg",
									key: "weight",
									firstAt: null,
									rangeCount: 0,
									latestAt: null,
									pinnedAt: null,
									id: "metric-one",
									latestValue: null,
									name: "Owner one metric",
								},
							]),
						});
					}
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getByText("Owner one metric")).toBeDefined()),
					);
					expect(page.queryRequests("metrics")).toHaveLength(1);
					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "Other owner" }));
					});
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("metrics")).toHaveLength(2)),
					);
					expect(screen.queryByText("Owner one metric")).toBeNull();
					for (const request of page.queryRequests("metrics").slice(1)) {
						expect(yield* documentText(bindTestRequest(request.request))).toContain(
							"fitness-other",
						);
						expect(yield* documentText(bindTestRequest(request.request))).not.toContain(
							"fitness-owner",
						);
					}
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
		testTimeout,
	);
});

describe("fitness analytics query lifetime", () => {
	it.live(
		"cancels in-flight section queries when their consumer unmounts",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const page = mountProbe(clock, UnmountProbe);
				try {
					yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(1)));
					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "Hide section" }));
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
		testTimeout,
	);
});

function PendingSummary() {
	useRyotQuery(analyticsSummaryQuery, pagedInput);
	return <p>Summary</p>;
}
function UnmountProbe() {
	const [visible, setVisible] = useState(true);
	return (
		<>
			<button onClick={() => setVisible(false)}>Hide section</button>
			{visible ? <PendingSummary /> : null}
		</>
	);
}
