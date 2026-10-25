import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
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
import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import { act, type ComponentType, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { AnalyticsRankings } from "./rankings";
import type { AnalyticsScope, WorkoutDrillRequest } from "./reporting-model";

afterEach(disposePluginBridges);

const selection = {
	grouping: "day",
	comparison: "none",
	range: { days: 7, kind: "rolling" },
} as const;

const makeScope = (
	owner = "fitness-owner",
	timeZone = TimeZone.make("America/New_York"),
	selected: AnalyticsScope["selection"] = selection,
): AnalyticsScope => ({
	timeZone,
	selection: selected,
	owner: { kind: "local", pluginId: PluginId.make(owner) },
});

const documentText = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const itemAt = <Item,>(items: readonly Item[], index: number): Item => {
	const item = items[index];
	if (item === undefined) {
		throw new Error(`Expected an item at index ${index}`);
	}
	return item;
};
const targetTable = () => screen.getByRole("table", { name: "targets rankings" });

const rankingRow = (
	id: string,
	name: string,
	weightedSets: null | number,
	sets = 0,
	exerciseOccurrences = 0,
	workouts = 0,
) => ({ id, name, sets, workouts, weightedSets, exerciseOccurrences });

const rankingResponse = (
	nextCursor: null | string,
	items: readonly Record<string, unknown>[] = [],
) => ({
	data: {
		ranking: {
			items,
			type: "rows" as const,
			pageInfo: { limit: 100, nextCursor, hasMore: nextCursor !== null },
		},
	},
});

const mountPage = (clock: ReturnType<typeof createTestRyotClock>, Component: ComponentType) =>
	mountPluginPage(Component, {
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
			contributors: ["fitness-owner", "fitness-next"].map((pluginId) =>
				pluginContributor({ pluginId, name: "Fitness", packageId: PLUGIN_PACKAGE_ID }),
			),
		},
	});

const mountRankings = (
	clock: ReturnType<typeof createTestRyotClock>,
	scope: AnalyticsScope,
	onOpenWorkouts: (request: WorkoutDrillRequest) => void = () => {},
) =>
	mountPage(clock, () => (
		<AnalyticsRankings scope={scope} compact={false} onOpenWorkouts={onOpenWorkouts} />
	));

