import type { ReportingSelection } from "@ryot-app/contract/modules/analytics/reporting";
import { Effect, Option } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	analyticsSearch,
	analyticsSection,
	hasAnalyticsLocation,
} from "~/fixtures/kernel/analytics-location";
import { createFitnessAnalyticsFixture } from "~/fixtures/plugins/fitness/analytics";
import {
	activePluginIframe,
	chartVisualCases,
	colorSchemes,
	desktopViewport,
	periodRow,
	signInThroughHostedOAuth,
	termDefinition,
} from "~/support/browser";
import { expect, it } from "~/support/effect-test";

const currentWorkoutRows: ReadonlyArray<{ readonly date: string; readonly value: string }> = [
	{ date: "Sep 2, 2026", value: "1 workouts" },
	{ date: "Sep 4, 2026", value: "1 workouts" },
	{ date: "Sep 3, 2026", value: "0 workouts · No activity" },
	{ date: "Sep 5, 2026", value: "0 workouts · No activity" },
	{ date: "Sep 6, 2026", value: "0 workouts · No activity" },
];
const volumeWorkoutRows: ReadonlyArray<{ readonly date: string; readonly value: string }> = [
	{ date: "Sep 2, 2026", value: "200 kg × reps" },
	{ date: "Sep 4, 2026", value: "150 kg × reps" },
];
const hourRows: ReadonlyArray<{ readonly hour: string; readonly detail: string }> = [
	{ hour: "10:00–11:00", detail: "1 workouts · 1 workout starts in reporting hour 10" },
	{ hour: "18:00–19:00", detail: "1 workouts · 1 workout starts in reporting hour 18" },
];

