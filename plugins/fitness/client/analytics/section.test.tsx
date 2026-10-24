import { afterEach, assert, describe, expect, it } from "@effect/vitest";
import type { JsonValue } from "@ryot-app/contract/schema/json";
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
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { act, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import FitnessAnalyticsSection from "./section";

afterEach(disposePluginBridges);

const preferences = {
	dropRestTime: 0,
	warmUpRestTime: 0,
	muteSounds: false,
	normalRestTime: 60,
	failureRestTime: 0,
	energyUnit: "kcal",
	unitSystem: "metric",
	promptForRestTimer: false,
	startTimerForDurationExercises: true,
} as const;

const scopeFor = (pluginId = "fitness-owner"): AnalyticsSectionProps => ({
	timeZone: "UTC",
	owner: { kind: "local", pluginId: PluginId.make(pluginId) },
	selection: { grouping: "day", comparison: "none", range: { days: 7, kind: "rolling" } },
});

function AnalyticsHost() {
	const [scope, setScope] = useState(scopeFor());
	return (
		<>
			<h1>Fitness</h1>
			<button
				type="button"
				onClick={() =>
					setScope((current) => ({
						...current,
						timeZone: "America/Los_Angeles",
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
			<button type="button" onClick={() => setScope(scopeFor("fitness-other"))}>
				Change owner
			</button>
			<FitnessAnalyticsSection {...scope} />
		</>
	);
}

const mountSection = (clock: ReturnType<typeof createTestRyotClock>) =>
	mountPluginPage(AnalyticsHost, {
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
			contributors: ["fitness-owner", "fitness-other"].map((pluginId) =>
				pluginContributor({ pluginId, name: "Fitness", packageId: PLUGIN_PACKAGE_ID }),
			),
		},
	});

const userSettingsRequests = (page: ReturnType<typeof mountSection>) =>
	page
		.clientMessages()
		.filter((message) => message.type === "user-settings-request" && "pluginId" in message);

const waitForSettingsRequest = (page: ReturnType<typeof mountSection>, index = 0) =>
	waitFor(() => {
		expect(userSettingsRequests(page)).toHaveLength(index + 1);
		const request = userSettingsRequests(page)[index];
		assert(request);
		return request;
	});

const replySettings = (
	page: ReturnType<typeof mountSection>,
	requestId: string,
	settings: Record<string, JsonValue>,
) => page.send({ settings, requestId, outcome: "success", type: "user-settings-result" });

const replyFailure = (page: ReturnType<typeof mountSection>, requestId: string) =>
	page.send({ requestId, outcome: "failure", reason: "transport", type: "user-settings-result" });

const queryText = (request: ReturnType<ReturnType<typeof mountSection>["queryRequests"]>[number]) =>
	JSON.stringify(request.document);

const standaloneQueries = (page: ReturnType<typeof mountSection>, queryKey: string) =>
	page
		.queryRequests(queryKey)
		.filter((request) => Object.keys(request.document.queries).length === 1);

const waitForTrendRequest = (page: ReturnType<typeof mountSection>, index: number) =>
	waitFor(() => {
		const request = page.queryRequests("trend")[index];
		assert(request);
		return request;
	});

const targetRankingResponse = {
	data: {
		ranking: {
			type: "rows" as const,
			pageInfo: { limit: 100, hasMore: false, nextCursor: null },
			items: [
				{
					sets: 3,
					workouts: 1,
					evidenceSets: 3,
					weightedSets: 2,
					id: "target-back",
					name: "Upper back",
					exerciseOccurrences: 2,
				},
			],
		},
	},
};

describe("fitness analytics section", () => {
	it.live(
		"loads the exact owner's settings before analytics and lazily mounts accessible tabs",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				const page = mountSection(clock);
				try {
					const settingsRequest = yield* Effect.promise(() => waitForSettingsRequest(page));
					expect(settingsRequest.pluginId).toBe("fitness-owner");
					expect(screen.getByRole("status").textContent).toContain(
						"Loading fitness display preferences",
					);
					expect(page.queryRequests()).toHaveLength(0);

					replySettings(page, settingsRequest.requestId, preferences);
					yield* Effect.promise(() =>
						waitFor(() => expect(page.queryRequests("trend").length).toBeGreaterThan(0)),
					);
					expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
					expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Fitness");
					expect(screen.getByRole("tab", { name: "Workouts" }).getAttribute("aria-selected")).toBe(
						"true",
					);
					const panel = screen.getByRole("tabpanel");
					const activeTab = screen.getByRole("tab", { name: "Workouts" });
					expect(panel.getAttribute("aria-labelledby")).toBe(activeTab.id);
					expect(page.queryRequests("ranking")).toHaveLength(0);
					expect(standaloneQueries(page, "readings")).toHaveLength(0);
					expect(standaloneQueries(page, "metrics")).toHaveLength(0);

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
					expect(standaloneQueries(page, "readings")).toHaveLength(0);
					expect(standaloneQueries(page, "metrics")).toHaveLength(0);

					act(() => {
						fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
					});
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(
								screen.getByRole("tab", { name: "Measurements" }).getAttribute("aria-selected"),
							).toBe("true"),
						),
					);
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByRole("button", { name: "Choose a metric" })).toBeDefined(),
						),
					);
					expect(standaloneQueries(page, "readings")).toHaveLength(0);
					const rankingRequest = page.queryRequests("ranking")[0];
					assert(rankingRequest);
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(
								page
									.clientMessages()
									.filter(
										(message) =>
											message.type === "ryotql-cancel" &&
											message.requestId === rankingRequest.requestId,
									),
							).toHaveLength(1),
						),
					);
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);

	it.live("retries initial settings failure and blocks query mounting for malformed settings", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountSection(clock);
			try {
				const first = yield* Effect.promise(() => waitForSettingsRequest(page));
				replyFailure(page, first.requestId);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("alert").textContent).toContain("could not be loaded"),
					),
				);
				expect(page.queryRequests()).toHaveLength(0);

				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "Retry preferences" }));
				});
				const retry = yield* Effect.promise(() => waitForSettingsRequest(page, 1));
				replySettings(page, retry.requestId, { ...preferences, unitSystem: "unknown" });
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByRole("alert").textContent).toContain("are invalid")),
				);
				expect(page.queryRequests()).toHaveLength(0);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("preserves the selected tab across scope changes and resets it on owner change", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountSection(clock);
			try {
				const firstSettings = yield* Effect.promise(() => waitForSettingsRequest(page));
				replySettings(page, firstSettings.requestId, preferences);
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("trend").length).toBeGreaterThan(0)),
				);
				const initialTrendCount = page.queryRequests("trend").length;
				const firstTrendRequest = yield* Effect.promise(() => waitForTrendRequest(page, 0));

				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "Change reporting scope" }));
				});
				const nextTrendRequest = yield* Effect.promise(() =>
					waitForTrendRequest(page, initialTrendCount),
				);
				expect(queryText(nextTrendRequest)).not.toBe(queryText(firstTrendRequest));
				expect(screen.getByRole("tab", { name: "Workouts" }).getAttribute("aria-selected")).toBe(
					"true",
				);

				act(() => {
					fireEvent.click(screen.getByRole("tab", { name: "Rankings" }));
				});
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(
							screen.getByRole("tab", { name: "Rankings" }).getAttribute("aria-selected"),
						).toBe("true"),
					),
				);
				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "Change owner" }));
				});
				const secondSettings = yield* Effect.promise(() => waitForSettingsRequest(page, 1));
				expect(secondSettings.pluginId).toBe("fitness-other");
				replySettings(page, secondSettings.requestId, preferences);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(
							screen.getByRole("tab", { name: "Workouts" }).getAttribute("aria-selected"),
						).toBe("true"),
					),
				);
				yield* Effect.promise(() =>
					waitFor(() => {
						const requests = page.queryRequests("trend");
						const latest = requests.at(-1);
						assert(latest);
						expect(queryText(latest)).toContain("fitness-other");
					}),
				);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("closes an open drill when its reporting scope changes and ignores its late reply", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountSection(clock);
			try {
				const settingsRequest = yield* Effect.promise(() => waitForSettingsRequest(page));
				replySettings(page, settingsRequest.requestId, preferences);
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByRole("tablist")).toBeDefined()),
				);
				act(() => {
					fireEvent.click(screen.getByRole("tab", { name: "Rankings" }));
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("ranking")).toHaveLength(1)),
				);
				const rankingRequest = page.queryRequests("ranking")[0];
				assert(rankingRequest);
				page.replyQuery(rankingRequest.requestId, {
					outcome: "success",
					response: targetRankingResponse,
				});
				const triggerName = "View workouts contributing to Upper back";
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByRole("button", { name: triggerName })).toBeDefined()),
				);
				act(() => {
					fireEvent.click(screen.getByRole("button", { name: triggerName }));
				});
				const drillRequest = yield* Effect.promise(() =>
					waitFor(() => {
						const request = page
							.queryRequests("workouts")
							.find((item) => queryText(item).includes("target-back"));
						assert(request);
						return request;
					}),
				);
				expect(screen.getByRole("dialog", { name: /Upper back/ })).toBeDefined();

				act(() => {
					fireEvent.click(screen.getByRole("button", { name: "Change reporting scope" }));
				});
				yield* Effect.promise(() => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(
							page
								.clientMessages()
								.filter(
									(message) =>
										message.type === "ryotql-cancel" &&
										message.requestId === drillRequest.requestId,
								),
						).toHaveLength(1),
					),
				);
				page.replyQuery(drillRequest.requestId, {
					outcome: "success",
					response: {
						data: {
							workouts: {
								type: "rows",
								pageInfo: { limit: 100, hasMore: false, nextCursor: null },
								items: [
									{
										activeDuration: null,
										id: "late-drill-workout",
										name: "Late drill workout",
										startedAt: "2026-01-01T00:00:00.000Z",
									},
								],
							},
						},
					},
				});
				yield* waitForMessagePortMacrotask;
				expect(screen.queryByRole("dialog")).toBeNull();
				expect(screen.queryByText("Late drill workout")).toBeNull();
				expect(
					page
						.queryRequests("workouts")
						.filter((request) => queryText(request).includes("target-back")),
				).toHaveLength(1);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);
});
