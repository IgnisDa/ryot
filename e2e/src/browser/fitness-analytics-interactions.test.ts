import {
	ReportingSelection,
	reportingSelectionSearch,
} from "@ryot-app/contract/modules/analytics/reporting";
import { identityTupleKey } from "@ryot-app/contract/modules/plugins/references";
import { fitnessMeasurementReadingsRecipe } from "@ryot-app/fitness-plugin/analytics-recipes";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Clock, Effect, Result, Schema } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { getEntity } from "~/fixtures/kernel/entities";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { createFitnessAnalyticsFixture } from "~/fixtures/plugins/fitness/analytics";
import { updateMeasurementReadings } from "~/fixtures/plugins/fitness/measurements";
import { requirePresent } from "~/support/assertions";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";

const iframeSelector = 'main > div:not([aria-hidden="true"]) iframe';
const analyticsFrame = (page: Playwright.Page) => page.locator(iframeSelector);
const compactViewport = { width: 390, height: 844 };
const expectedMeasurementRows: ReadonlyArray<readonly [date: string, value: string]> = [
	["Sep 2, 2026", "0 widgets"],
	["Sep 4, 2026", "2.5 widgets"],
	["Sep 7, 2026", "1.25 widgets"],
];

const hasAnalyticsLocation = (url: URL, selection: ReportingSelection, section: string) => {
	const decodedReporting = Schema.decodeUnknownResult(Schema.fromJsonString(ReportingSelection))(
		url.searchParams.get("reporting"),
	);
	return (
		url.pathname === "/v/k/analytics" &&
		url.searchParams.get("section") === section &&
		Result.isSuccess(decodedReporting) &&
		stableStringify(decodedReporting.success) === stableStringify(selection)
	);
};

const summaryValue = (summary: Playwright.Locator, label: string) =>
	summary
		.getByRole("term")
		.and(summary.getByText(label, { exact: true }))
		.locator("xpath=..")
		.getByRole("definition")
		.first();

const rowWithName = (table: Playwright.Locator, name: string) => table.getByRole("row", { name });

const openFitnessAnalytics = Effect.gen(function* () {
	const fixture = yield* createFitnessAnalyticsFixture();
	const section = identityTupleKey(fixture.reference.pluginId, "fitness");
	const search = new URLSearchParams(reportingSelectionSearch(fixture.reportingSelection));
	search.set("section", section);
	const entryPath = `/v/k/analytics?${search}`;
	const browser = yield* Playwright.Browser;
	const context = yield* browser.newContext({
		hasTouch: true,
		viewport: compactViewport,
		timezoneId: "America/New_York",
	});
	const page = yield* context.newPage;
	const iframe = analyticsFrame(page);

	yield* signInThroughHostedOAuth(page, fixture.account.email, fixture.account.password, {
		entryPath,
	});
	yield* page.waitForURL((url) => hasAnalyticsLocation(url, fixture.reportingSelection, section));
	expect(yield* page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
		"America/New_York",
	);

	const frame = iframe.contentFrame();
	yield* frame
		.getByRole("heading", { level: 1, exact: true, name: "Analytics" })
		.waitFor({ state: "visible" });
	expect(yield* iframe.count).toBe(1);
	expect(yield* iframe.getAttribute("src")).toBeNull();
	expect(yield* iframe.getAttribute("srcdoc")).not.toBeNull();
	expect(yield* iframe.getAttribute("sandbox")).toBe("allow-scripts");

	return { page, frame, context, fixture, section };
});

const goToRankingsWithKeyboard = (frame: Playwright.FrameLocator) =>
	Effect.gen(function* () {
		const workoutsTab = frame.getByRole("tab", { exact: true, name: "Workouts" });
		const rankingsTab = frame.getByRole("tab", { exact: true, name: "Rankings" });
		expect(yield* workoutsTab.getAttribute("aria-selected")).toBe("true");
		yield* workoutsTab.focus();
		yield* workoutsTab.press("ArrowRight");
		yield* rankingsTab.waitForFunction((tab) => tab.getAttribute("aria-selected") === "true");
		expect(yield* frame.getByRole("tabpanel").count).toBe(1);
		expect(yield* rankingsTab.getAttribute("aria-selected")).toBe("true");
		return rankingsTab;
	});

