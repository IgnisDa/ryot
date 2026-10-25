import { afterEach, assert, describe, expect, it } from "@effect/vitest";
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

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import type {
	AnalyticsDisplayPreferences,
	AnalyticsScope,
	WorkoutDrillRequest,
} from "./reporting-model";
import { AnalyticsWorkouts } from "./workouts";

afterEach(disposePluginBridges);

const preferences: AnalyticsDisplayPreferences = { energyUnit: "kcal", unitSystem: "metric" };
const daySelection: AnalyticsScope["selection"] = {
	grouping: "day",
	comparison: "none",
	range: { kind: "custom", endDate: "2026-03-01", startDate: "2026-03-01" },
};
const aggregate = (
	items: readonly Record<string, null | number | string>[],
): {
	readonly type: "aggregate";
	readonly items: readonly Record<string, null | number | string>[];
	readonly pageInfo: { readonly limit: number; readonly hasMore: boolean };
} => ({ items, type: "aggregate", pageInfo: { limit: 366, hasMore: false } });
const trendResponse = (
	points: readonly Record<string, null | number | string>[],
	key: "setTrend" | "workoutTrend" = "workoutTrend",
) => ({ data: { [key]: aggregate(points) } });
const hourResponse = (starts = 3) => ({ data: { hours: aggregate([{ starts, hour: 8 }]) } });
const workoutPoint = (at: string, value: null | number) => ({
	at,
	value,
	observations: 1,
	knownValues: value === null ? 0 : 1,
});
const setPoint = (at: string, value: null | number) => ({
	...workoutPoint(at, value),
	failedSets: 0,
	pendingSets: 0,
});
const documentText = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const mountWorkouts = (
	clock: ReturnType<typeof createTestRyotClock>,
	selection: AnalyticsScope["selection"],
) => {
	const scope: AnalyticsScope = {
		selection,
		timeZone: TimeZone.make("UTC"),
		owner: { kind: "local", pluginId: PluginId.make("fitness-owner") },
	};
	const drillRequests: WorkoutDrillRequest[] = [];
	const page = mountPluginPage(
		() => (
			<AnalyticsWorkouts
				scope={scope}
				compact={false}
				preferences={preferences}
				onOpenWorkouts={(request) => drillRequests.push(request)}
			/>
		),
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
	return { page, drillRequests };
};

const answerInitial = Effect.fnUntraced(function* (
	page: ReturnType<typeof mountPluginPage>,
	answered: Set<string>,
	options: {
		readonly failedHours?: boolean;
		readonly trend?: (requestText: string) => ReturnType<typeof trendResponse>;
	} = {},
) {
	for (const request of page.queryRequests()) {
		if (answered.has(request.requestId)) {
			continue;
		}
		answered.add(request.requestId);
		if ("hours" in request.document.queries) {
			page.replyQuery(
				request.requestId,
				options.failedHours === true
					? { outcome: "failure", reason: "query-failed" }
					: { outcome: "success", response: hourResponse() },
			);
		} else if ("workoutTrend" in request.document.queries) {
			const text = yield* documentText(request.document);
			page.replyQuery(request.requestId, {
				outcome: "success",
				response:
					options.trend?.(text) ?? trendResponse([workoutPoint("2026-03-01T00:00:00.000Z", 0)]),
			});
		}
	}
});

describe("Fitness analytics workout charts", () => {
	it.live(
		"starts with workouts, keeps unknown volume missing, drills only selected workout buckets",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				yield* Effect.promise(() => clock.setTime(Date.parse("2026-03-01T12:00:00Z")));
				const { page, drillRequests } = mountWorkouts(clock, daySelection);
				const answered = new Set<string>();
				try {
					yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(3)));
					for (const request of page.queryRequests()) {
						expect(yield* documentText(request.document)).toContain("fitness-owner");
					}
					yield* answerInitial(page, answered);
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getByText("Workout starts")).toBeDefined()),
					);
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getAllByText("View exact values")).toHaveLength(3)),
					);
					fireEvent.click(screen.getAllByText("View exact values")[1] ?? document.body);
					const hourTable = yield* Effect.promise(() =>
						screen.findByRole("table", { name: "Workout starts by reporting hour exact values" }),
					);
					expect(within(hourTable).queryByRole("button")).toBeNull();
					expect(drillRequests).toHaveLength(0);

					fireEvent.click(screen.getAllByText("View exact values")[0] ?? document.body);
					fireEvent.click(
						yield* Effect.promise(() =>
							screen.findByRole("button", { name: /View records: 2026-03-01.*0 workouts/ }),
						),
					);
					expect(drillRequests).toEqual([
						{
							periodCaption: "2026-03-01",
							title: "Workouts starting in this bucket",
							selection: {
								grouping: "day",
								comparison: "none",
								range: { kind: "custom", endDate: "2026-03-01", startDate: "2026-03-01" },
							},
						},
					]);

					fireEvent.click(screen.getByRole("button", { name: "Trend metric: Workouts" }));
					const volumeOption = yield* Effect.promise(() =>
						screen.findByRole("radio", { name: "Weight volume" }),
					);
					fireEvent.click(volumeOption);
					const volumeRequest = yield* Effect.promise(() =>
						waitFor(() => {
							const request = page.queryRequests("setTrend")[0];
							assert(request);
							return request;
						}),
					);
					page.replyQuery(volumeRequest.requestId, {
						outcome: "success",
						response: trendResponse([setPoint("2026-03-01T00:00:00.000Z", null)], "setTrend"),
					});
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(
								screen.getByText("No recorded values. Missing data is not zero."),
							).toBeDefined(),
						),
					);
					fireEvent.click(screen.getAllByText("View exact values")[0] ?? document.body);
					const volumeTable = yield* Effect.promise(() =>
						screen.findByRole("table", {
							name: "Weight volume by workout-start period exact values",
						}),
					);
					expect(within(volumeTable).getByText(/Not recorded/)).toBeDefined();
					expect(screen.getByText("Workout starts")).toBeDefined();
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);

	it.live(
		"uses the actual prior month, keeps extra previous dates and drills from their own bucket",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				yield* Effect.promise(() => clock.setTime(Date.parse("2026-04-01T12:00:00Z")));
				const selectionInput: AnalyticsScope["selection"] = {
					grouping: "month",
					comparison: "previous-period",
					range: { kind: "custom", endDate: "2026-03-31", startDate: "2026-03-01" },
				};
				const { page, drillRequests } = mountWorkouts(clock, selectionInput);
				const answered = new Set<string>();
				try {
					yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(4)));
					yield* answerInitial(page, answered, {
						trend: (text) =>
							text.includes("2026-01-29")
								? trendResponse([
										workoutPoint("2026-01-01T00:00:00.000Z", 3),
										workoutPoint("2026-02-01T00:00:00.000Z", 4),
									])
								: trendResponse([workoutPoint("2026-03-01T00:00:00.000Z", 2)]),
					});
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getByText("2026-01-29 – 2026-02-28")).toBeDefined()),
					);
					fireEvent.click(screen.getAllByText("View exact values")[0] ?? document.body);
					const trendTable = yield* Effect.promise(() =>
						screen.findByRole("table", { name: "Workouts by workout-start period exact values" }),
					);
					expect(within(trendTable).getAllByRole("row")).toHaveLength(4);
					expect(within(trendTable).getByText(/^4 workouts/)).toBeDefined();
					const priorBucket = within(trendTable).getAllByRole("button", {
						name: /View records: 2026-01-29 – 2026-02-28/,
					})[0];
					if (priorBucket === undefined) {
						throw new Error("Expected the previous-period exact value action");
					}
					fireEvent.click(priorBucket);
					expect(drillRequests.at(-1)).toEqual({
						periodCaption: "2026-01-29 – 2026-01-31",
						title: "Workouts starting in this bucket",
						selection: {
							grouping: "month",
							comparison: "none",
							range: { kind: "custom", endDate: "2026-01-31", startDate: "2026-01-29" },
						},
					});
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);

	it.live("clips consistency to the last 26 weeks of the selected period", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			yield* Effect.promise(() => clock.setTime(Date.parse("2026-12-31T18:00:00Z")));
			const allTime: AnalyticsScope["selection"] = {
				grouping: "auto",
				range: { kind: "all-time" },
				comparison: "previous-period",
			};
			const { page } = mountWorkouts(clock, allTime);
			const answered = new Set<string>();
			try {
				yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(3)));
				yield* answerInitial(page, answered, {
					trend: () => trendResponse([workoutPoint("2026-12-31T00:00:00.000Z", 2)]),
				});
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(
							screen.getByText("Showing the last 26 weeks of the selected period."),
						).toBeDefined(),
					),
				);
				expect(
					screen.getByRole("img", { name: /^Workout starts · 2026-07-03 – 2026-12-31$/ }),
				).toBeDefined();
				expect(page.queryRequests("workoutTrend")).toHaveLength(2);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live(
		"retries a failed hourly refresh without discarding its values or refetching other regions",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				yield* Effect.promise(() => clock.setTime(Date.parse("2026-03-01T12:00:00Z")));
				const { page } = mountWorkouts(clock, daySelection);
				const answered = new Set<string>();
				try {
					yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(3)));
					yield* answerInitial(page, answered, {
						trend: () => trendResponse([workoutPoint("2026-03-01T00:00:00.000Z", 2)]),
					});
					yield* Effect.promise(() =>
						waitFor(() => expect(screen.getByText("Workout starts")).toBeDefined()),
					);
					page.send({ type: "page-refresh" });
					yield* Effect.promise(() => clock.advance(0));
					yield* Effect.promise(() => clock.advance(250));
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("hours")).toHaveLength(2)),
					);
					for (const request of page.queryRequests()) {
						if (answered.has(request.requestId)) {
							continue;
						}
						answered.add(request.requestId);
						if ("hours" in request.document.queries) {
							page.replyQuery(request.requestId, { outcome: "failure", reason: "query-failed" });
						} else {
							page.replyQuery(request.requestId, {
								outcome: "success",
								response: trendResponse([workoutPoint("2026-03-01T00:00:00.000Z", 2)]),
							});
						}
					}
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByText(/Could not update hourly workout starts/)).toBeDefined(),
						),
					);
					expect(screen.getAllByText("2 workouts").length).toBeGreaterThan(0);
					fireEvent.click(screen.getByRole("button", { name: "Retry hourly workout starts" }));
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("hours")).toHaveLength(3)),
					);
					const retry = page.queryRequests("hours")[2];
					if (retry === undefined) {
						throw new Error("Expected an hourly retry request");
					}
					page.replyQuery(retry.requestId, { outcome: "success", response: hourResponse(7) });
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("workoutTrend")).toHaveLength(4)),
					);
					expect(screen.getAllByText("2 workouts").length).toBeGreaterThan(0);
					expect(page.queryRequests("hours")).toHaveLength(3);
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);
});
