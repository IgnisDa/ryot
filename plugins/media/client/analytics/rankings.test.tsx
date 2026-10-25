import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { periodCaption, PluginId, reportingExecution } from "@ryot-app/plugin-client-sdk/plugin";
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
import { act, type ComponentType, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { analyticsSummary } from "../../tests/client/analytics-fixture";
import type { AnalyticsInput, MediaAnalyticsRanking, RecordsDrillRequest } from "./model";
import { MediaAnalyticsRankings } from "./rankings";

afterEach(disposePluginBridges);

const selection = {
	grouping: "day",
	comparison: "previous-period",
	range: { days: 7, kind: "rolling" },
} as const;
const makeInput = (
	owner = "media-owner",
	timeZone = TimeZone.make("America/New_York"),
	selected: AnalyticsInput["selection"] = selection,
): AnalyticsInput => ({
	timeZone,
	selection: selected,
	reference: { kind: "local", pluginId: PluginId.make(owner) },
});
const rankingRow = (
	entityId: string,
	name: string,
	activeObservations: number,
	mediaType = "book",
	options: { readonly titleCompletions?: number; readonly episodeCompletions?: number } = {},
): MediaAnalyticsRanking["items"][number] => ({
	name,
	entityId,
	mediaType,
	activeObservations,
	titleCompletions: options.titleCompletions ?? 0,
	episodeCompletions: options.episodeCompletions ?? 0,
	label: mediaType === "book" ? "Book" : "Show episode",
});
const rankingResponse = (
	nextCursor: null | string,
	items: readonly MediaAnalyticsRanking["items"][number][] = [],
) => ({
	data: {
		ranking: {
			items,
			type: "aggregate" as const,
			pageInfo: { limit: 100, nextCursor, hasMore: nextCursor !== null },
		},
	},
});

const mountPage = (clock: ReturnType<typeof createTestRyotClock>, Component: ComponentType) =>
	mountPluginPage(Component, {
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
			contributors: ["media-owner", "media-next"].map((pluginId) =>
				pluginContributor({ pluginId, name: "Media", packageId: PLUGIN_PACKAGE_ID }),
			),
		},
	});

const mountRankings = (
	clock: ReturnType<typeof createTestRyotClock>,
	input: AnalyticsInput,
	summary = analyticsSummary(input),
	onDrill: (request: RecordsDrillRequest) => void = () => {},
) =>
	mountPage(clock, () => (
		<MediaAnalyticsRankings input={input} summary={summary} onDrill={onDrill} />
	));

const itemAt = <Item,>(items: readonly Item[], index: number): Item => {
	const item = items[index];
	if (item === undefined) {
		throw new Error(`Expected an item at ${index}`);
	}
	return item;
};
const rankingRequests = (page: ReturnType<typeof mountPage>) => page.queryRequests("ranking");
const asText = (value: unknown) => JSON.stringify(value);
const getCurrentRankingTable = () => screen.getByRole("table", { name: "Media entity rankings" });

