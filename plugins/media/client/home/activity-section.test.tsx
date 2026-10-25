import { afterEach, describe, expect, it } from "@effect/vitest";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import { usePageRefreshRequest, useReportingPreferences } from "@ryot-app/plugin-client-sdk/react";
import type { RyotQueryResult } from "@ryot-app/plugin-client-sdk/react";
import {
	createTestRyotClock,
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import { getByRole, getByText, screen, waitFor } from "@testing-library/dom";

import type { MediaActivity } from "../../shared/activity-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	errorQueryResult,
	pendingQueryResult,
	readyQueryResult,
} from "../../tests/client/query-result-fixture";
import { clickRyotElement, mountRyotClient } from "../../tests/client/test-support";
import { type ActivityWindow, activityWindow } from "./activity-model";
import { ActivitySection, ActivitySectionView } from "./activity-section";

const TODAY = "2026-09-25";
const TIME_ZONE = TimeZone.make("America/New_York");
const noopAdapter = { query: () => Effect.succeed({}) };
type ActivityPage = ReturnType<typeof mountPluginPage>;
type ActivityRequest = ReturnType<ActivityPage["queryRequests"]>[number];
type ActivityResult = { readonly window: ActivityWindow; readonly activity: MediaActivity };

const aggregate = (items: readonly Record<string, JsonValue>[] = []) => ({
	items,
	type: "aggregate" as const,
});
const documentText = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const activityResponse = (input: {
	readonly pending?: number;
	readonly finished?: number;
	readonly activeDay?: string;
}) => ({
	data: {
		days: aggregate(),
		mediaTypes: aggregate(),
		dates: aggregate(input.activeDay === undefined ? [] : [{ events: 1, day: input.activeDay }]),
		figures: aggregate([
			{
				failed: 0,
				reviews: 0,
				minutes: 0,
				minutesMissing: 0,
				pending: input.pending ?? 0,
				finished: input.finished ?? 1,
			},
		]),
	},
});

function ActivityTestHarness() {
	const preferences = useReportingPreferences();
	const refresh = usePageRefreshRequest();
	return (
		<>
			<button type="button" onClick={refresh}>
				Refresh activity
			</button>
			<button type="button" onClick={preferences.refetch}>
				Refresh reporting preferences
			</button>
			<ActivitySection compact />
		</>
	);
}

const mountActivity = (clock: ReturnType<typeof createTestRyotClock>) =>
	mountPluginPage(ActivityTestHarness, {
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
			contributors: [
				pluginContributor({ name: "Media", pluginId: "media-owner", packageId: PLUGIN_PACKAGE_ID }),
			],
		},
	});

const reportingPreferenceRequests = (page: ActivityPage) =>
	page
		.clientMessages()
		.filter((message) => message.type === "reporting-preferences-request");

const activityRequests = (page: ActivityPage) =>
	page
		.queryRequests()
		.filter(({ document }) =>
			["dates", "days", "figures", "mediaTypes"].every((name) =>
				Object.hasOwn(document.queries, name),
			),
		);

const waitForRequest = <Request,>(requests: () => readonly Request[], index: number) =>
	waitFor(() => {
		expect(requests()).toHaveLength(index + 1);
		const request = requests()[index];
		if (request === undefined) {
			throw new Error("Expected a request at the requested index");
		}
		return request;
	});

const replyReportingPreferences = (
	page: ActivityPage,
	requestId: string,
	outcome: "failure" | "success",
	timeZone = TimeZone.make("America/New_York"),
) =>
	page.send(
		outcome === "success"
			? { outcome, requestId, preferences: { timeZone }, type: "reporting-preferences-result" }
			: { outcome, requestId, reason: "transport", type: "reporting-preferences-result" },
	);

const replyActivity = (
	page: ActivityPage,
	request: ActivityRequest,
	input: {
		readonly pending?: number;
		readonly finished?: number;
		readonly activeDay?: string;
	} = {},
) => page.replyQuery(request.requestId, { outcome: "success", response: activityResponse(input) });

