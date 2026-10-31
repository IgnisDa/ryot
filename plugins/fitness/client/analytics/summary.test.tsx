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
import { fireEvent, screen, waitFor } from "@testing-library/dom";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import type { AnalyticsDisplayPreferences, AnalyticsScope } from "./reporting-model";
import { AnalyticsSummary } from "./summary";

afterEach(disposePluginBridges);

type Totals = {
	readonly sets: number;
	readonly failed: number;
	readonly pending: number;
	readonly workouts: number;
	readonly activeDays: number;
	readonly timedWorkouts: number;
	readonly volume: null | number;
	readonly calories: null | number;
	readonly calorieWorkouts: number;
	readonly distance: null | number;
	readonly measurementEntries: number;
	readonly repetitions: null | number;
	readonly plannedRest: null | number;
	readonly setDuration: null | number;
	readonly measurementReadings: number;
	readonly personalBests: null | number;
	readonly activeDuration: null | number;
	readonly personalBestSets: null | number;
};

const aggregate = (
	item: Record<string, null | number>,
): { readonly type: "aggregate"; readonly items: readonly Record<string, null | number>[] } => ({
	items: [item],
	type: "aggregate",
});

const totals = (overrides: Partial<Totals> = {}) => {
	const value: Totals = {
		sets: 0,
		failed: 0,
		pending: 0,
		workouts: 0,
		volume: null,
		activeDays: 0,
		calories: null,
		distance: null,
		timedWorkouts: 0,
		repetitions: null,
		plannedRest: null,
		setDuration: null,
		calorieWorkouts: 0,
		personalBests: null,
		activeDuration: null,
		measurementEntries: 0,
		personalBestSets: null,
		measurementReadings: 0,
		...overrides,
	};
	return {
		data: {
			entries: aggregate({ entries: value.measurementEntries }),
			readings: aggregate({ readings: value.measurementReadings }),
			workouts: aggregate({
				workouts: value.workouts,
				calories: value.calories,
				activeDays: value.activeDays,
				timedWorkouts: value.timedWorkouts,
				activeDuration: value.activeDuration,
				calorieWorkouts: value.calorieWorkouts,
			}),
			sets: aggregate({
				sets: value.sets,
				volume: value.volume,
				failed: value.failed,
				pending: value.pending,
				distance: value.distance,
				repetitions: value.repetitions,
				plannedRest: value.plannedRest,
				setDuration: value.setDuration,
				personalBests: value.personalBests,
				personalBestSets: value.personalBestSets,
			}),
		},
	};
};
const documentText = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const metricText = (label: string) =>
	screen.getByText(label, { selector: "dt" }).parentElement?.textContent ?? "";

const selection: AnalyticsScope["selection"] = {
	grouping: "day",
	comparison: "none",
	range: { days: 7, kind: "rolling" },
};
const preferences: AnalyticsDisplayPreferences = { energyUnit: "kcal", unitSystem: "metric" };

const mountSummary = (
	clock: ReturnType<typeof createTestRyotClock>,
	selectionInput: AnalyticsScope["selection"],
	preferencesInput = preferences,
) => {
	const scope: AnalyticsScope = {
		selection: selectionInput,
		timeZone: TimeZone.make("America/New_York"),
		reference: { kind: "local", pluginId: PluginId.make("fitness-owner") },
	};
	return mountPluginPage(
		() => <AnalyticsSummary scope={scope} compact={false} preferences={preferencesInput} />,
		{
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
		},
	);
};

describe("Fitness analytics summary UI", () => {
	it.live("notes failed processing and preserves entered readings", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountSummary(clock, selection);
			try {
				yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(1)));
				expect(screen.getByText("Loading Fitness analytics summary…")).toBeDefined();
				page.replyQuery(page.queryRequests()[0]?.requestId ?? "", {
					outcome: "failure",
					reason: "query-failed",
				});
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(
							screen.getByRole("button", { name: "Retry Fitness analytics summary" }),
						).toBeDefined(),
					),
				);
				fireEvent.click(screen.getByRole("button", { name: "Retry Fitness analytics summary" }));
				yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(2)));
				page.replyQuery(page.queryRequests()[1]?.requestId ?? "", {
					outcome: "success",
					response: totals({
						sets: 4,
						failed: 1,
						workouts: 1,
						activeDays: 0,
						calories: null,
						activeDuration: null,
						measurementEntries: 2,
						measurementReadings: 5,
					}),
				});
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(metricText("Measurement readings")).toBe("Measurement readings5readings"),
					),
				);
				expect(metricText("Active days")).toBe("Active days0days");
				expect(metricText("Measurement entries")).toBe("Measurement entries2entries");
				expect(metricText("Active time")).toBe("Active time—0 of 1 workouts timed");
				expect(metricText("Energy")).toBe("Energy—0 of 1 workouts with energy");
				expect(screen.queryByText("Distance", { selector: "dt" })).toBeNull();
				expect(screen.getAllByText("Processing failed; may be incomplete").length).toBeGreaterThan(
					0,
				);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live(
		"compares actual periods and formats fractional derived values with display preferences",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-01T18:00:00Z")));
				const page = mountSummary(
					clock,
					{ grouping: "day", comparison: "previous-period", range: { days: 7, kind: "rolling" } },
					{ energyUnit: "kJ", unitSystem: "imperial" },
				);
				try {
					yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(2)));
					for (const request of page.queryRequests()) {
						const document = yield* documentText(request.document);
						const isCurrent = document.includes("2026-11-02T05:00:00.000Z");
						page.replyQuery(request.requestId, {
							outcome: "success",
							response: isCurrent
								? totals({
										sets: 4,
										workouts: 2,
										calories: 2,
										volume: 0.5,
										timedWorkouts: 1,
										personalBests: 3,
										calorieWorkouts: 1,
										personalBestSets: 2,
										activeDuration: 90.5,
									})
								: totals({
										sets: 1,
										volume: 0,
										workouts: 1,
										calories: 0,
										timedWorkouts: 1,
										personalBests: 0,
										activeDuration: 0,
										calorieWorkouts: 1,
										personalBestSets: 1,
									}),
						});
					}
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(metricText("Energy")).toBe(
								"Energy≥8.37kJNew+8.37 kJ vs previous1 of 2 workouts with energy",
							),
						),
					);
					expect(metricText("Volume")).toBe(
						"Volume1.1lb × repsNew+1.1 lb × reps vs previous period",
					);
					expect(metricText("Workouts")).toBe(
						"Workouts2workouts↑ 100%+1 workout vs previous period",
					);
					expect(metricText("Active time")).toBe(
						"Active time≥1m 31sNew+1m 31s vs previous period1 of 2 workouts timed",
					);
					expect(metricText("Personal bests")).toBe(
						"Personal bests3personal bestsNew+3 personal bests vs previous",
					);
					expect(metricText("Sets with personal bests")).toBe(
						"Sets with personal bests2sets↑ 100%+1 set vs previous",
					);
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);
});