it.live(
	"drills into Fitness rankings and measurements, preserving reporting scope and exact readings",
	() =>
		Effect.gen(function* () {
			const { page, frame, fixture, section } = yield* openFitnessAnalytics;
			const summary = frame.getByRole("region", { exact: true, name: "Fitness analytics summary" });
			yield* summary.waitFor({ state: "visible" });
			const initialSummary = yield* summary.innerText();
			expect(yield* summaryValue(summary, "Measurement entries").innerText()).toBe(
				`${fixture.expectedSourceValues.measurementEntries} entries`,
			);
			expect(yield* summaryValue(summary, "Measurement readings").innerText()).toBe(
				`${fixture.expectedSourceValues.measurementReadings} readings`,
			);
			yield* frame.getByText("Reporting time zone: UTC", { exact: true }).waitFor();

			const targetNames = yield* Effect.forEach(fixture.taxonomy.targets, (target) =>
				Effect.gen(function* () {
					const entity = yield* getEntity(fixture.account.client, target.entityId);
					return { ...target, name: entity.name };
				}),
			);
			const exercise = yield* getEntity(fixture.account.client, fixture.exerciseId);
			const workouts = yield* Effect.forEach(fixture.workoutIds, (id) =>
				Effect.map(getEntity(fixture.account.client, id), (entity) => ({ id, name: entity.name })),
			);

			const rankingsTab = yield* goToRankingsWithKeyboard(frame);
			const targetsTable = frame.getByRole("table", { exact: true, name: "targets rankings" });
			yield* targetsTable.getByRole("row").first().waitFor({ state: "visible" });
			expect(yield* targetsTable.getByRole("row").count).toBe(4);
			for (const target of targetNames) {
				const row = rowWithName(targetsTable, target.name);
				let weightedSets = "3 weighted sets";
				if (target.role === "secondary") {
					weightedSets = "1.5 weighted sets";
				} else if (target.role === "stabilizer") {
					weightedSets = "0 weighted sets";
				}
				expect(yield* row.getByRole("cell").allTextContents()).toEqual([
					target.name,
					weightedSets,
					"3 sets",
					"2 occurrences",
					"2 workouts",
					"View workouts",
				]);
			}

			const exercises = frame.getByRole("radiogroup", { exact: true, name: "Ranking kind" });
			yield* exercises.getByRole("radio", { exact: true, name: "Exercises" }).click();
			const exercisesTable = frame.getByRole("table", { exact: true, name: "exercises rankings" });
			const exerciseRow = rowWithName(exercisesTable, exercise.name);
			yield* exerciseRow.waitFor({ state: "visible" });
			expect(yield* exercisesTable.getByRole("row").count).toBe(2);
			expect(yield* exerciseRow.getByRole("cell").allTextContents()).toEqual([
				exercise.name,
				"3 sets",
				"2 occurrences",
				"2 workouts",
				"View workouts",
			]);

			const drillButton = frame.getByRole("button", {
				exact: true,
				name: `View workouts contributing to ${exercise.name}`,
			});
			yield* drillButton.click();
			const drillTitle = `${exercise.name} · 2026-09-01 – 2026-09-07`;
			const dialog = frame.getByRole("dialog", { exact: true, name: drillTitle });
			yield* dialog.waitFor({ state: "visible" });
			expect(yield* dialog.getByText(drillTitle, { exact: true }).count).toBe(1);
			const workoutTable = dialog.getByRole("table", {
				exact: true,
				name: "Contributing workouts",
			});
			yield* workoutTable.waitFor({ state: "visible" });
			expect(yield* workoutTable.getByRole("row").count).toBe(3);
			for (const workout of workouts) {
				const row = rowWithName(workoutTable, workout.name);
				const link = dialog.getByRole("link", { exact: true, name: workout.name });
				expect(yield* link.getAttribute("href")).toBe(`/e/${encodeURIComponent(workout.id)}`);
				expect(yield* row.getByRole("cell").count).toBe(3);
			}
			expect(yield* dialog.getByRole("link").count).toBe(fixture.workoutIds.length);
			const firstWorkout = requirePresent(
				workouts.find(({ id }) => id === fixture.workoutIds[0]),
				"Expected the first analytics workout",
			);
			const secondWorkout = requirePresent(
				workouts.find(({ id }) => id === fixture.workoutIds[1]),
				"Expected the second analytics workout",
			);
			const firstRow = rowWithName(workoutTable, firstWorkout.name);
			const secondRow = rowWithName(workoutTable, secondWorkout.name);
			expect(yield* firstRow.locator("time").getAttribute("datetime")).toBe(
				"2026-09-02T10:00:00.000Z",
			);
			expect(yield* firstRow.getByRole("cell").nth(1).innerText()).toBe("Sep 2, 2026, 10:00 AM");
			expect(yield* firstRow.getByRole("cell").nth(2).innerText()).toBe("3600 seconds");
			expect(yield* secondRow.locator("time").getAttribute("datetime")).toBe(
				"2026-09-04T18:00:00.000Z",
			);
			expect(yield* secondRow.getByRole("cell").nth(1).innerText()).toBe("Sep 4, 2026, 6:00 PM");
			expect(yield* secondRow.getByRole("cell").nth(2).innerText()).toBe("1800 seconds");

			yield* page.keyboard.press("Escape");
			yield* dialog.waitFor({ state: "hidden" });
			expect(
				yield* drillButton.evaluate((button) => button.ownerDocument.activeElement === button),
			).toBe(true);

			yield* drillButton.click();
			yield* dialog.waitFor({ state: "visible" });
			yield* dialog
				.getByRole("button", {
					exact: true,
					name: `Close contributing workouts for ${exercise.name}`,
				})
				.click();
			yield* dialog.waitFor({ state: "hidden" });
			yield* frame.getByRole("button", { exact: true, name: "Group by: Day" }).click();
			yield* frame.getByRole("radio", { exact: true, name: "Week" }).click();
			const weekSelection: ReportingSelection = { ...fixture.reportingSelection, grouping: "week" };
			yield* page.waitForURL((url) => hasAnalyticsLocation(url, weekSelection, section));
			yield* dialog.waitFor({ state: "hidden" });
			yield* frame.getByRole("button", { exact: true, name: "Group by: Week" }).waitFor();
			expect(yield* summary.innerText()).toBe(initialSummary);
			yield* goToRankingsWithKeyboard(frame);
			yield* exercises.getByRole("radio", { exact: true, name: "Exercises" }).click();
			yield* exerciseRow.waitFor({ state: "visible" });
			yield* drillButton.click();
			yield* dialog.waitFor({ state: "visible" });
			yield* workoutTable.waitFor({ state: "visible" });
			expect(yield* workoutTable.getByRole("row").count).toBe(3);
			yield* page.goBack();
			yield* page.waitForURL((url) =>
				hasAnalyticsLocation(url, fixture.reportingSelection, section),
			);
			yield* dialog.waitFor({ state: "hidden" });
			yield* frame.getByRole("button", { exact: true, name: "Group by: Day" }).waitFor();
			expect(yield* summary.innerText()).toBe(initialSummary);
			yield* goToRankingsWithKeyboard(frame);
			yield* exercises.getByRole("radio", { exact: true, name: "Exercises" }).click();
			yield* exerciseRow.waitFor({ state: "visible" });
			yield* drillButton.click();
			yield* dialog.waitFor({ state: "visible" });
			yield* workoutTable.waitFor({ state: "visible" });
			expect(yield* workoutTable.getByRole("row").count).toBe(3);
			expect(yield* summary.innerText()).toBe(initialSummary);
			yield* page.keyboard.press("Escape");
			yield* dialog.waitFor({ state: "hidden" });

			const readingsNow = yield* Clock.currentTimeMillis;
			const readings = yield* executeRyotQLRecipe(
				fixture.account.client,
				fitnessMeasurementReadingsRecipe({
					timeZone: "UTC",
					now: readingsNow,
					reference: fixture.reference,
					selection: fixture.reportingSelection,
					metricId: fixture.measurementMetricId,
				}),
			);
			const editedReading = requirePresent(
				readings.items.find(({ occurredAt }) => occurredAt === "2026-09-04T12:00:00.000Z"),
				"Expected the September 4 measurement reading",
			);
			const entryId = requirePresent(editedReading.entryId, "Expected the measurement entry ID");

			yield* rankingsTab.focus();
			yield* rankingsTab.press("ArrowRight");
			const measurementsTab = frame.getByRole("tab", { exact: true, name: "Measurements" });
			yield* measurementsTab.waitForFunction((tab) => tab.getAttribute("aria-selected") === "true");
			const metricPicker = frame.getByRole("button", { exact: true, name: "Choose a metric" });
			yield* metricPicker.click();
			const picker = frame.getByRole("dialog", { exact: true, name: "Choose measurement metric" });
			yield* picker.waitFor({ state: "visible" });
			yield* picker.getByRole("button", { name: fixture.measurementMetricName }).click();
			yield* picker.waitFor({ state: "hidden" });

			const trend = frame.getByRole("region", { exact: true, name: "Measurement trend" });
			const chart = trend.getByRole("img", {
				exact: true,
				name: `${fixture.measurementMetricName} bucket averages`,
			});
			yield* chart.waitFor({ state: "visible" });
			yield* trend
				.getByText(`${fixture.measurementMetricName} · Bucket averages · 2026-09-01 – 2026-09-07`, {
					exact: true,
				})
				.waitFor({ state: "visible" });
			const exactValuesButton = trend.getByText("View exact values", { exact: true });
			yield* exactValuesButton.click();
			const trendTable = trend.getByRole("table", {
				exact: true,
				name: `${fixture.measurementMetricName} bucket averages exact values`,
			});
			expect(yield* trendTable.getByRole("row").count).toBe(15);
			const zeroBucket = rowWithName(trendTable, "Sep 2, 2026");
			expect(yield* zeroBucket.innerText()).toContain(
				"0 widgets · 1 readings; grouped average; source average 0 widgets",
			);
			const missingBucket = rowWithName(trendTable, "Sep 3, 2026");
			expect(yield* missingBucket.innerText()).toContain("Not recorded · No readings");
			expect(yield* missingBucket.innerText()).not.toContain("0 widgets");
			const previousBucket = rowWithName(trendTable, "Aug 25, 2026");
			expect(yield* previousBucket.innerText()).toContain("Not recorded · No readings");
			expect(yield* previousBucket.innerText()).not.toContain("0 widgets");

			const readingsTable = frame.getByRole("table", {
				exact: true,
				name: "Loaded measurement readings in UTC",
			});
			yield* readingsTable.getByRole("row").first().waitFor({ state: "visible" });
			expect(yield* readingsTable.getByRole("row").count).toBe(4);
			for (const [date, value] of expectedMeasurementRows) {
				const row = rowWithName(readingsTable, date);
				expect(yield* row.innerText()).toContain(value);
				expect(yield* row.innerText()).toContain("12:00 PM UTC");
			}

			const exactValuesBeforeSmooth = yield* trendTable.innerText();
			const expectedSmoothedExactValues = expectedMeasurementRows.reduce(
				(text, [date, value]) =>
					text.replace(
						`${date}\t${value} · 1 readings; grouped average; source average ${value}`,
						`${date}\t${value} · 1 readings; grouped average; 3-point smoothing; source average ${value}`,
					),
				exactValuesBeforeSmooth,
			);
			const readingRowsBeforeSmooth = yield* readingsTable.innerText();
			const smoothing = trend.getByRole("checkbox", {
				exact: true,
				name: "Smooth bucket averages (3/7-point)",
			});
			expect(yield* smoothing.isChecked()).toBe(false);
			yield* smoothing.check();
			expect(yield* smoothing.isChecked()).toBe(true);
			yield* trend
				.getByText(
					"Smoothing uses rolling averages of the grouped bucket averages. It uses 3 or 7 points, does not cross missing buckets or unit changes, and leaves exact readings unchanged.",
				)
				.waitFor({ state: "visible" });
			expect(yield* trendTable.innerText()).toBe(expectedSmoothedExactValues);
			expect(yield* readingsTable.innerText()).toBe(readingRowsBeforeSmooth);
			yield* exactValuesButton.click();

			yield* updateMeasurementReadings(fixture.account.client, {
				entryId,
				occurredAt: editedReading.occurredAt,
				values: [{ value: 3.75, metricId: fixture.measurementMetricId }],
				...(editedReading.comment === null ? {} : { comment: editedReading.comment }),
			});
			yield* page.reload;
			yield* page.waitForURL((url) =>
				hasAnalyticsLocation(url, fixture.reportingSelection, section),
			);
			const refreshedFrame = analyticsFrame(page).contentFrame();
			const refreshedSummary = refreshedFrame.getByRole("region", {
				exact: true,
				name: "Fitness analytics summary",
			});
			yield* refreshedSummary.waitFor({ state: "visible" });
			expect(yield* summaryValue(refreshedSummary, "Measurement entries").innerText()).toBe(
				`${fixture.expectedSourceValues.measurementEntries} entries`,
			);
			expect(yield* summaryValue(refreshedSummary, "Measurement readings").innerText()).toBe(
				`${fixture.expectedSourceValues.measurementReadings} readings`,
			);
			expect(yield* refreshedSummary.innerText()).toBe(initialSummary);
			const refreshedWorkoutsTab = refreshedFrame.getByRole("tab", {
				exact: true,
				name: "Workouts",
			});
			yield* refreshedWorkoutsTab.focus();
			yield* refreshedWorkoutsTab.press("ArrowRight");
			const refreshedRankingsTab = refreshedFrame.getByRole("tab", {
				exact: true,
				name: "Rankings",
			});
			yield* refreshedRankingsTab.press("ArrowRight");
			const refreshedMeasurementsTab = refreshedFrame.getByRole("tab", {
				exact: true,
				name: "Measurements",
			});
			yield* refreshedMeasurementsTab.waitForFunction(
				(tab) => tab.getAttribute("aria-selected") === "true",
			);
			yield* refreshedFrame.getByRole("button", { exact: true, name: "Choose a metric" }).click();
			const refreshedPicker = refreshedFrame.getByRole("dialog", {
				exact: true,
				name: "Choose measurement metric",
			});
			yield* refreshedPicker.waitFor({ state: "visible" });
			yield* refreshedPicker.getByRole("button", { name: fixture.measurementMetricName }).click();
			const refreshedTrend = refreshedFrame.getByRole("region", {
				exact: true,
				name: "Measurement trend",
			});
			const refreshedChart = refreshedTrend.getByRole("img", {
				exact: true,
				name: `${fixture.measurementMetricName} bucket averages`,
			});
			yield* refreshedChart.waitFor({ state: "visible" });
			yield* refreshedTrend.getByText("View exact values", { exact: true }).click();
			const refreshedTrendTable = refreshedTrend.getByRole("table", {
				exact: true,
				name: `${fixture.measurementMetricName} bucket averages exact values`,
			});
			expect(yield* rowWithName(refreshedTrendTable, "Sep 4, 2026").innerText()).toContain(
				"3.75 widgets · 1 readings; grouped average; source average 3.75 widgets",
			);
			expect(yield* rowWithName(refreshedTrendTable, "Sep 2, 2026").innerText()).toContain(
				"0 widgets · 1 readings; grouped average; source average 0 widgets",
			);
			const refreshedReadingsTable = refreshedFrame.getByRole("table", {
				exact: true,
				name: "Loaded measurement readings in UTC",
			});
			expect(yield* refreshedReadingsTable.getByRole("row").count).toBe(4);
			expect(yield* rowWithName(refreshedReadingsTable, "Sep 4, 2026").innerText()).toContain(
				"3.75 widgets",
			);
			expect(yield* rowWithName(refreshedReadingsTable, "Sep 2, 2026").innerText()).toContain(
				"0 widgets",
			);
			const screenshotPath = `/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/fitness-analytics-measurement-${crypto.randomUUID()}-compact.png`;
			yield* page.use((nativePage) =>
				nativePage
					.locator(iframeSelector)
					.contentFrame()
					.getByRole("img", {
						exact: true,
						name: `${fixture.measurementMetricName} bucket averages`,
					})
					.evaluate((plot) =>
						plot.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }),
					),
			);
			yield* refreshedChart.waitForFunction((plot) => {
				const view = plot.ownerDocument.defaultView;
				const bounds = plot.getBoundingClientRect();
				const header = plot.ownerDocument.querySelector('[data-scroll-obstruction="top"]');
				return (
					view !== null &&
					header !== null &&
					bounds.height === 200 &&
					bounds.top >= Math.max(0, header.getBoundingClientRect().bottom) &&
					bounds.bottom <= view.innerHeight &&
					bounds.left >= 0 &&
					bounds.right <= view.innerWidth
				);
			});
			yield* analyticsFrame(page).waitForFunction((iframe) => {
				const view = iframe.ownerDocument.defaultView;
				const bounds = iframe.getBoundingClientRect();
				return view !== null && bounds.top >= 0 && bounds.bottom <= view.innerHeight;
			});
			yield* page.use((nativePage) =>
				nativePage
					.locator(iframeSelector)
					.contentFrame()
					.getByRole("img", {
						exact: true,
						name: `${fixture.measurementMetricName} bucket averages`,
					})
					.screenshot({ path: screenshotPath }),
			);
			yield* Effect.log("Fitness measurement chart screenshot", screenshotPath);
		}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("retains Fitness ranking rows after an offline refresh and retries the real read", () =>
	Effect.gen(function* () {
		const { frame, context, fixture } = yield* openFitnessAnalytics;
		const target = requirePresent(
			fixture.taxonomy.targets.find(({ role }) => role === "primary"),
			"Expected the primary exercise target",
		);
		const targetEntity = yield* getEntity(fixture.account.client, target.entityId);
		const rankingsTab = yield* goToRankingsWithKeyboard(frame);
		const targetTable = frame.getByRole("table", { exact: true, name: "targets rankings" });
		const row = rowWithName(targetTable, targetEntity.name);
		yield* row.waitFor({ state: "visible" });

		yield* context.setOffline(true);
		yield* frame.getByRole("button", { exact: true, name: "Refresh" }).click();
		yield* frame
			.getByText("The targets rankings couldn't be refreshed.", { exact: true })
			.waitFor({ state: "visible" });
		expect(yield* row.getByRole("cell").allTextContents()).toEqual([
			targetEntity.name,
			"3 weighted sets",
			"3 sets",
			"2 occurrences",
			"2 workouts",
			"View workouts",
		]);

		yield* context.setOffline(false);
		yield* frame.getByRole("button", { exact: true, name: "Try again" }).click();
		yield* frame
			.getByText("The targets rankings couldn't be refreshed.", { exact: true })
			.waitFor({ state: "hidden" });
		expect(yield* row.getByRole("cell").allTextContents()).toEqual([
			targetEntity.name,
			"3 weighted sets",
			"3 sets",
			"2 occurrences",
			"2 workouts",
			"View workouts",
		]);
		expect(yield* rankingsTab.getAttribute("aria-selected")).toBe("true");
	}).pipe(PlaywrightSpawner.withBrowser),
);