const activity: MediaActivity = {
	processing: "ready",
	figures: { reviews: 7, minutes: 5430, finished: 1204, minutesMissing: 0 },
	mediaTypes: [
		{ events: 995, slug: "show", label: "Show" },
		{ events: 5, slug: "book", label: "Book" },
	],
	days: [
		{ events: 1, day: "2026-09-21" },
		{ events: 4, day: "2026-09-23" },
		{ events: 2, day: "2026-09-24" },
		{ events: 1, day: "2026-09-25" },
	],
};

const activityResult = (value: MediaActivity): ActivityResult => ({
	activity: value,
	window: activityWindow(TODAY, TIME_ZONE),
});

const mount = (result: RyotQueryResult<ActivityResult>) =>
	mountRyotClient(noopAdapter, <ActivitySectionView compact result={result} />);

afterEach(() => {
	disposePluginBridges();
	document.body.innerHTML = "";
});

describe("ActivitySectionView", () => {
	it("marks incomplete duration as a lower bound", () => {
		const view = mount(
			readyQueryResult(
				activityResult({
					...activity,
					figures: { ...activity.figures, minutes: 119, minutesMissing: 1 },
				}),
			),
		);
		expect(getByText(view.container, "Hours").nextElementSibling?.textContent).toBe("≥1");
		view.unmount();
	});
	it("shows repair state before displaying consumption figures", () => {
		const view = mount(readyQueryResult(activityResult({ ...activity, processing: "pending" })));
		expect(getByText(view.container, "Updating consumption…")).toBeDefined();
		expect(view.container.textContent).not.toContain("1,204");
		view.unmount();
	});
	it("shows a loading placeholder while the first result is pending", () => {
		const view = mount(pendingQueryResult<ActivityResult>());

		expect(getByRole(view.container, "status", { name: "Loading Your activity" })).toBeDefined();
		expect(view.container.querySelector("svg")).toBeNull();
		view.unmount();
	});

	it("retries the query from the error state", () => {
		let retries = 0;
		const view = mount({
			...errorQueryResult<ActivityResult>(new RyotClientError({ reason: "transport" })),
			refetch: () => {
				retries += 1;
			},
		});

		clickRyotElement(
			getByRole(getByRole(view.container, "alert"), "button", { name: "Try again" }),
		);

		expect(retries).toBe(1);
		view.unmount();
	});

	it("keeps showing the last activity when a refresh fails", () => {
		const view = mount(
			errorQueryResult(new RyotClientError({ reason: "transport" }), activityResult(activity)),
		);

		expect(getByRole(view.container, "alert").textContent).toContain("could not be refreshed");
		expect(getByText(view.container, "Finished")).toBeDefined();
		view.unmount();
	});

	it("renders the figures, a padded heatmap in the local time zone, and the type shares", () => {
		const view = mount(readyQueryResult(activityResult(activity)));
		const figure = (label: string) =>
			getByText(view.container, label).nextElementSibling?.textContent;

		expect(figure("Finished")).toBe("1,204");
		expect(figure("Hours")).toBe("91");
		expect(figure("Reviews")).toBe("7");
		expect(figure("Day streak")).toBe("3");

		const cells = view.container.querySelectorAll(".ts-chart__rect rect");
		expect(cells).toHaveLength(52 * 7 - 2);
		const fill = (date: string) =>
			view.container
				.querySelector(`.ts-chart__rect rect[data-ts-key$=":${date}"]`)
				?.getAttribute("fill");
		expect(fill("2026-09-23")).toBe("var(--chart-seq-5)");
		expect(fill("2026-09-22")).toBe("var(--chart-seq-0)");

		const bars = [...view.container.querySelectorAll("ol > li")].map((row) => row.textContent);
		expect(bars).toEqual(["Show100%", "Book<1%"]);
		view.unmount();
	});
});