describe("Media analytics rankings", () => {
	it.live(
		"loads every cursor page, preserves returned tie order, and limits the bar preview to ten loaded rows",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const page = mountRankings(clock, makeInput());
				try {
					yield* Effect.promise(() => waitFor(() => expect(rankingRequests(page)).toHaveLength(1)));
					const firstPage = itemAt(rankingRequests(page), 0);
					const tieNames = new Map([
						[0, "Zulu tie"],
						[1, "Alpha tie"],
					]);
					const firstRows = Array.from({ length: 100 }, (_, index) =>
						rankingRow(
							`entity-${String(index + 1).padStart(3, "0")}`,
							tieNames.get(index) ?? `Entity ${index + 1}`,
							index < 2 ? 10 : 100 - index,
							index === 2 ? "show-episode" : "book",
							{ titleCompletions: index === 2 ? 0 : 1, episodeCompletions: index === 2 ? 2 : 0 },
						),
					);
					page.replyQuery(firstPage.requestId, {
						outcome: "success",
						response: rankingResponse("opaque-ranked-page/cursor?keep=this", firstRows),
					});
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getByText("100+ entities loaded")).toBeDefined()),
					);
					const rankingTable = screen.getByRole("table", { name: "Media entity rankings" });
					const firstTwo = within(rankingTable)
						.getAllByRole("row")
						.slice(1, 3)
						.map((row) => row.querySelector("td")?.textContent);
					expect(firstTwo).toEqual(["Zulu tie", "Alpha tie"]);
					const preview = screen.getByRole("region", { name: "Top active observations" });
					expect(within(preview).getAllByRole("listitem")).toHaveLength(10);
					expect(within(preview).getByText("First 10 loaded rows")).toBeDefined();
					expect(within(preview).queryByText("Entity 11")).toBeNull();
					expect(within(rankingTable).getByText("Show episode")).toBeDefined();
					expect(within(rankingTable).getByText("2 episodes")).toBeDefined();
					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "Show more rankings" }));
					});
					yield* Effect.promise(() => waitFor(() => expect(rankingRequests(page)).toHaveLength(2)));
					const continuation = itemAt(rankingRequests(page), 1);
					expect(asText(continuation.document)).toContain("opaque-ranked-page/cursor?keep=this");
					page.replyQuery(continuation.requestId, {
						outcome: "success",
						response: rankingResponse(null, [rankingRow("entity-101", "Entity 101", 0)]),
					});
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getByText("101 entities loaded")).toBeDefined()),
					);
					expect(within(rankingTable).getAllByRole("row")).toHaveLength(102);
					expect(within(rankingTable).getByText("Entity 101")).toBeDefined();
					expect(within(rankingTable).getByText("0 observations")).toBeDefined();
					expect(within(preview).getAllByRole("listitem")).toHaveLength(10);
					expect(page.queryRequests("ranking")).toHaveLength(2);
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);

	it.live("shows ranking counts", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const input = makeInput();
			const page = mountRankings(clock, input);
			try {
				yield* Effect.promise(() => waitFor(() => expect(rankingRequests(page)).toHaveLength(1)));
				page.replyQuery(itemAt(rankingRequests(page), 0).requestId, {
					outcome: "success",
					response: rankingResponse(null, [
						rankingRow("book-known", "Source title remains visible", 0, "book", {
							titleCompletions: 3,
							episodeCompletions: 2,
						}),
					]),
				});
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getAllByText("Source title remains visible").length).toBeGreaterThan(0),
					),
				);
				const table = screen.getByRole("table", { name: "Media entity rankings" });
				expect(within(table).getByText("3 titles")).toBeDefined();
				expect(within(table).getByText("2 episodes")).toBeDefined();
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live(
		"offers every current report media slug and ignores a late response from the previous type filter",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const input = makeInput();
				const page = mountRankings(clock, input);
				try {
					yield* Effect.promise(() => waitFor(() => expect(rankingRequests(page)).toHaveLength(1)));
					const originalRequest = itemAt(rankingRequests(page), 0);
					act(() => {
						fireEvent.click(
							screen.getByRole("button", { name: "Ranking media type: All media types" }),
						);
					});
					expect(screen.getByRole("radio", { name: "Book" })).toBeDefined();
					expect(screen.getByRole("radio", { name: "Show episode" })).toBeDefined();
					act(() => {
						fireEvent.click(screen.getByRole("radio", { name: "Show episode" }));
					});
					yield* Effect.promise(() => waitFor(() => expect(rankingRequests(page)).toHaveLength(2)));
					const filteredRequest = itemAt(rankingRequests(page), 1);
					expect(asText(filteredRequest.document)).toContain("show-episode");
					page.replyQuery(originalRequest.requestId, {
						outcome: "success",
						response: rankingResponse(null, [rankingRow("stale-book", "Late book result", 20)]),
					});
					page.replyQuery(filteredRequest.requestId, {
						outcome: "success",
						response: rankingResponse(null, [
							rankingRow("episode", "Filtered episode", 2, "show-episode"),
						]),
					});
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(within(getCurrentRankingTable()).getByText("Filtered episode")).toBeDefined(),
						),
					);
					expect(within(getCurrentRankingTable()).queryByText("Late book result")).toBeNull();
					expect(
						screen.getByRole("button", { name: "Ranking media type: Show episode" }),
					).toBeDefined();
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);

	it.live("opens exact entity and all-record drills from the first-page captured period", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-01T18:00:00Z")));
			const opened: RecordsDrillRequest[] = [];
			const input = makeInput();
			const page = mountRankings(clock, input, analyticsSummary(input), (request) =>
				opened.push(request),
			);
			try {
				yield* Effect.promise(() => waitFor(() => expect(rankingRequests(page)).toHaveLength(1)));
				const firstRequest = itemAt(rankingRequests(page), 0);
				expect(asText(firstRequest.document)).toContain("media-owner");
				page.replyQuery(firstRequest.requestId, {
					outcome: "success",
					response: rankingResponse(null, [
						rankingRow("title/exact", "Title to inspect", 4, "book", { titleCompletions: 1 }),
					]),
				});
				const rowAction = "View records contributing to Title to inspect";
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByRole("button", { name: rowAction })).toBeDefined()),
				);
				act(() => {
					fireEvent.click(screen.getByRole("button", { name: rowAction }));
				});
				const captured = itemAt(opened, 0);
				const firstPageReporting = reportingExecution(input.selection, {
					timeZone: input.timeZone,
					now: Date.parse("2026-11-01T18:00:00Z"),
				});
				expect(captured).toEqual({
					activeOnly: true,
					mediaType: "book",
					entityId: "title/exact",
					title: "Title to inspect",
					selection: firstPageReporting.selection,
					periodCaption: periodCaption(firstPageReporting.resolved.current),
				});
				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "All records" }));
				});
				expect(itemAt(opened, 1)).toEqual({
					activeOnly: false,
					title: "All records",
					selection: captured.selection,
					periodCaption: captured.periodCaption,
				});
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live(
		"retries a failed append and a failed loaded-depth refresh without losing visible pages",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-01T18:00:00Z")));
				const page = mountRankings(clock, makeInput());
				try {
					yield* Effect.promise(() => waitFor(() => expect(rankingRequests(page)).toHaveLength(1)));
					page.replyQuery(itemAt(rankingRequests(page), 0).requestId, {
						outcome: "success",
						response: rankingResponse("append-cursor", [rankingRow("old-one", "Old page one", 3)]),
					});
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(within(getCurrentRankingTable()).getByText("Old page one")).toBeDefined(),
						),
					);
					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "Show more rankings" }));
					});
					yield* Effect.promise(() => waitFor(() => expect(rankingRequests(page)).toHaveLength(2)));
					const append = itemAt(rankingRequests(page), 1);
					expect(asText(append.document)).toContain("append-cursor");
					page.replyQuery(append.requestId, { outcome: "failure", reason: "query-failed" });
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByText("More rankings couldn't be loaded.")).toBeDefined(),
						),
					);
					expect(within(getCurrentRankingTable()).getByText("Old page one")).toBeDefined();
					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "Try again" }));
					});
					yield* Effect.promise(() => waitFor(() => expect(rankingRequests(page)).toHaveLength(3)));
					expect(asText(itemAt(rankingRequests(page), 2).document)).toContain("append-cursor");
					page.replyQuery(itemAt(rankingRequests(page), 2).requestId, {
						outcome: "success",
						response: rankingResponse(null, [rankingRow("old-two", "Old page two", 2)]),
					});
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(within(getCurrentRankingTable()).getByText("Old page two")).toBeDefined(),
						),
					);
					yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-02T18:00:00Z")));
					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
					});
					yield* Effect.promise(() => waitFor(() => expect(rankingRequests(page)).toHaveLength(4)));
					expect(screen.getByText("Refreshing rankings…")).toBeDefined();
					expect(within(getCurrentRankingTable()).getByText("Old page two")).toBeDefined();
					page.replyQuery(itemAt(rankingRequests(page), 3).requestId, {
						outcome: "success",
						response: rankingResponse("replacement-cursor", [
							rankingRow("fresh-one", "Fresh page one", 5),
						]),
					});
					yield* Effect.promise(() => waitFor(() => expect(rankingRequests(page)).toHaveLength(5)));
					page.replyQuery(itemAt(rankingRequests(page), 4).requestId, {
						outcome: "failure",
						reason: "query-failed",
					});
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByText("The rankings couldn't be refreshed.")).toBeDefined(),
						),
					);
					expect(within(getCurrentRankingTable()).getByText("Old page one")).toBeDefined();
					expect(within(getCurrentRankingTable()).getByText("Old page two")).toBeDefined();
					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "Try again" }));
					});
					yield* Effect.promise(() => waitFor(() => expect(rankingRequests(page)).toHaveLength(6)));
					page.replyQuery(itemAt(rankingRequests(page), 5).requestId, {
						outcome: "success",
						response: rankingResponse("retry-depth-cursor", [
							rankingRow("new-one", "New page one", 7),
						]),
					});
					yield* Effect.promise(() => waitFor(() => expect(rankingRequests(page)).toHaveLength(7)));
					expect(asText(itemAt(rankingRequests(page), 6).document)).toContain("retry-depth-cursor");
					page.replyQuery(itemAt(rankingRequests(page), 6).requestId, {
						outcome: "success",
						response: rankingResponse(null, [rankingRow("new-two", "New page two", 6)]),
					});
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(within(getCurrentRankingTable()).getByText("New page two")).toBeDefined(),
						),
					);
					expect(within(getCurrentRankingTable()).queryByText("Old page one")).toBeNull();
					expect(within(getCurrentRankingTable()).queryByText("Old page two")).toBeNull();
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);

	it.live(
		"shows an SDK repeated-cursor append failure and resets late responses when ranking scope changes",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const original = makeInput();
				function ScopeProbe() {
					const [input, setInput] = useState(original);
					const summary = analyticsSummary(original);
					return (
						<>
							<button
								type="button"
								onClick={() =>
									setInput(
										makeInput("media-next", TimeZone.make("Europe/Paris"), {
											grouping: "day",
											comparison: "none",
											range: { kind: "custom", endDate: "2026-09-03", startDate: "2026-09-01" },
										}),
									)
								}
							>
								Change ranking scope
							</button>
							<MediaAnalyticsRankings input={input} summary={summary} onDrill={() => {}} />
						</>
					);
				}
				const page = mountPage(clock, ScopeProbe);
				try {
					yield* Effect.promise(() => waitFor(() => expect(rankingRequests(page)).toHaveLength(1)));
					const originalRequest = itemAt(rankingRequests(page), 0);
					page.replyQuery(originalRequest.requestId, {
						outcome: "success",
						response: rankingResponse("same-cursor", [rankingRow("kept", "Initial row", 2)]),
					});
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(within(getCurrentRankingTable()).getByText("Initial row")).toBeDefined(),
						),
					);
					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "Show more rankings" }));
					});
					yield* Effect.promise(() => waitFor(() => expect(rankingRequests(page)).toHaveLength(2)));
					const repeated = itemAt(rankingRequests(page), 1);
					page.replyQuery(repeated.requestId, {
						outcome: "success",
						response: rankingResponse("same-cursor", [rankingRow("loop", "Do not append", 1)]),
					});
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByText("More rankings couldn't be loaded.")).toBeDefined(),
						),
					);
					expect(within(getCurrentRankingTable()).getByText("Initial row")).toBeDefined();
					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "Change ranking scope" }));
					});
					yield* Effect.promise(() => waitFor(() => expect(rankingRequests(page)).toHaveLength(3)));
					const nextRequest = itemAt(rankingRequests(page), 2);
					expect(asText(nextRequest.document)).toContain("media-next");
					expect(asText(nextRequest.document)).toContain("2026-08-31T22:00:00.000Z");
					expect(asText(nextRequest.document)).toContain("2026-09-03T22:00:00.000Z");
					expect(asText(nextRequest.document)).not.toContain("media-owner");
					expect(screen.queryByText("Initial row")).toBeNull();
					page.replyQuery(originalRequest.requestId, {
						outcome: "success",
						response: rankingResponse(null, [rankingRow("stale", "Late old scope", 99)]),
					});
					page.replyQuery(nextRequest.requestId, {
						outcome: "success",
						response: rankingResponse(null, [rankingRow("current", "Current scope row", 1)]),
					});
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(within(getCurrentRankingTable()).getByText("Current scope row")).toBeDefined(),
						),
					);
					expect(within(getCurrentRankingTable()).queryByText("Late old scope")).toBeNull();
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);
});
