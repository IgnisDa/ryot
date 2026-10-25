import { ReportingSelection } from "@ryot-app/contract/modules/analytics/reporting";
import { Effect, Schema } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { installAnalyticsContribution } from "~/fixtures/kernel/analytics-contributions";
import {
	analyticsSearch,
	analyticsSection,
	hasAnalyticsSelection,
} from "~/fixtures/kernel/analytics-location";
import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { listInstalledPlugins, updatePluginState } from "~/fixtures/kernel/plugins";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const analyticsFrame = (page: Playwright.Page) =>
	page.locator('main > div:not([aria-hidden="true"]) iframe');

const hasAnalyticsLocation = (
	url: URL,
	selection: ReportingSelection,
	search: Readonly<Record<string, string>>,
) => {
	const expected = analyticsSearch(selection, search);
	return (
		url.origin === getFrontendUrl() &&
		hasAnalyticsSelection(url, selection) &&
		url.searchParams.size === expected.size &&
		[...expected].every(([key, value]) => url.searchParams.get(key) === value)
	);
};

const expectReportingSelection = Effect.fn(function* (
	frame: Playwright.FrameLocator,
	selection: ReportingSelection,
) {
	expect(
		yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ReportingSelection))(
			yield* frame.getByTestId("analytics-selection").textContent(),
		),
	).toEqual(selection);
});

const createAccountWithoutContributors = Effect.fn(function* () {
	const account = yield* createAuthenticatedClient();
	for (const installation of yield* listInstalledPlugins(account.client)) {
		yield* updatePluginState(account.client, installation.installationId, { isHidden: true });
	}
	return account;
});

const expectEmptyAnalytics = Effect.fn(function* (page: Playwright.Page) {
	const frame = analyticsFrame(page);
	yield* frame
		.contentFrame()
		.getByRole("heading", { level: 1, exact: true, name: "Analytics" })
		.waitFor({ state: "visible" });
	yield* frame
		.contentFrame()
		.getByText("No collection reviews in this period.", { exact: true })
		.waitFor({ state: "visible" });
});

it.live(
	"opens kernel collection Analytics from global saved views and command-center keyboard search",
	() =>
		Effect.gen(function* () {
			const { email, password } = yield* createAccountWithoutContributors();
			const browser = yield* Playwright.Browser;
			const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
			yield* signInThroughHostedOAuth(page, email, password, { entryPath: "/v/k/calendar" });
			yield* page.waitForURL(`${getFrontendUrl()}/v/k/calendar`);

			const savedViews = page
				.getByTestId("desktop-sidebar")
				.locator("section")
				.filter({ hasText: "Saved Views" });
			const analytics = savedViews.getByRole("link", { exact: true, name: "Analytics" });
			yield* analytics.waitFor({ state: "visible" });
			expect(yield* analytics.getAttribute("href")).toBe("/v/k/analytics");
			yield* analytics.focus();
			yield* page.keyboard.press("Enter");
			yield* page.waitForURL(`${getFrontendUrl()}/v/k/analytics`);
			yield* expectEmptyAnalytics(page);

			const frame = analyticsFrame(page);
			expect(yield* frame.count).toBe(1);
			expect(yield* frame.getAttribute("src")).toBeNull();
			expect(yield* frame.getAttribute("srcdoc")).not.toBeNull();
			expect(yield* frame.getAttribute("sandbox")).toBe("allow-scripts");
			expect(
				yield* page.getByRole("heading", { level: 1, exact: true, name: "Analytics" }).count,
			).toBe(0);
			const realm = yield* frame
				.contentFrame()
				.locator("body")
				.evaluate(() => {
					let parentReadable = true;
					try {
						parent.document.querySelector("html");
					} catch {
						parentReadable = false;
					}
					return { parentReadable, origin: self.origin };
				});
			expect(realm).toEqual({ origin: "null", parentReadable: false });

			yield* savedViews.getByRole("link", { exact: true, name: "Calendar" }).click();
			yield* page.waitForURL(`${getFrontendUrl()}/v/k/calendar`);
			const calendar = analyticsFrame(page).contentFrame();
			yield* calendar.getByRole("heading", { level: 1, exact: true, name: "Calendar" }).waitFor();
			yield* calendar.locator("body").click();
			const modifier = yield* page.evaluate(() =>
				/Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control",
			);
			yield* page.keyboard.press(`${modifier}+K`);
			const commandCenter = page.getByRole("dialog", { name: "Command center" });
			yield* commandCenter.waitFor({ state: "visible" });
			const search = commandCenter.getByRole("combobox", { name: "Search commands" });
			yield* search.fill("Analytics");
			const result = commandCenter.getByRole("option", { exact: true, name: "Analytics" });
			yield* result.waitFor({ state: "visible" });
			yield* result.waitForFunction((option) => option.getAttribute("aria-selected") === "true");
			yield* page.keyboard.press("Enter");
			yield* commandCenter.waitFor({ state: "hidden" });
			yield* page.waitForURL(`${getFrontendUrl()}/v/k/analytics`);
			yield* expectEmptyAnalytics(page);
		}).pipe(PlaywrightSpawner.withBrowser),
);

