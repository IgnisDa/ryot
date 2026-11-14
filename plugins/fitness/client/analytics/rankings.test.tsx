import { afterEach, describe, expect } from "bun:test";

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
import { bindTestRequest } from "@ryot-app/ryotql-recipes/test-utils";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";
import { act, type ComponentType, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { rankingResponse } from "../../tests/client/analytics-fixtures";
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
	reference: { kind: "local", pluginId: PluginId.make(owner) },
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
const mountPage = (clock: ReturnType<typeof createTestRyotClock>, Component: ComponentType) =>
	mountPluginPage(Component, {
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
	it.live(
		"keeps zero-activity roots and omits nullable weighted values from bars",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const page = mountRankings(clock, makeScope());
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("targets")).toHaveLength(1)),
					);
					page.replyQuery(itemAt(page.queryRequests("targets"), 0).requestId, {
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
		testTimeout,
	);

	it.live(
		"labels target weights separately from recorded-set frequency",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const page = mountRankings(clock, makeScope());
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("targets")).toHaveLength(1)),
					);
					page.replyQuery(itemAt(page.queryRequests("targets"), 0).requestId, {
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
		testTimeout,
	);

	it.live(
		"loads more than 100 root rows through the next cursor",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const page = mountRankings(clock, makeScope());
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("targets")).toHaveLength(1)),
					);
					const firstPage = itemAt(page.queryRequests("targets"), 0);
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
						waitFor(() => expect(page.queryRequests("targets")).toHaveLength(2)),
					);
					const continuation = itemAt(page.queryRequests("targets"), 1);
					expect(yield* documentText(bindTestRequest(continuation.request))).toContain(
						"target-cursor-1",
					);
					page.replyQuery(continuation.requestId, {
						outcome: "success",
						response: rankingResponse(null, [rankingRow("target-101", "Target 101", 101)]),
					});
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getByText("101 targets loaded")).toBeDefined()),
					);
					expect(screen.getByText("Target 101")).toBeDefined();
					expect(page.queryRequests("targets")).toHaveLength(2);
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
		testTimeout,
	);

	it.live(
		"opens row workouts with its filter, stable selection and displayed period caption",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-01T18:00:00Z")));
				const opened: WorkoutDrillRequest[] = [];
				const page = mountRankings(clock, makeScope(), (request) => opened.push(request));
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("targets")).toHaveLength(1)),
					);
					const request = itemAt(page.queryRequests("targets"), 0);
					expect(yield* documentText(bindTestRequest(request.request))).toContain("fitness-owner");
					expect(request.request.arguments).toMatchObject({
						range: "rolling",
						endOffsetDays: 1,
						startOffsetDays: -6,
					});
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
							periodCaption: "Oct 26 – Nov 1, 2026",
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
		testTimeout,
	);

	it.live(
		"retains loaded rows after an append failure and retries the same cursor",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const page = mountRankings(clock, makeScope());
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("targets")).toHaveLength(1)),
					);
					page.replyQuery(itemAt(page.queryRequests("targets"), 0).requestId, {
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
						waitFor(() => expect(page.queryRequests("targets")).toHaveLength(2)),
					);
					const append = itemAt(page.queryRequests("targets"), 1);
					page.replyQuery(append.requestId, { outcome: "failure", reason: "query-failed" });
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByText("More targets couldn't be loaded.")).toBeDefined(),
						),
					);
					expect(within(targetTable()).getByText("Retained target")).toBeDefined();
					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "Try again" }));
					});
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("targets")).toHaveLength(3)),
					);
					const retry = itemAt(page.queryRequests("targets"), 2);
					expect(yield* documentText(bindTestRequest(retry.request))).toContain("retry-cursor");
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
		testTimeout,
	);

	it.live(
		"refreshes only loaded depth and keeps the prior rows visible while refreshing",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const page = mountRankings(clock, makeScope());
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("targets")).toHaveLength(1)),
					);
					page.replyQuery(itemAt(page.queryRequests("targets"), 0).requestId, {
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
						waitFor(() => expect(page.queryRequests("targets")).toHaveLength(2)),
					);
					page.replyQuery(itemAt(page.queryRequests("targets"), 1).requestId, {
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
						waitFor(() => expect(page.queryRequests("targets")).toHaveLength(3)),
					);
					expect(screen.getByText("Refreshing rankings…")).toBeDefined();
					expect(within(targetTable()).getByText("Old second page")).toBeDefined();
					page.replyQuery(itemAt(page.queryRequests("targets"), 2).requestId, {
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
						waitFor(() => expect(page.queryRequests("targets")).toHaveLength(4)),
					);
					page.replyQuery(itemAt(page.queryRequests("targets"), 3).requestId, {
						outcome: "success",
						response: rankingResponse("loaded-cursor", [
							rankingRow("new-first", "New first page", 3),
						]),
					});
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("targets")).toHaveLength(5)),
					);
					expect(
						yield* documentText(bindTestRequest(itemAt(page.queryRequests("targets"), 4).request)),
					).toContain("loaded-cursor");
					page.replyQuery(itemAt(page.queryRequests("targets"), 4).requestId, {
						outcome: "success",
						response: rankingResponse(null, [rankingRow("new-second", "New second page", 4)]),
					});
					yield* Effect.promise(() =>
						waitFor(() => expect(within(targetTable()).getByText("New second page")).toBeDefined()),
					);
					expect(within(targetTable()).queryByText("Old first page")).toBeNull();
					expect(within(targetTable()).queryByText("Old second page")).toBeNull();
					expect(page.queryRequests("targets")).toHaveLength(5);
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
		testTimeout,
	);

	it.live(
		"resets on owner, range, timezone, and kind changes and ignores late pages",
		() =>
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
						waitFor(() => expect(page.queryRequests("targets")).toHaveLength(1)),
					);
					const oldRequest = itemAt(page.queryRequests("targets"), 0);
					act(() => {
						fireEvent.click(screen.getByRole("button", { name: "Change scope" }));
					});
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("targets")).toHaveLength(2)),
					);
					const newRequest = itemAt(page.queryRequests("targets"), 1);
					const nextDocument = yield* documentText(bindTestRequest(newRequest.request));
					expect(nextDocument).toContain("fitness-next");
					expect(newRequest.request.arguments).toMatchObject({
						customEndDate: "2026-09-03",
						customStartDate: "2026-09-01",
					});
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
						waitFor(() =>
							expect(within(targetTable()).getByText("New owner target")).toBeDefined(),
						),
					);
					expect(within(targetTable()).queryByText("Stale owner row")).toBeNull();
					act(() => {
						fireEvent.click(screen.getByRole("radio", { name: "Exercises" }));
					});
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("targets")).toHaveLength(3)),
					);
					expect(screen.queryByText("New owner target")).toBeNull();
					const exerciseRequest = itemAt(page.queryRequests("targets"), 2);
					expect(yield* documentText(bindTestRequest(exerciseRequest.request))).toContain(
						"fitness-next",
					);
					page.replyQuery(exerciseRequest.requestId, {
						outcome: "success",
						response: rankingResponse(
							null,
							[rankingRow("exercise-row", "Exercise result", 2)],
							"exercises",
						),
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
		testTimeout,
	);
});