describe("ActivitySection reporting window", () => {
	it.live("keeps the repair mask and polls pending activity until it settles", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountActivity(clock);
			try {
				const preference = yield* Effect.promise(() =>
					waitForRequest(() => reportingPreferenceRequests(page), 0),
				);
				replyReportingPreferences(page, preference.requestId, "success");
				const initial = yield* Effect.promise(() =>
					waitForRequest(() => activityRequests(page), 0),
				);
				replyActivity(page, initial, { pending: 1, finished: 99 });
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("Updating consumption…")).toBeDefined()),
				);
				expect(page.container?.textContent).not.toContain("99");
				yield* Effect.promise(() => clock.advance("1 second"));
				const poll = yield* Effect.promise(() => waitForRequest(() => activityRequests(page), 1));
				replyActivity(page, poll, { finished: 8 });
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByText("Finished").nextElementSibling?.textContent).toBe("8"),
					),
				);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("uses the account time zone at UTC date boundaries and links to kernel analytics", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-01T03:30:00.000Z")));
			const page = mountActivity(clock);
			try {
				const preference = yield* Effect.promise(() =>
					waitForRequest(() => reportingPreferenceRequests(page), 0),
				);
				replyReportingPreferences(page, preference.requestId, "success");
				const request = yield* Effect.promise(() =>
					waitForRequest(() => activityRequests(page), 0),
				);
				const document = yield* documentText(request.document);
				const window = activityWindow("2026-10-31", TIME_ZONE);
				expect(document).toContain(window.from);
				expect(document).toContain(window.until);
				replyActivity(page, request, { finished: 3, activeDay: "2026-10-31" });
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByText("Finished").nextElementSibling?.textContent).toBe("3"),
					),
				);
				expect(screen.getByText("Day streak").nextElementSibling?.textContent).toBe("1");
				expect(
					page.container?.querySelector('.ts-chart__rect rect[data-ts-key$=":2026-10-31"]'),
				).not.toBeNull();
				expect(
					page.container?.querySelector('.ts-chart__rect rect[data-ts-key$=":2026-11-01"]'),
				).toBeNull();

				clickRyotElement(screen.getByRole("link", { name: "Analytics" }));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(
							page
								.clientMessages()
								.some(
									(message) =>
										message.type === "navigate" &&
										message.target.kind === "saved-view" &&
										message.target.reference.kind === "kernel" &&
										message.target.reference.slug === "analytics",
								),
						).toBe(true),
					),
				);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live(
		"refreshes a stable zone selection from the current clock and advances its local date",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				yield* Effect.promise(() => clock.setTime(Date.parse("2026-09-25T20:00:00.000Z")));
				const page = mountActivity(clock);
				try {
					const preference = yield* Effect.promise(() =>
						waitForRequest(() => reportingPreferenceRequests(page), 0),
					);
					replyReportingPreferences(page, preference.requestId, "success");
					const first = yield* Effect.promise(() =>
						waitForRequest(() => activityRequests(page), 0),
					);
					replyActivity(page, first, { finished: 1, activeDay: "2026-09-25" });
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByText("Finished").nextElementSibling?.textContent).toBe("1"),
						),
					);

					yield* Effect.promise(() => clock.advance("1 hour"));
					clickRyotElement(screen.getByRole("button", { name: "Refresh activity" }));
					yield* Effect.promise(() => clock.advance(250));
					const sameDay = yield* Effect.promise(() =>
						waitForRequest(() => activityRequests(page), 1),
					);
					expect(yield* documentText(sameDay.document)).toBe(yield* documentText(first.document));
					replyActivity(page, sameDay, { finished: 2, activeDay: "2026-09-25" });
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByText("Finished").nextElementSibling?.textContent).toBe("2"),
						),
					);

					yield* Effect.promise(() => clock.advance("7 hours"));
					const nextDay = yield* Effect.promise(() =>
						waitForRequest(() => activityRequests(page), 2),
					);
					const nextWindow = activityWindow("2026-09-26", TIME_ZONE);
					const nextDocument = yield* documentText(nextDay.document);
					expect(nextDocument).toContain(nextWindow.from);
					expect(nextDocument).toContain(nextWindow.until);
					replyActivity(page, nextDay, { finished: 3, activeDay: "2026-09-26" });
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByText("Finished").nextElementSibling?.textContent).toBe("3"),
						),
					);
					expect(screen.getByText("Day streak").nextElementSibling?.textContent).toBe("1");
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);

	for (const sample of [
		{ hours: 23, start: "2026-03-08T05:00:00.000Z" },
		{ hours: 25, start: "2026-11-01T04:00:00.000Z" },
	]) {
		it.live(`schedules account midnight after ${sample.hours} elapsed hours`, () =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				yield* Effect.promise(() => clock.setTime(Date.parse(sample.start)));
				const page = mountActivity(clock);
				try {
					const preference = yield* Effect.promise(() =>
						waitForRequest(() => reportingPreferenceRequests(page), 0),
					);
					replyReportingPreferences(page, preference.requestId, "success");
					const first = yield* Effect.promise(() =>
						waitForRequest(() => activityRequests(page), 0),
					);
					replyActivity(page, first);
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByText("Finished").nextElementSibling?.textContent).toBe("1"),
						),
					);

					yield* Effect.promise(() => clock.advance(`${sample.hours - 1} hours`));
					expect(activityRequests(page)).toHaveLength(1);
					yield* Effect.promise(() => clock.advance("1 hour"));
					const refreshed = yield* Effect.promise(() =>
						waitForRequest(() => activityRequests(page), 1),
					);
					const expectedToday = sample.hours === 23 ? "2026-03-09" : "2026-11-02";
					const expectedWindow = activityWindow(expectedToday, TIME_ZONE);
					const document = yield* documentText(refreshed.document);
					expect(document).toContain(expectedWindow.from);
					expect(document).toContain(expectedWindow.until);
					replyActivity(page, refreshed, { finished: 2, activeDay: expectedToday });
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(screen.getByText("Finished").nextElementSibling?.textContent).toBe("2"),
						),
					);
				} finally {
					page.dispose();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
		);
	}

	it.live("retries initial and retained failures without dropping loaded activity", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const page = mountActivity(clock);
			try {
				const firstPreference = yield* Effect.promise(() =>
					waitForRequest(() => reportingPreferenceRequests(page), 0),
				);
				expect(screen.getByRole("status", { name: "Loading Your activity" })).toBeDefined();
				replyReportingPreferences(page, firstPreference.requestId, "failure");
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Unable to load")),
				);
				expect(activityRequests(page)).toHaveLength(0);
				clickRyotElement(screen.getByRole("button", { name: "Try again" }));
				const preferenceRetry = yield* Effect.promise(() =>
					waitForRequest(() => reportingPreferenceRequests(page), 1),
				);
				replyReportingPreferences(page, preferenceRetry.requestId, "success");
				const firstActivity = yield* Effect.promise(() =>
					waitForRequest(() => activityRequests(page), 0),
				);
				replyActivity(page, firstActivity, { finished: 10 });
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByText("Finished").nextElementSibling?.textContent).toBe("10"),
					),
				);

				clickRyotElement(screen.getByRole("button", { name: "Refresh reporting preferences" }));
				const preferenceRefresh = yield* Effect.promise(() =>
					waitForRequest(() => reportingPreferenceRequests(page), 2),
				);
				replyReportingPreferences(page, preferenceRefresh.requestId, "failure");
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByText(/last loaded time zone is being used/)).toBeDefined(),
					),
				);
				expect(screen.getByText("Finished").nextElementSibling?.textContent).toBe("10");
				clickRyotElement(screen.getByRole("button", { name: "Retry preferences" }));
				const retainedPreferenceRetry = yield* Effect.promise(() =>
					waitForRequest(() => reportingPreferenceRequests(page), 3),
				);
				replyReportingPreferences(page, retainedPreferenceRetry.requestId, "success");

				clickRyotElement(screen.getByRole("button", { name: "Refresh activity" }));
				yield* Effect.promise(() => clock.advance(250));
				const activityRefresh = yield* Effect.promise(() =>
					waitForRequest(() => activityRequests(page), 1),
				);
				page.replyQuery(activityRefresh.requestId, { outcome: "failure", reason: "query-failed" });
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByText(/Your activity could not be refreshed/)).toBeDefined(),
					),
				);
				expect(screen.getByText("Finished").nextElementSibling?.textContent).toBe("10");
				const activityAlert = screen
					.getAllByRole("alert")
					.find((element) => element.textContent.includes("Your activity could not be refreshed"));
				if (activityAlert === undefined) {
					throw new Error("Expected the activity refresh failure notice");
				}
				const activityNotice = activityAlert.parentElement;
				if (activityNotice === null) {
					throw new Error("Expected the activity refresh failure notice container");
				}
				clickRyotElement(getByRole(activityNotice, "button", { name: "Try again" }));
				const activityRetry = yield* Effect.promise(() =>
					waitForRequest(() => activityRequests(page), 2),
				);
				replyActivity(page, activityRetry, { finished: 11 });
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByText("Finished").nextElementSibling?.textContent).toBe("11"),
					),
				);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("uses a changed reporting zone and ignores a late result for the previous zone", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			yield* Effect.promise(() => clock.setTime(Date.parse("2026-01-01T01:00:00.000Z")));
			const page = mountActivity(clock);
			try {
				const preference = yield* Effect.promise(() =>
					waitForRequest(() => reportingPreferenceRequests(page), 0),
				);
				replyReportingPreferences(page, preference.requestId, "success", TimeZone.make("UTC"));
				const oldZoneRequest = yield* Effect.promise(() =>
					waitForRequest(() => activityRequests(page), 0),
				);

				clickRyotElement(screen.getByRole("button", { name: "Refresh reporting preferences" }));
				const changedPreference = yield* Effect.promise(() =>
					waitForRequest(() => reportingPreferenceRequests(page), 1),
				);
				replyReportingPreferences(page, changedPreference.requestId, "success", TIME_ZONE);
				const newZoneRequest = yield* Effect.promise(() =>
					waitForRequest(() => activityRequests(page), 1),
				);
				const expected = activityWindow("2025-12-31", TIME_ZONE);
				const newDocument = yield* documentText(newZoneRequest.document);
				expect(newDocument).toContain(expected.from);
				expect(newDocument).toContain(expected.until);
				replyActivity(page, newZoneRequest, { finished: 2, activeDay: "2025-12-31" });
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByText("Finished").nextElementSibling?.textContent).toBe("2"),
					),
				);

				replyActivity(page, oldZoneRequest, { finished: 99, activeDay: "2026-01-01" });
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("Finished")).toBeDefined()),
				);
				expect(screen.getByText("Finished").nextElementSibling?.textContent).toBe("2");
				expect(page.container?.textContent).not.toContain("99");
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("cancels the account-midnight refetch when the section unmounts", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			yield* Effect.promise(() => clock.setTime(Date.parse("2026-03-08T05:00:00.000Z")));
			const page = mountActivity(clock);
			let disposed = false;
			try {
				const preference = yield* Effect.promise(() =>
					waitForRequest(() => reportingPreferenceRequests(page), 0),
				);
				replyReportingPreferences(page, preference.requestId, "success");
				const request = yield* Effect.promise(() =>
					waitForRequest(() => activityRequests(page), 0),
				);
				replyActivity(page, request);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByText("Finished").nextElementSibling?.textContent).toBe("1"),
					),
				);
				page.dispose();
				disposed = true;
				yield* Effect.promise(() => clock.advance("1 day"));
				expect(activityRequests(page)).toHaveLength(1);
			} finally {
				if (!disposed) {
					page.dispose();
				}
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);
});
