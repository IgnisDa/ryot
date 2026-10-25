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
import { AnalyticsWorkoutDrill } from "./workout-drill";

afterEach(disposePluginBridges);

const selection = {
	grouping: "day",
	comparison: "none",
	range: { kind: "custom", endDate: "2026-09-03", startDate: "2026-09-01" },
} as const;

const scope: AnalyticsScope = {
	selection,
	timeZone: TimeZone.make("America/New_York"),
	reference: { kind: "local", pluginId: PluginId.make("fitness-owner") },
};

const request: WorkoutDrillRequest = {
	selection,
	title: "Upper back",
	periodCaption: "2026-09-01 – 2026-09-03",
	filter: { kind: "targets", id: "target-upper-back" },
};

const documentText = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const itemAt = <Item,>(items: readonly Item[], index: number): Item => {
	const item = items[index];
	if (item === undefined) {
		throw new Error(`Expected an item at index ${index}`);
	}
	return item;
};

const rankingRow = () => ({
	sets: 3,
	workouts: 1,
	weightedSets: 2,
	name: "Upper back",
	exerciseOccurrences: 2,
	id: "target-upper-back",
});

const rankingResponse = {
	data: {
		ranking: {
			items: [rankingRow()],
			type: "aggregate" as const,
			pageInfo: { limit: 100, hasMore: false, nextCursor: null },
		},
	},
};

const workoutsResponse = (
	nextCursor: null | string,
	items: readonly Record<string, unknown>[],
) => ({
	data: {
		workouts: {
			items,
			type: "rows" as const,
			pageInfo: { limit: 100, nextCursor, hasMore: nextCursor !== null },
		},
	},
});

const workoutRow = (
	id: string,
	name: string,
	startedAt: string,
	activeDuration: null | number,
) => ({ id, name, startedAt, activeDuration });

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
			contributors: [
				pluginContributor({
					name: "Fitness",
					pluginId: "fitness-owner",
					packageId: PLUGIN_PACKAGE_ID,
				}),
			],
		},
	});

const preferences = { energyUnit: "kcal", unitSystem: "metric" } as const;

function DrillHost() {
	const [opened, setOpened] = useState<undefined | WorkoutDrillRequest>();
	return (
		<>
			<AnalyticsRankings scope={scope} compact={false} onOpenWorkouts={setOpened} />
			{opened === undefined ? null : (
				<AnalyticsWorkoutDrill
					key="drill"
					scope={scope}
					compact={false}
					request={opened}
					preferences={preferences}
					onClose={() => setOpened(undefined)}
				/>
			)}
		</>
	);
}

