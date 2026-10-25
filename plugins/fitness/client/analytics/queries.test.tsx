import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { periodCaption, PluginId, TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import {
	reportingPageParam,
	useRyotInfiniteQuery,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import {
	createTestRyotClock,
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import type { ReportingSelection } from "@ryot-app/plugin-kit/schema";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { act, type ComponentType, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	analyticsMeasurementMetricsQuery,
	analyticsPageInput,
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
		evidenceIntegrity: aggregate({ matchedRows: 0, distinctSets: 0 }),
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
			volume: null,
			failedSets: 0,
			pendingSets: 0,
			distance: null,
			taxonomySets: 0,
			personalBests: 0,
			repetitions: null,
			plannedRest: null,
			setDuration: null,
			personalBestSets: 0,
			legacyTaxonomySets: 0,
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
	it.live("resolves actual previous dates and a fresh execution clock with stable inputs", () =>
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
				const documents = page.queryRequests().map(({ document }) => JSON.stringify(document));
				expect(
					documents.some(
						(document) =>
							document.includes("2026-10-26T04:00:00.000Z") &&
							document.includes("2026-11-02T05:00:00.000Z"),
					),
				).toBe(true);
				expect(
					documents.some(
						(document) =>
							document.includes("2026-10-19T04:00:00.000Z") &&
							document.includes("2026-10-26T04:00:00.000Z"),
					),
				).toBe(true);
				for (const request of page.queryRequests()) {
					expect(Object.keys(request.document.queries)).toHaveLength(5);
					page.replyQuery(request.requestId, { response, outcome: "success" });
				}
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("Comparison ready")).toBeDefined()),
				);
				expect(screen.getByLabelText("Resolved comparison").textContent).toBe(
					"2026-10-19 – 2026-10-25",
				);
				yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-02T18:00:00Z")));
				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
				});
				yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(4)));
				const refreshed = page
					.queryRequests()
					.slice(2)
					.map(({ document }) => JSON.stringify(document));
				expect(
					refreshed.some(
						(document) =>
							document.includes("2026-10-27T04:00:00.000Z") &&
							document.includes("2026-11-03T05:00:00.000Z"),
					),
				).toBe(true);
				expect(
					refreshed.some(
						(document) =>
							document.includes("2026-10-20T04:00:00.000Z") &&
							document.includes("2026-10-27T04:00:00.000Z"),
					),
				).toBe(true);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);
	it.live("omits the comparison query for all-time and disabled comparisons", () =>
		Effect.gen(function* () {
			for (const selection of [
				{ grouping: "auto", range: { kind: "all-time" }, comparison: "previous-period" },
				{ grouping: "day", comparison: "none", range: { days: 7, kind: "rolling" } },
			] as const) {
				const clock = createTestRyotClock();
				const page = mountSummary(clock, selection);
				try {
					yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(1)));
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
	);
});

const pagedInput = {
	timeZone: TimeZone.make("America/New_York"),
	reference: { kind: "local", pluginId: PluginId.make("fitness-owner") },
	selection: { grouping: "day", comparison: "none", range: { days: 7, kind: "rolling" } },
} as const;
const filter = { kind: "targets", id: "retained-target" } as const;
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
function WorkoutsProbe() {
	const query = useRyotInfiniteQuery(
		analyticsWorkoutsQuery,
		{ ...pagedInput, filter },
		{
			initialPageParam: null,
			getPageInput: analyticsPageInput,
			getNextPageParam: reportingPageParam,
		},
	);
	return (
		<PageControls refresh={query.refetch} count={query.pages.length} next={query.fetchNextPage} />
	);
}
function ReadingsProbe() {
	const query = useRyotInfiniteQuery(
		measurementReadingsQuery,
		{ ...pagedInput, metricId: "metric-one" },
		{
			initialPageParam: null,
			getPageInput: analyticsPageInput,
			getNextPageParam: reportingPageParam,
		},
	);
	return (
		<PageControls refresh={query.refetch} count={query.pages.length} next={query.fetchNextPage} />
	);
}
function RankingProbe() {
	const query = useRyotInfiniteQuery(
		analyticsRankingQuery,
		{ ...pagedInput, filter, kind: "targets" as const },
		{
			initialPageParam: null,
			getPageInput: analyticsPageInput,
			getNextPageParam: reportingPageParam,
		},
	);
	return (
		<PageControls refresh={query.refetch} count={query.pages.length} next={query.fetchNextPage} />
	);
}
function MetricsProbe() {
	const [owner, setOwner] = useState("fitness-owner");
	const query = useRyotInfiniteQuery(
		analyticsMeasurementMetricsQuery,
		{ ...pagedInput, reference: { kind: "local" as const, pluginId: PluginId.make(owner) } },
		{
			initialPageParam: null,
			getPageInput: analyticsPageInput,
			getNextPageParam: reportingPageParam,
		},
	);
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
		[key]: {
			items,
			type: "rows" as const,
			pageInfo: { limit: 100, nextCursor, hasMore: nextCursor !== null },
		},
	},
});

describe("fitness analytics cursor adapters", () => {
	for (const { key, Probe, filtered } of [
		{ filtered: true, key: "workouts", Probe: WorkoutsProbe },
		{ key: "ranking", filtered: true, Probe: RankingProbe },
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
							const document = yield* documentText(request.document);
							expect(document).toContain("first-cursor");
							expect(document).toContain("2026-10-26T04:00:00.000Z");
							expect(document).toContain("2026-11-02T05:00:00.000Z");
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
							const document = yield* documentText(request.document);
							expect(document).not.toContain("first-cursor");
							expect(document).toContain("2026-10-27T04:00:00.000Z");
							expect(document).toContain("2026-11-03T05:00:00.000Z");
							page.replyQuery(request.requestId, {
								outcome: "success",
								response: pageResponse(key, "refreshed-cursor"),
							});
						}
						yield* Effect.promise(() =>
							waitFor(() => expect(page.queryRequests(key)).toHaveLength(4)),
						);
						for (const request of page.queryRequests(key).slice(3)) {
							const document = yield* documentText(request.document);
							expect(document).toContain("refreshed-cursor");
							expect(document).toContain("2026-10-27T04:00:00.000Z");
							expect(document).toContain("2026-11-03T05:00:00.000Z");
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
		);
	}
	it.live("keeps metric pages owner-isolated and does not download unseen pages", () =>
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
					expect(yield* documentText(request.document)).toContain("fitness-other");
					expect(yield* documentText(request.document)).not.toContain("fitness-owner");
				}
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);
});

describe("fitness analytics query lifetime", () => {
	it.live("refreshes pending coverage until ready, without a processing-status query", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountSummary(clock, { ...pagedInput.selection, comparison: "none" });
			try {
				yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(1)));
				for (const request of page.queryRequests()) {
					page.replyQuery(request.requestId, {
						outcome: "success",
						response: {
							data: {
								...response.data,
								evidenceIntegrity: aggregate({ matchedRows: 1, distinctSets: 1 }),
								sets: aggregate({ ...response.data.sets.items[0], sets: 1, pendingSets: 1 }),
							},
						},
					});
				}
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("No comparison")).toBeDefined()),
				);
				yield* Effect.promise(() => clock.advance(1000));
				yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(2)));
				for (const request of page.queryRequests().slice(1)) {
					page.replyQuery(request.requestId, { response, outcome: "success" });
				}
				yield* Effect.promise(() => clock.advance(3000));
				expect(page.queryRequests()).toHaveLength(2);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);
	it.live("cancels in-flight section queries when their consumer unmounts", () =>
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