it.live(
	"isolates private contributor failures, shares controls and Back, and explicitly reloads catalog changes",
	() =>
		Effect.gen(function* () {
			const { email, client, password } = yield* createAccountWithoutContributors();
			const installed = yield* installAnalyticsContribution(client);
			const browser = yield* Playwright.Browser;
			const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
			const activitySection = analyticsSection(installed.pluginId, "activity");
			const failureSection = analyticsSection(installed.pluginId, "failure");
			const search = new URLSearchParams({ section: activitySection });
			yield* signInThroughHostedOAuth(page, email, password, {
				entryPath: `/v/k/analytics?${search}`,
			});
			const frame = analyticsFrame(page).contentFrame();
			yield* frame.getByRole("heading", { exact: true, name: "activity-initial" }).waitFor();
			expect(yield* frame.getByTestId("analytics-owner").textContent()).toBe(installed.pluginId);
			expect(yield* frame.locator("html").getAttribute("data-mounted-failure")).toBeNull();
			yield* frame.getByRole("button", { exact: true, name: "Date range: Last 30 days" }).click();
			yield* frame.getByRole("radio", { exact: true, name: "Last 7 days" }).click();
			const sevenDaySelection: ReportingSelection = {
				grouping: "auto",
				comparison: "previous-period",
				range: { days: 7, kind: "rolling" },
			};
			yield* page.waitForURL((url) =>
				hasAnalyticsLocation(url, sevenDaySelection, { section: activitySection }),
			);
			yield* frame.getByRole("heading", { exact: true, name: "activity-initial" }).waitFor();
			yield* expectReportingSelection(frame, sevenDaySelection);
			yield* frame
				.getByRole("button", { exact: true, name: "Compare with: Previous period" })
				.click();
			yield* frame.getByRole("radio", { exact: true, name: "None" }).click();
			const unComparedSelection: ReportingSelection = { ...sevenDaySelection, comparison: "none" };
			yield* page.waitForURL((url) =>
				hasAnalyticsLocation(url, unComparedSelection, { section: activitySection }),
			);
			yield* frame.getByRole("heading", { exact: true, name: "activity-initial" }).waitFor();
			yield* expectReportingSelection(frame, unComparedSelection);
			yield* frame.getByRole("button", { exact: true, name: "Fixture failure" }).click();
			yield* page.waitForURL((url) =>
				hasAnalyticsLocation(url, unComparedSelection, { section: failureSection }),
			);
			yield* frame.getByText("Could not load this section.", { exact: true }).waitFor();
			expect(yield* frame.locator("html").getAttribute("data-mounted-activity-initial")).toBeNull();
			expect(
				yield* frame.getByRole("heading", { exact: true, name: "activity-initial" }).count,
			).toBe(0);
			yield* frame.getByRole("button", { exact: true, name: "Group by: Automatic" }).click();
			yield* frame.getByRole("radio", { exact: true, name: "Year" }).click();
			const yearSelection: ReportingSelection = { ...unComparedSelection, grouping: "year" };
			yield* page.waitForURL((url) =>
				hasAnalyticsLocation(url, yearSelection, { section: failureSection }),
			);
			yield* frame.getByRole("button", { exact: true, name: "Group by: Year" }).waitFor();
			yield* frame.getByText("Could not load this section.", { exact: true }).waitFor();
			yield* frame.getByRole("button", { exact: true, name: "Retry" }).click();
			yield* frame.getByRole("heading", { exact: true, name: "failure" }).waitFor();
			yield* expectReportingSelection(frame, yearSelection);
			expect(yield* frame.getByTestId("analytics-owner").textContent()).toBe(installed.pluginId);
			yield* frame.getByRole("button", { exact: true, name: "Fixture activity" }).click();
			yield* page.waitForURL((url) =>
				hasAnalyticsLocation(url, yearSelection, { section: activitySection }),
			);
			yield* frame.getByRole("heading", { exact: true, name: "activity-initial" }).waitFor();
			expect(yield* frame.getByRole("heading", { exact: true, name: "failure" }).count).toBe(0);
			yield* expectReportingSelection(frame, yearSelection);
			yield* page.goBack();
			yield* page.waitForURL((url) =>
				hasAnalyticsLocation(url, yearSelection, { section: failureSection }),
			);
			yield* frame.getByRole("heading", { exact: true, name: "failure" }).waitFor();
			yield* expectReportingSelection(frame, yearSelection);
			yield* page.goBack();
			yield* page.waitForURL((url) =>
				hasAnalyticsLocation(url, unComparedSelection, { section: failureSection }),
			);
			yield* frame.getByRole("button", { exact: true, name: "Group by: Automatic" }).waitFor();
			yield* frame.getByText("Could not load this section.", { exact: true }).waitFor();
			yield* updatePluginState(client, installed.installationId, { isHidden: true });
			const reload = page.getByRole("button", { exact: true, name: "Reload updated page" });
			yield* reload.waitFor();
			yield* reload.click();
			yield* expectEmptyAnalytics(page);
			expect(
				yield* analyticsFrame(page)
					.contentFrame()
					.getByRole("button", { exact: true, name: "Fixture activity" }).count,
			).toBe(0);
		}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("opens Analytics by touch in the drawer and restores its reporting URL with Back", () =>
	Effect.gen(function* () {
		const { email, password } = yield* createAccountWithoutContributors();
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ hasTouch: true, viewport: { width: 390, height: 844 } });
		yield* signInThroughHostedOAuth(page, email, password, { entryPath: "/v/k/analytics" });
		yield* page.waitForURL(`${getFrontendUrl()}/v/k/analytics`);
		yield* expectEmptyAnalytics(page);

		const drawer = page.getByRole("dialog", { name: "Navigation" });
		yield* analyticsFrame(page)
			.contentFrame()
			.getByRole("button", { name: "Open navigation" })
			.tap();
		yield* drawer.waitFor({ state: "visible" });
		const savedViews = drawer.locator("section").filter({ hasText: "Saved Views" });
		const analytics = savedViews.getByRole("link", { exact: true, name: "Analytics" });
		expect(yield* analytics.isVisible()).toBe(true);
		expect(yield* analytics.getAttribute("href")).toBe("/v/k/analytics");
		yield* savedViews.getByRole("link", { exact: true, name: "Calendar" }).tap();
		yield* drawer.waitFor({ state: "hidden" });
		yield* page.getByTestId("mobile-drawer").waitFor({ state: "hidden" });
		yield* page.waitForURL(`${getFrontendUrl()}/v/k/calendar`);
		yield* analyticsFrame(page)
			.contentFrame()
			.getByRole("heading", { level: 1, exact: true, name: "Calendar" })
			.waitFor({ state: "visible" });
		yield* analyticsFrame(page)
			.contentFrame()
			.getByRole("button", { name: "Open navigation" })
			.tap();
		yield* drawer.waitFor({ state: "visible" });
		yield* analytics.tap();
		yield* drawer.waitFor({ state: "hidden" });
		yield* page.getByTestId("mobile-drawer").waitFor({ state: "hidden" });
		yield* page.waitForURL(`${getFrontendUrl()}/v/k/analytics`);
		yield* expectEmptyAnalytics(page);

		const reportingSelection: ReportingSelection = {
			grouping: "week",
			comparison: "previous-period",
			range: { kind: "custom", endDate: "2026-09-30", startDate: "2026-09-01" },
		};
		const reportSearch = analyticsSearch(reportingSelection, { keep: "1" });
		const reportPath = `/v/k/analytics?${reportSearch}`;
		yield* page.goto(`${getFrontendUrl()}${reportPath}`);
		yield* page.waitForURL((url) => hasAnalyticsLocation(url, reportingSelection, { keep: "1" }));
		yield* expectEmptyAnalytics(page);
		const frame = analyticsFrame(page).contentFrame();
		const controls = frame.getByRole("region", { exact: true, name: "Analytics controls" });
		yield* controls
			.getByRole("button", { exact: true, name: "Date range: Custom dates" })
			.waitFor();
		yield* controls
			.getByRole("button", { exact: true, name: "Compare with: Previous period" })
			.waitFor();
		const grouping = controls.getByRole("button", { exact: true, name: "Group by: Week" });
		yield* grouping.waitFor({ state: "visible" });
		expect(yield* controls.getByLabel("Start date", { exact: true }).inputValue()).toBe(
			"2026-09-01",
		);
		expect(yield* controls.getByLabel("End date", { exact: true }).inputValue()).toBe("2026-09-30");

		yield* grouping.tap();
		yield* frame.getByRole("radio", { exact: true, name: "Month" }).tap();
		const monthSelection: ReportingSelection = { ...reportingSelection, grouping: "month" };
		yield* page.waitForURL((url) => hasAnalyticsLocation(url, monthSelection, { keep: "1" }));
		yield* expectEmptyAnalytics(page);
		yield* controls.getByRole("button", { exact: true, name: "Group by: Month" }).waitFor();

		yield* page.goBack();
		yield* page.waitForURL((url) => hasAnalyticsLocation(url, reportingSelection, { keep: "1" }));
		yield* expectEmptyAnalytics(page);
		yield* grouping.waitFor({ state: "visible" });
		yield* controls
			.getByRole("button", { exact: true, name: "Date range: Custom dates" })
			.waitFor();
		yield* controls
			.getByRole("button", { exact: true, name: "Compare with: Previous period" })
			.waitFor();
		expect(yield* controls.getByLabel("Start date", { exact: true }).inputValue()).toBe(
			"2026-09-01",
		);
		expect(yield* controls.getByLabel("End date", { exact: true }).inputValue()).toBe("2026-09-30");

		yield* page.reload;
		yield* page.waitForURL((url) => hasAnalyticsLocation(url, reportingSelection, { keep: "1" }));
		yield* expectEmptyAnalytics(page);
		yield* grouping.waitFor({ state: "visible" });
		yield* controls
			.getByRole("button", { exact: true, name: "Date range: Custom dates" })
			.waitFor();
		yield* controls
			.getByRole("button", { exact: true, name: "Compare with: Previous period" })
			.waitFor();
		expect(yield* controls.getByLabel("Start date", { exact: true }).inputValue()).toBe(
			"2026-09-01",
		);
		expect(yield* controls.getByLabel("End date", { exact: true }).inputValue()).toBe("2026-09-30");
	}).pipe(PlaywrightSpawner.withBrowser),
);