describe("Fitness analytics workout drill", () => {
	it.live(
		"uses the captured owner, filter, and selection and displays only canonical workout fields",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const page = mountPage(clock, () => (
					<AnalyticsWorkoutDrill
						scope={scope}
						compact={false}
						request={request}
						onClose={() => {}}
						preferences={preferences}
					/>
				));
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("workouts")).toHaveLength(1)),
					);
					const query = itemAt(page.queryRequests("workouts"), 0);
					const queryDocument = yield* documentText(query.document);
					expect(queryDocument).toContain("fitness-owner");
					expect(queryDocument).toContain("2026-09-01T04:00:00.000Z");
					expect(queryDocument).toContain("2026-09-04T04:00:00.000Z");
					expect(queryDocument).toContain("target-upper-back");
					page.replyQuery(query.requestId, {
						outcome: "success",
						response: workoutsResponse(null, [
							workoutRow("workout/morning", "Morning session", "2026-09-02T01:30:00.000Z", null),
							workoutRow("workout/evening", "Evening session", "2026-09-02T22:00:00.000Z", 0),
						]),
					});
					const table = yield* Effect.promise(() =>
						waitFor(() => screen.getByRole("table", { name: "Contributing workouts" })),
					);
					const morning = within(table).getByRole("row", { name: /Morning session/ });
					const evening = within(table).getByRole("row", { name: /Evening session/ });
					expect(within(morning).getByText("Sep 1, 2026, 9:30 PM")).toBeDefined();
					expect(within(morning).getByText("Unknown")).toBeDefined();
					expect(within(evening).getByText("0 seconds")).toBeDefined();
					expect(within(table).queryByRole("columnheader", { name: "Sets" })).toBeNull();
					expect(within(table).queryByRole("columnheader", { name: "Volume" })).toBeNull();
					expect(within(table).queryByRole("columnheader", { name: /personal best/i })).toBeNull();
					expect(
						screen.getByRole("heading", { name: "Upper back · 2026-09-01 – 2026-09-03" }),
					).toBeDefined();
					expect(screen.getByText("2 workouts loaded")).toBeDefined();
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);

	it.live("retries a failed append without dropping the loaded workout rows", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountPage(clock, () => (
				<AnalyticsWorkoutDrill
					scope={scope}
					compact={false}
					request={request}
					onClose={() => {}}
					preferences={preferences}
				/>
			));
			try {
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("workouts")).toHaveLength(1)),
				);
				page.replyQuery(itemAt(page.queryRequests("workouts"), 0).requestId, {
					outcome: "success",
					response: workoutsResponse("workout-cursor", [
						workoutRow("workout-kept", "Kept workout", "2026-09-02T01:30:00.000Z", 600),
					]),
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("Kept workout")).toBeDefined()),
				);
				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "Show more workouts" }));
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("workouts")).toHaveLength(2)),
				);
				const append = itemAt(page.queryRequests("workouts"), 1);
				expect(yield* documentText(append.document)).toContain("workout-cursor");
				page.replyQuery(append.requestId, { outcome: "failure", reason: "query-failed" });
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByText("More workouts couldn't be loaded.")).toBeDefined(),
					),
				);
				expect(screen.getByText("Kept workout")).toBeDefined();
				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "Try again" }));
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("workouts")).toHaveLength(3)),
				);
				const retry = itemAt(page.queryRequests("workouts"), 2);
				expect(yield* documentText(retry.document)).toContain("workout-cursor");
				page.replyQuery(retry.requestId, {
					outcome: "success",
					response: workoutsResponse(null, [
						workoutRow("workout-next", "Next workout", "2026-09-03T01:30:00.000Z", 0),
					]),
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("Next workout")).toBeDefined()),
				);
				expect(screen.getByText("Kept workout")).toBeDefined();
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live(
		"dismisses the drill, restores trigger focus, and links to the canonical workout route",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const page = mountPage(clock, DrillHost);
				try {
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("ranking")).toHaveLength(1)),
					);
					page.replyQuery(itemAt(page.queryRequests("ranking"), 0).requestId, {
						outcome: "success",
						response: rankingResponse,
					});
					const triggerName = "View workouts contributing to Upper back";
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getByRole("button", { name: triggerName })).toBeDefined()),
					);
					const trigger = screen.getByRole("button", { name: triggerName });
					trigger.focus();
					act(() => {
						fireEvent.click(trigger);
					});
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("workouts")).toHaveLength(1)),
					);
					page.replyQuery(itemAt(page.queryRequests("workouts"), 0).requestId, {
						outcome: "success",
						response: workoutsResponse(null, [
							workoutRow("workout/morning", "Morning session", "2026-09-02T01:30:00.000Z", 600),
						]),
					});
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByRole("link", { name: "Morning session" })).toBeDefined(),
						),
					);
					expect(screen.getByRole("link", { name: "Morning session" }).getAttribute("href")).toBe(
						"/e/workout%2Fmorning",
					);
					act(() => {
						fireEvent.click(
							within(screen.getByRole("dialog", { name: /Upper back/ })).getByRole("button", {
								name: "Close contributing workouts for Upper back",
							}),
						);
					});
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()),
					);
					yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(trigger)));
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);
});