it.live("smokes Fitness analytics summary and workout charts across viewports", () =>
	Effect.gen(function* () {
		const fixture = yield* createFitnessAnalyticsFixture();
		const section = analyticsSection(fixture.reference.pluginId, "fitness");
		const search = analyticsSearch(fixture.reportingSelection, { section });
		const entryPath = `/v/k/analytics?${search}`;
		const browser = yield* Playwright.Browser;
		const context = yield* browser.newContext({
			hasTouch: true,
			viewport: desktopViewport,
			timezoneId: "America/New_York",
		});
		const page = yield* context.newPage;
		const frameElement = activePluginIframe(page);

		yield* signInThroughHostedOAuth(page, fixture.account.email, fixture.account.password, {
			entryPath,
		});
		yield* page.waitForURL((url) => hasAnalyticsLocation(url, fixture.reportingSelection, section));
		expect(yield* page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
			"America/New_York",
		);

		const frame = frameElement.contentFrame();
		yield* frame
			.getByRole("heading", { level: 1, exact: true, name: "Analytics" })
			.waitFor({ state: "visible" });
		expect(yield* frameElement.count).toBe(1);
		expect(yield* frameElement.getAttribute("src")).toBeNull();
		expect(yield* frameElement.getAttribute("srcdoc")).not.toBeNull();
		expect(yield* frameElement.getAttribute("sandbox")).toBe("allow-scripts");
		expect(
			yield* frame.getByRole("heading", { level: 1, exact: true, name: "Analytics" }).count,
		).toBe(1);
		expect(
			yield* page.getByRole("heading", { level: 1, exact: true, name: "Analytics" }).count,
		).toBe(0);

		const summary = frame.getByRole("region", { exact: true, name: "Fitness analytics summary" });
		yield* summary.waitFor({ state: "visible" });
		expect(yield* termDefinition(summary, "Workouts").innerText()).toBe(
			`${fixture.expectedSourceValues.workouts} workouts`,
		);
		expect(yield* termDefinition(summary, "Sets").innerText()).toBe(
			`${fixture.expectedSourceValues.sets} sets`,
		);
		expect(yield* termDefinition(summary, "Recorded active duration").innerText()).toBe(
			`${fixture.expectedSourceValues.activeDuration} seconds`,
		);
		expect(yield* termDefinition(summary, "Weight volume").innerText()).toBe(
			`${fixture.expectedSourceValues.volume} kg × reps`,
		);
		expect(yield* termDefinition(summary, "Planned rest").innerText()).toBe(
			`${fixture.expectedSourceValues.plannedRest} seconds`,
		);
		expect(yield* frame.getByText("Reporting time zone: UTC", { exact: true }).count).toBe(1);
		const initialSummary = yield* summary.innerText();
		expect(initialSummary).toContain(
			"2026-09-01 – 2026-09-07 vs 2026-08-25 – 2026-08-31 · New activity",
		);
		expect(initialSummary).not.toContain("Infinity");

		const workoutsTab = frame.getByRole("tab", { exact: true, name: "Workouts" });
		expect(yield* workoutsTab.getAttribute("aria-selected")).toBe("true");
		const panelId = yield* workoutsTab.getAttribute("aria-controls");
		expect(panelId).not.toBeNull();
		const tabPanel = frame.getByRole("tabpanel");
		expect(yield* tabPanel.count).toBe(1);
		expect(yield* tabPanel.getAttribute("id")).toBe(panelId);
		expect(yield* tabPanel.getAttribute("aria-labelledby")).toBe(
			yield* workoutsTab.getAttribute("id"),
		);

		const trendHeading = frame.getByRole("heading", {
			level: 2,
			exact: true,
			name: "Workout trend",
		});
		const trendChart = frame.getByRole("img", {
			exact: true,
			name: "Workouts by workout-start period",
		});
		const hourChart = frame.getByRole("img", {
			exact: true,
			name: "Workout starts by reporting hour",
		});
		yield* trendHeading.waitFor({ state: "visible" });
		yield* trendChart.waitFor({ state: "visible" });
		yield* hourChart.waitFor({ state: "visible" });

		for (const visualCase of chartVisualCases) {
			yield* page.setViewportSize(visualCase.viewport);
			for (const colorScheme of colorSchemes) {
				yield* page.use((nativePage) =>
					nativePage.emulateMedia({ colorScheme, reducedMotion: "reduce" }),
				);
				yield* trendChart.waitFor({ state: "visible" });
				yield* hourChart.waitFor({ state: "visible" });
				yield* trendChart.waitForFunction(
					(image, height) => image.getBoundingClientRect().height === height,
					visualCase.chartHeight,
				);
				yield* hourChart.waitForFunction(
					(image, height) => image.getBoundingClientRect().height === height,
					visualCase.chartHeight,
				);
				const media = yield* frame.locator("body").evaluate((body) => {
					const view = body.ownerDocument.defaultView;
					return {
						dark: view?.matchMedia("(prefers-color-scheme: dark)").matches,
						reduced: view?.matchMedia("(prefers-reduced-motion: reduce)").matches,
					};
				});
				expect(media).toEqual({ reduced: true, dark: colorScheme === "dark" });
				const trendBounds = Option.getOrThrowWith(
					yield* trendChart.boundingBox(),
					() => new Error("Expected the workout trend chart bounds"),
				);
				const hourBounds = Option.getOrThrowWith(
					yield* hourChart.boundingBox(),
					() => new Error("Expected the workout hour chart bounds"),
				);
				expect(trendBounds.height).toBe(visualCase.chartHeight);
				expect(hourBounds.height).toBe(visualCase.chartHeight);
				const hostFits = yield* page.evaluate(
					() => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
				);
				const iframeFits = yield* frame
					.locator("html")
					.evaluate(
						(documentElement) => documentElement.scrollWidth <= documentElement.clientWidth,
					);
				expect(hostFits).toBe(true);
				expect(iframeFits).toBe(true);
			}
		}

		yield* page.setViewportSize(desktopViewport);
		yield* page.use((nativePage) =>
			nativePage.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" }),
		);
		yield* trendChart.waitFor({ state: "visible" });
		yield* hourChart.waitFor({ state: "visible" });
		expect(yield* termDefinition(summary, "Weight volume").innerText()).toBe(
			`${fixture.expectedSourceValues.volume} kg × reps`,
		);

		const viewExactValues = frame.getByText("View exact values", { exact: true });
		yield* viewExactValues.first().click();
		const workoutTable = frame.getByRole("table", {
			exact: true,
			name: "Workouts by workout-start period exact values",
		});
		yield* workoutTable.waitForFunction((table) => table.querySelectorAll("tr").length === 15);
		expect(yield* workoutTable.getByRole("row").count).toBe(15);
		const currentRange = "2026-09-01 – 2026-09-07";
		const previousRange = "2026-08-25 – 2026-08-31";
		for (const { date, value } of currentWorkoutRows) {
			const row = periodRow(workoutTable, currentRange, date);
			expect(yield* row.count).toBe(1);
			expect(yield* row.getByRole("cell").nth(0).innerText()).toBe(`${currentRange} · ${date}`);
			expect(yield* row.getByRole("cell").nth(1).innerText()).toContain(value);
		}
		for (const date of [
			"Aug 25, 2026",
			"Aug 26, 2026",
			"Aug 27, 2026",
			"Aug 28, 2026",
			"Aug 29, 2026",
			"Aug 30, 2026",
			"Aug 31, 2026",
		]) {
			const row = periodRow(workoutTable, previousRange, date);
			expect(yield* row.count).toBe(1);
			expect(yield* row.getByRole("cell").nth(0).innerText()).toBe(`${previousRange} · ${date}`);
			const value = yield* row.getByRole("cell").nth(1).innerText();
			expect(value).toContain("0 workouts");
			expect(value).not.toContain("Unknown");
		}

		yield* viewExactValues.nth(1).click();
		const hourTable = frame.getByRole("table", {
			exact: true,
			name: "Workout starts by reporting hour exact values",
		});
		expect(yield* hourTable.getByRole("row").count).toBe(25);
		expect(yield* hourTable.getByRole("button").count).toBe(0);
		for (const { hour, detail } of hourRows) {
			const row = hourTable.getByRole("row", { name: hour, exact: false });
			expect(yield* row.count).toBe(1);
			expect(yield* row.getByRole("cell").nth(0).innerText()).toBe(hour);
			expect(yield* row.getByRole("cell").nth(1).innerText()).toBe(detail);
		}

		yield* viewExactValues.first().click();
		yield* workoutTable.waitFor({ state: "hidden" });
		yield* frame.getByRole("button", { exact: true, name: "Trend metric: Workouts" }).click();
		yield* frame.getByRole("radio", { exact: true, name: "Weight volume" }).click();
		const volumeChart = frame.getByRole("img", {
			exact: true,
			name: "Weight volume by workout-start period",
		});
		yield* volumeChart.waitFor({ state: "visible" });
		yield* frame.getByText("View exact values", { exact: true }).first().click();
		const volumeTable = frame.getByRole("table", {
			exact: true,
			name: "Weight volume by workout-start period exact values",
		});
		for (const { date, value } of volumeWorkoutRows) {
			const row = periodRow(volumeTable, currentRange, date);
			expect(yield* row.count).toBe(1);
			expect(yield* row.getByRole("cell").nth(1).innerText()).toContain(value);
		}
		expect(yield* termDefinition(summary, "Weight volume").innerText()).toBe(
			`${fixture.expectedSourceValues.volume} kg × reps`,
		);
		yield* frame.getByText("View exact values", { exact: true }).first().click();
		yield* volumeTable.waitFor({ state: "hidden" });

		const weekSelection: ReportingSelection = { ...fixture.reportingSelection, grouping: "week" };
		yield* frame.getByRole("button", { exact: true, name: "Group by: Day" }).click();
		yield* frame.getByRole("radio", { exact: true, name: "Week" }).click();
		yield* page.waitForURL((url) => hasAnalyticsLocation(url, weekSelection, section));
		yield* frame
			.getByRole("button", { exact: true, name: "Group by: Week" })
			.waitFor({ state: "visible" });
		yield* trendChart.waitFor({ state: "visible" });
		expect(yield* workoutsTab.getAttribute("aria-selected")).toBe("true");
		yield* frame.getByRole("button", { exact: true, name: "Trend metric: Workouts" }).click();
		yield* frame.getByRole("radio", { exact: true, name: "Weight volume" }).click();
		yield* volumeChart.waitFor({ state: "visible" });
		yield* frame.getByText("View exact values", { exact: true }).first().click();
		yield* volumeTable.waitForFunction((table) => table.querySelectorAll("tr").length === 5);
		expect(yield* volumeTable.getByRole("row").count).toBe(5);
		const groupedCurrentRow = periodRow(volumeTable, currentRange, "Sep 1, 2026");
		expect(yield* groupedCurrentRow.count).toBe(1);
		expect(yield* groupedCurrentRow.getByRole("cell").nth(1).innerText()).toContain(
			`${fixture.expectedSourceValues.volume} kg × reps`,
		);
		expect(yield* summary.innerText()).toBe(initialSummary);
		yield* frame.getByText("View exact values", { exact: true }).first().click();
		yield* volumeTable.waitFor({ state: "hidden" });

		yield* page.goBack();
		yield* page.waitForURL((url) => hasAnalyticsLocation(url, fixture.reportingSelection, section));
		yield* frame
			.getByRole("button", { exact: true, name: "Group by: Day" })
			.waitFor({ state: "visible" });
		yield* trendChart.waitFor({ state: "visible" });
		expect(yield* workoutsTab.getAttribute("aria-selected")).toBe("true");
		yield* frame.getByRole("button", { exact: true, name: "Trend metric: Workouts" }).click();
		yield* frame.getByRole("radio", { exact: true, name: "Weight volume" }).click();
		yield* volumeChart.waitFor({ state: "visible" });
		yield* frame.getByText("View exact values", { exact: true }).first().click();
		yield* volumeTable.getByRole("row").first().waitFor({ state: "visible" });
		yield* volumeTable.waitForFunction((table) => table.querySelectorAll("tr").length === 15);
		expect(yield* volumeTable.getByRole("row").count).toBe(15);
		for (const { date, value } of volumeWorkoutRows) {
			const row = periodRow(volumeTable, currentRange, date);
			expect(yield* row.count).toBe(1);
			expect(yield* row.getByRole("cell").nth(1).innerText()).toContain(value);
		}
		expect(yield* summary.innerText()).toBe(initialSummary);
	}).pipe(PlaywrightSpawner.withBrowser),
);