describe("Fitness analytics rankings", () => {
	it.live("keeps zero-activity roots and omits nullable weighted values from bars", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountRankings(clock, makeScope());
			try {
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("ranking")).toHaveLength(1)),
				);
				page.replyQuery(itemAt(page.queryRequests("ranking"), 0).requestId, {
					outcome: "success",
					response: rankingResponse(null, [
						rankingRow("target-empty", "No activity root", null),
						rankingRow("target-zero", "Known zero", 0),
					]),
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("2 targets loaded")).toBeDefined()),
				);
				const table = screen.getByRole("table", { name: "targets rankings" });
				expect(within(table).getByText("No activity root")).toBeDefined();
				expect(within(table).getByText("Known zero")).toBeDefined();
				expect(within(table).getByText("Unknown")).toBeDefined();
				const preview = screen.getByRole("region", { name: "Top weighted sets" });
				expect(within(preview).getByText("Known zero")).toBeDefined();
				expect(within(preview).queryByText("No activity root")).toBeNull();
				expect(within(preview).getAllByRole("listitem")).toHaveLength(1);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("labels target weights separately from recorded-set frequency", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountRankings(clock, makeScope());
			try {
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("ranking")).toHaveLength(1)),
				);
				page.replyQuery(itemAt(page.queryRequests("ranking"), 0).requestId, {
					outcome: "success",
					response: rankingResponse(null, [
						rankingRow("target-weighted", "Weighted target", 1.5, 9, 2, 3),
					]),
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(within(targetTable()).getByText("Weighted target")).toBeDefined()),
				);
				const preview = screen.getByRole("region", { name: "Top weighted sets" });
				expect(within(preview).getByText("1.5 weighted sets")).toBeDefined();
				const table = screen.getByRole("table", { name: "targets rankings" });
				expect(within(table).getByText("9 sets")).toBeDefined();
				expect(within(table).getByText("2 occurrences")).toBeDefined();
				expect(within(table).getByText("3 workouts")).toBeDefined();
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("loads more than 100 root rows through the next cursor", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountRankings(clock, makeScope());
			try {
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("ranking")).toHaveLength(1)),
				);
				const firstPage = itemAt(page.queryRequests("ranking"), 0);
				page.replyQuery(firstPage.requestId, {
					outcome: "success",
					response: rankingResponse(
						"target-cursor-1",
						Array.from({ length: 100 }, (_, index) =>
							rankingRow(`target-${index + 1}`, `Target ${index + 1}`, index),
						),
					),
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("100+ targets loaded")).toBeDefined()),
				);
				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "Show more targets" }));
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("ranking")).toHaveLength(2)),
				);
				const continuation = itemAt(page.queryRequests("ranking"), 1);
				expect(yield* documentText(continuation.document)).toContain("target-cursor-1");
				page.replyQuery(continuation.requestId, {
					outcome: "success",
					response: rankingResponse(null, [rankingRow("target-101", "Target 101", 101)]),
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("101 targets loaded")).toBeDefined()),
				);
				expect(screen.getByText("Target 101")).toBeDefined();
				expect(page.queryRequests("ranking")).toHaveLength(2);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("opens row workouts with its filter and captured actual reporting range", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-01T18:00:00Z")));
			const opened: WorkoutDrillRequest[] = [];
			const page = mountRankings(clock, makeScope(), (request) => opened.push(request));
			try {
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("ranking")).toHaveLength(1)),
				);
				const request = itemAt(page.queryRequests("ranking"), 0);
				expect(yield* documentText(request.document)).toContain("fitness-owner");
				expect(yield* documentText(request.document)).toContain("2026-10-26T04:00:00.000Z");
				expect(yield* documentText(request.document)).toContain("2026-11-02T05:00:00.000Z");
				page.replyQuery(request.requestId, {
					outcome: "success",
					response: rankingResponse(null, [rankingRow("target-back", "Upper back", 2, 4, 3, 2)]),
				});
				const buttonName = "View workouts contributing to Upper back";
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByRole("button", { name: buttonName })).toBeDefined()),
				);
				act(() => {
					fireEvent.click(screen.getByRole("button", { name: buttonName }));
				});
				expect(opened).toEqual([
					{
						title: "Upper back",
						periodCaption: "2026-10-26 – 2026-11-01",
						filter: { kind: "targets", id: "target-back" },
						selection: {
							grouping: "day",
							comparison: "none",
							range: { kind: "custom", endDate: "2026-11-01", startDate: "2026-10-26" },
						},
					},
				]);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("retains loaded rows after an append failure and retries the same cursor", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountRankings(clock, makeScope());
			try {
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("ranking")).toHaveLength(1)),
				);
				page.replyQuery(itemAt(page.queryRequests("ranking"), 0).requestId, {
					outcome: "success",
					response: rankingResponse("retry-cursor", [rankingRow("kept", "Retained target", 1)]),
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(within(targetTable()).getByText("Retained target")).toBeDefined()),
				);
				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "Show more targets" }));
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("ranking")).toHaveLength(2)),
				);
				const append = itemAt(page.queryRequests("ranking"), 1);
				page.replyQuery(append.requestId, { outcome: "failure", reason: "query-failed" });
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("More targets couldn't be loaded.")).toBeDefined()),
				);
				expect(within(targetTable()).getByText("Retained target")).toBeDefined();
				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "Try again" }));
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("ranking")).toHaveLength(3)),
				);
				const retry = itemAt(page.queryRequests("ranking"), 2);
				expect(yield* documentText(retry.document)).toContain("retry-cursor");
				page.replyQuery(retry.requestId, {
					outcome: "success",
					response: rankingResponse(null, [rankingRow("later", "Later target", 2)]),
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(within(targetTable()).getByText("Later target")).toBeDefined()),
				);
				expect(within(targetTable()).getByText("Retained target")).toBeDefined();
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("refreshes only loaded depth and keeps the prior rows visible while refreshing", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountRankings(clock, makeScope());
			try {
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("ranking")).toHaveLength(1)),
				);
				page.replyQuery(itemAt(page.queryRequests("ranking"), 0).requestId, {
					outcome: "success",
					response: rankingResponse("loaded-cursor", [
						rankingRow("old-first", "Old first page", 1),
					]),
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(within(targetTable()).getByText("Old first page")).toBeDefined()),
				);
				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "Show more targets" }));
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("ranking")).toHaveLength(2)),
				);
				page.replyQuery(itemAt(page.queryRequests("ranking"), 1).requestId, {
					outcome: "success",
					response: rankingResponse(null, [rankingRow("old-second", "Old second page", 2)]),
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(within(targetTable()).getByText("Old second page")).toBeDefined()),
				);
				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("ranking")).toHaveLength(3)),
				);
				expect(screen.getByText("Refreshing rankings…")).toBeDefined();
				expect(within(targetTable()).getByText("Old second page")).toBeDefined();
				page.replyQuery(itemAt(page.queryRequests("ranking"), 2).requestId, {
					outcome: "failure",
					reason: "query-failed",
				});
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByText("The targets rankings couldn't be refreshed.")).toBeDefined(),
					),
				);
				expect(within(targetTable()).getByText("Old first page")).toBeDefined();
				expect(within(targetTable()).getByText("Old second page")).toBeDefined();
				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "Try again" }));
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("ranking")).toHaveLength(4)),
				);
				page.replyQuery(itemAt(page.queryRequests("ranking"), 3).requestId, {
					outcome: "success",
					response: rankingResponse("loaded-cursor", [
						rankingRow("new-first", "New first page", 3),
					]),
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("ranking")).toHaveLength(5)),
				);
				expect(yield* documentText(itemAt(page.queryRequests("ranking"), 4).document)).toContain(
					"loaded-cursor",
				);
				page.replyQuery(itemAt(page.queryRequests("ranking"), 4).requestId, {
					outcome: "success",
					response: rankingResponse(null, [rankingRow("new-second", "New second page", 4)]),
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(within(targetTable()).getByText("New second page")).toBeDefined()),
				);
				expect(within(targetTable()).queryByText("Old first page")).toBeNull();
				expect(within(targetTable()).queryByText("Old second page")).toBeNull();
				expect(page.queryRequests("ranking")).toHaveLength(5);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("resets on owner, range, timezone, and kind changes and ignores late pages", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const initialScope = makeScope();
			function ScopeProbe() {
				const [scope, setScope] = useState(initialScope);
				return (
					<>
						<button
							type="button"
							onClick={() =>
								setScope(
									makeScope("fitness-next", TimeZone.make("Europe/Paris"), {
										grouping: "day",
										comparison: "none",
										range: { kind: "custom", endDate: "2026-09-03", startDate: "2026-09-01" },
									}),
								)
							}
						>
							Change scope
						</button>
						<AnalyticsRankings scope={scope} compact={false} onOpenWorkouts={() => {}} />
					</>
				);
			}
			const page = mountPage(clock, ScopeProbe);
			try {
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("ranking")).toHaveLength(1)),
				);
				const oldRequest = itemAt(page.queryRequests("ranking"), 0);
				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "Change scope" }));
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("ranking")).toHaveLength(2)),
				);
				const newRequest = itemAt(page.queryRequests("ranking"), 1);
				const nextDocument = yield* documentText(newRequest.document);
				expect(nextDocument).toContain("fitness-next");
				expect(nextDocument).toContain("2026-08-31T22:00:00.000Z");
				expect(nextDocument).not.toContain("fitness-owner");
				page.replyQuery(oldRequest.requestId, {
					outcome: "success",
					response: rankingResponse(null, [rankingRow("stale", "Stale owner row", 99)]),
				});
				page.replyQuery(newRequest.requestId, {
					outcome: "success",
					response: rankingResponse(null, [rankingRow("new-target", "New owner target", 1)]),
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(within(targetTable()).getByText("New owner target")).toBeDefined()),
				);
				expect(within(targetTable()).queryByText("Stale owner row")).toBeNull();
				act(() => {
					fireEvent.click(screen.getByRole("radio", { name: "Exercises" }));
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("ranking")).toHaveLength(3)),
				);
				expect(screen.queryByText("New owner target")).toBeNull();
				const exerciseRequest = itemAt(page.queryRequests("ranking"), 2);
				expect(yield* documentText(exerciseRequest.document)).toContain("fitness-next");
				page.replyQuery(exerciseRequest.requestId, {
					outcome: "success",
					response: rankingResponse(null, [rankingRow("exercise-row", "Exercise result", 2)]),
				});
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(
							within(screen.getByRole("table", { name: "exercises rankings" })).getByText(
								"Exercise result",
							),
						).toBeDefined(),
					),
				);
				expect(screen.queryByText("New owner target")).toBeNull();
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);
});
