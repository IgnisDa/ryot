import type { ReportingSelection } from "@ryot-app/contract/modules/analytics/reporting";
import {
	mediaAnalyticsRankingRecipe,
	mediaAnalyticsRecordsRecipe,
} from "@ryot-app/media-plugin/shared/analytics-recipes";
import { Clock, Effect, Option } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	analyticsSearch,
	analyticsSection,
	hasAnalyticsSelection,
} from "~/fixtures/kernel/analytics-location";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { createMediaAnalyticsFixture } from "~/fixtures/plugins/media/analytics";
import {
	requireMediaConsumptionGroup,
	waitForMediaConsumptionReport,
} from "~/fixtures/plugins/media/consumption";
import { settledHistoryCorrection } from "~/fixtures/plugins/media/history-correction";
import { requirePresent } from "~/support/assertions";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";

const iframeSelector = 'main > div:not([aria-hidden="true"]) iframe';
const currentRange = "2026-09-01 – 2026-09-07";
const previousRange = "2026-08-25 – 2026-08-31";
const desktopViewport = { width: 1280, height: 900 };
const colorSchemes: ReadonlyArray<"dark" | "light"> = ["light", "dark"];
const visualCases = [
	{ name: "desktop", chartHeight: 280, viewport: desktopViewport },
	{ name: "compact", chartHeight: 200, viewport: { width: 390, height: 844 } },
];
const periodDates = [
	["Sep 1, 2026", "Aug 25, 2026"],
	["Sep 2, 2026", "Aug 26, 2026"],
	["Sep 3, 2026", "Aug 27, 2026"],
	["Sep 4, 2026", "Aug 28, 2026"],
	["Sep 5, 2026", "Aug 29, 2026"],
	["Sep 6, 2026", "Aug 30, 2026"],
	["Sep 7, 2026", "Aug 31, 2026"],
] satisfies ReadonlyArray<readonly [string, string]>;

const analyticsFrame = (page: Playwright.Page) => page.locator(iframeSelector).contentFrame();
const hasAnalyticsLocation = (url: URL, selection: ReportingSelection, section: string) =>
	hasAnalyticsSelection(url, selection) && url.searchParams.get("section") === section;
const summaryValue = (summary: Playwright.Locator, label: string) =>
	summary
		.getByRole("term")
		.and(summary.getByText(label, { exact: true }))
		.locator("xpath=..")
		.getByRole("definition")
		.first();
const summaryCoverage = (summary: Playwright.Locator, label: string) =>
	summary
		.getByRole("term")
		.and(summary.getByText(label, { exact: true }))
		.locator("xpath=..")
		.getByRole("definition")
		.nth(1);
const periodRow = (table: Playwright.Locator, period: string, date: string) =>
	table.getByRole("row", { name: `${period} · ${date}` });

const openMediaAnalytics = Effect.fn("openMediaAnalytics")(function* () {
	const fixture = yield* createMediaAnalyticsFixture();
	const section = analyticsSection(fixture.reference.pluginId, "media");
	const search = analyticsSearch(fixture.reportingSelection, { section });
	const browser = yield* Playwright.Browser;
	const context = yield* browser.newContext({
		hasTouch: true,
		viewport: desktopViewport,
		timezoneId: "America/New_York",
	});
	const page = yield* context.newPage;
	yield* signInThroughHostedOAuth(page, fixture.account.email, fixture.account.password, {
		entryPath: `/v/k/analytics?${search}`,
	});
	yield* page.waitForURL((url) => hasAnalyticsLocation(url, fixture.reportingSelection, section));
	const frameElement = page.locator(iframeSelector);
	const frame = frameElement.contentFrame();
	yield* frame
		.getByRole("heading", { level: 1, exact: true, name: "Analytics" })
		.waitFor({ state: "visible" });
	const summary = frame.getByRole("region", { exact: true, name: "Media analytics summary" });
	yield* summaryValue(summary, "Active days")
		.and(summary.getByText("3 days", { exact: true }))
		.waitFor();
	return { page, frame, summary, context, fixture, section, frameElement };
});

it.live("accepts Media summary and exact charts across desktop and compact themes", () =>
	Effect.gen(function* () {
		const { page, frame, summary, fixture, section, frameElement } = yield* openMediaAnalytics();
		expect(yield* page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
			"America/New_York",
		);
		expect(fixture.timeZone).toBe("UTC");
		expect(yield* frameElement.count).toBe(1);
		expect(yield* frameElement.getAttribute("src")).toBeNull();
		expect(yield* frameElement.getAttribute("srcdoc")).not.toBeNull();
		expect(yield* frameElement.getAttribute("sandbox")).toBe("allow-scripts");
		expect(yield* frame.getByRole("heading", { level: 1 }).count).toBe(1);
		expect(yield* summary.getByRole("heading", { level: 1 }).count).toBe(0);
		expect(yield* page.getByRole("heading", { level: 1, name: "Analytics" }).count).toBe(0);
		yield* frame.getByText("Reporting time zone: UTC", { exact: true }).waitFor();

		for (const [label, value] of [
			["Title completion occurrences", "3 titles"],
			["Episode completion occurrences", "0 occurrences"],
			["Distinct completed titles", "2 titles"],
			["Active days", "3 days"],
			["Active observations", "5 observations"],
			["Pages", "100 pages"],
			["Episodes", "1 episodes"],
			["Minutes", "≥ 0 minutes"],
		] satisfies ReadonlyArray<readonly [string, string]>) {
			expect(yield* summaryValue(summary, label).innerText()).toBe(value);
		}
		expect(yield* summaryCoverage(summary, "Pages").innerText()).toBe(
			"Known observations · 2 observations · Recorded · 40 pages · Estimated · 60 pages · Missing observations · 0 observations",
		);
		expect(yield* summaryCoverage(summary, "Episodes").innerText()).toBe(
			"Known observations · 1 observations · Recorded · 1 episodes · Estimated · 0 episodes · Missing observations · 0 observations",
		);
		expect(yield* summaryCoverage(summary, "Minutes").innerText()).toBe(
			"Known observations · 1 observations · Recorded · 0 minutes · Estimated · 0 minutes · Missing observations · 1 observations",
		);
		expect(yield* summary.innerText()).toContain(
			"Full-history source coverage includes 1 unknown-date observations; these records are not assigned to a reporting date.",
		);
		const currentReviews = summary
			.getByRole("term")
			.and(summary.getByText(`Current · ${currentRange}`, { exact: true }))
			.locator("xpath=..");
		const previousReviews = summary
			.getByRole("term")
			.and(summary.getByText(`Previous · ${previousRange}`, { exact: true }))
			.locator("xpath=..");
		expect(yield* currentReviews.getByRole("definition").allTextContents()).toEqual([
			"2 reviews · 2 rated",
			"Source average · 40 /100",
		]);
		expect(yield* previousReviews.getByRole("definition").allTextContents()).toEqual([
			"0 reviews · Unknown",
			"Source average · Unknown",
		]);
		const reviewTable = summary.getByRole("table", {
			exact: true,
			name: "Review count and rating by media category",
		});
		expect(
			yield* reviewTable
				.getByRole("row", { name: "Book (title)" })
				.getByRole("cell")
				.allTextContents(),
		).toEqual(["1 reviews", "1 ratings", "0 /100", "Unknown", "Unknown", "Unknown"]);
		expect(
			yield* reviewTable
				.getByRole("row", { name: "Movie (title)" })
				.getByRole("cell")
				.nth(2)
				.innerText(),
		).toBe("80 /100");
		const initialSummary = yield* summary.innerText();
		expect(initialSummary).toContain(
			`${currentRange} vs ${previousRange} · New activity · +3 titles`,
		);
		expect(initialSummary).not.toContain("Infinity");
		expect(initialSummary).not.toContain("NaN");

		const chartsTab = frame.getByRole("tab", { exact: true, name: "Charts" });
		expect(yield* chartsTab.getAttribute("aria-selected")).toBe("true");
		expect(yield* frame.getByRole("tabpanel").count).toBe(1);
		expect(yield* frame.getByRole("tabpanel").getAttribute("id")).toBe(
			yield* chartsTab.getAttribute("aria-controls"),
		);
		expect(yield* frame.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
			yield* chartsTab.getAttribute("id"),
		);
		const trendChart = frame.getByRole("img", {
			exact: true,
			name: "Active observations by reporting period",
		});
		const hourChart = frame.getByRole("img", {
			exact: true,
			name: "Active observations by local hour",
		});
		yield* trendChart.waitFor({ state: "visible" });
		yield* hourChart.waitFor({ state: "visible" });
		yield* frame
			.getByRole("img", { exact: true, name: `Daily active observations · ${currentRange}` })
			.waitFor({ state: "visible" });
		for (const visualCase of visualCases) {
			yield* page.setViewportSize(visualCase.viewport);
			for (const colorScheme of colorSchemes) {
				yield* page.use((nativePage) =>
					nativePage.emulateMedia({ colorScheme, reducedMotion: "reduce" }),
				);
				for (const chart of [trendChart, hourChart]) {
					yield* chart.waitForFunction(
						(image, height) => image.getBoundingClientRect().height === height,
						visualCase.chartHeight,
					);
					const bounds = Option.getOrThrowWith(
						yield* chart.boundingBox(),
						() => new Error("Expected Media chart bounds"),
					);
					expect(bounds.height).toBe(visualCase.chartHeight);
				}
				expect(
					yield* frame
						.locator("body")
						.evaluate((body) => ({
							dark: body.ownerDocument.defaultView?.matchMedia("(prefers-color-scheme: dark)")
								.matches,
							reduced: body.ownerDocument.defaultView?.matchMedia(
								"(prefers-reduced-motion: reduce)",
							).matches,
						})),
				).toEqual({ reduced: true, dark: colorScheme === "dark" });
				expect(
					yield* page.evaluate(
						() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
					),
				).toBe(false);
				expect(
					yield* frame.locator("html").evaluate((html) => html.scrollWidth > html.clientWidth),
				).toBe(false);
			}
		}

		yield* page.setViewportSize(desktopViewport);
		const exactValues = frame.getByText("View exact values", { exact: true });
		yield* exactValues.first().click();
		const activityTable = frame.getByRole("table", {
			exact: true,
			name: "Active observations by reporting period exact values",
		});
		yield* activityTable.waitForFunction((table) => table.querySelectorAll("tr").length === 15);
		for (const [date, previousDate] of periodDates) {
			const expected =
				date === "Sep 2, 2026" ? 3 : Number(date === "Sep 4, 2026" || date === "Sep 5, 2026");
			expect(
				yield* periodRow(activityTable, currentRange, date).getByRole("cell").nth(1).innerText(),
			).toBe(`${expected} observations`);
			expect(
				yield* periodRow(activityTable, previousRange, previousDate)
					.getByRole("cell")
					.nth(1)
					.innerText(),
			).toBe("0 observations");
		}
		const trendDrill = periodRow(activityTable, currentRange, "Sep 2, 2026").getByRole("button");
		yield* trendDrill.focus();
		yield* trendDrill.press("Enter");
		const dayDialog = frame.getByRole("dialog");
		yield* dayDialog.getByText("3 records loaded", { exact: true }).waitFor();
		expect(yield* dayDialog.count).toBe(1);
		expect(
			yield* dayDialog.getByText("Active observations · 2026-09-02 · 2026-09-02", { exact: true })
				.count,
		).toBe(1);
		expect(yield* dayDialog.innerText()).toContain(
			"Period: 2026-09-02 · Time zone: UTC · Active observations only",
		);
		const dayRecords = dayDialog.getByRole("table", {
			exact: true,
			name: "Media analytics records",
		});
		expect(yield* dayRecords.locator("tbody tr").count).toBe(3);
		expect(yield* dayRecords.locator("time").allTextContents()).toEqual([
			"Sep 2, 2026, 7:00 PM",
			"Sep 2, 2026, 6:00 PM",
			"2026-09-02",
		]);
		yield* page.keyboard.press("Escape");
		yield* dayDialog.waitFor({ state: "hidden" });
		expect(
			yield* trendDrill.evaluate((button) => button.ownerDocument.activeElement === button),
		).toBe(true);

		yield* exactValues.nth(1).click();
		const hourTable = frame.getByRole("table", {
			exact: true,
			name: "Active observations by local hour exact values",
		});
		expect(yield* hourTable.getByRole("row").count).toBe(25);
		for (let hour = 0; hour < 24; hour += 1) {
			const label = `${String(hour).padStart(2, "0")}:00–${String(hour + 1).padStart(2, "0")}:00`;
			const expected = hour === 18 ? 2 : Number(hour === 19);
			expect(
				yield* hourTable.getByRole("row", { name: label }).getByRole("cell").nth(1).innerText(),
			).toBe(`${expected} observations`);
		}
		yield* frame
			.getByText(
				"Only instant-dated observations are grouped by hour. Date-only and unknown dates are excluded.",
				{ exact: true },
			)
			.waitFor();
		yield* frame
			.getByRole("heading", { exact: true, name: "Daily consistency" })
			.locator("xpath=..")
			.getByText("View exact values", { exact: true })
			.click();
		expect(
			yield* frame
				.getByRole("heading", { exact: true, name: "Daily consistency" })
				.locator("xpath=..")
				.getByText(currentRange, { exact: true }).count,
		).toBe(1);
		const dailyTable = frame.getByRole("table", {
			name: /^Daily active observations · .* exact values$/,
		});
		expect(yield* dailyTable.locator("tbody tr").count).toBe(7);
		for (let day = 1; day <= 7; day += 1) {
			const expected = day === 2 ? 3 : Number(day === 4 || day === 5);
			expect(
				yield* dailyTable
					.getByRole("row", { name: new RegExp(`^Sep ${day}, 2026 `) })
					.getByRole("cell")
					.nth(1)
					.innerText(),
			).toBe(expected === 0 ? "No active observations" : `${expected} active observations`);
		}
		yield* frame
			.getByRole("heading", { exact: true, name: "Daily consistency" })
			.locator("xpath=..")
			.getByText("View exact values", { exact: true })
			.click();
		yield* dailyTable.waitFor({ state: "hidden" });
		yield* exactValues.first().click();
		yield* activityTable.waitFor({ state: "hidden" });
		yield* page.setViewportSize({ width: 390, height: 844 });
		yield* trendChart.waitForFunction((image) => image.getBoundingClientRect().height === 200);
		yield* frame
			.getByRole("heading", { exact: true, name: "Daily consistency" })
			.locator("xpath=..")
			.getByText("View exact values", { exact: true })
			.click();
		yield* dailyTable.waitForFunction((table) => table.querySelectorAll("tbody tr").length === 7);
		const dailyDrill = dailyTable.getByRole("button", {
			exact: true,
			name: "View records: Sep 4, 2026 · 1 active observations",
		});
		yield* dailyDrill.focus();
		yield* dailyDrill.tap();
		yield* dayDialog.getByText("1 record loaded", { exact: true }).waitFor();
		expect(yield* dayDialog.innerText()).toContain(
			"Period: 2026-09-04 · Time zone: UTC · Active observations only",
		);
		expect(
			yield* dayDialog.getByRole("link", { exact: true, name: fixture.entities.book.name }).count,
		).toBe(1);
		expect(yield* dayDialog.locator("time").getAttribute("datetime")).toBe("2026-09-04");
		yield* page.keyboard.press("Escape");
		yield* dayDialog.waitFor({ state: "hidden" });
		expect(
			yield* dailyDrill.evaluate((button) => button.ownerDocument.activeElement === button),
		).toBe(true);
		yield* page.setViewportSize(desktopViewport);
		yield* trendChart.waitForFunction((image) => image.getBoundingClientRect().height === 280);

		yield* frame
			.getByRole("button", { exact: true, name: "Trend metric: Active observations" })
			.click();
		yield* frame.getByRole("radio", { exact: true, name: "Pages" }).click();
		yield* exactValues.first().click();
		const pagesTable = frame.getByRole("table", {
			exact: true,
			name: "Pages by reporting period exact values",
		});
		yield* pagesTable.waitFor();
		for (const [date, recorded, estimated] of [
			["Sep 2, 2026", 40, 0],
			["Sep 4, 2026", 0, 60],
		] satisfies ReadonlyArray<readonly [string, number, number]>) {
			expect(
				yield* periodRow(pagesTable, currentRange, date).getByRole("cell").nth(1).innerText(),
			).toBe(
				`${recorded + estimated} pages · Known observations · 1 observations · Recorded · ${recorded} pages · Estimated · ${estimated} pages · Missing observations · 0 observations`,
			);
		}
		for (const [date, previousDate] of periodDates) {
			const previousRow = periodRow(pagesTable, previousRange, previousDate);
			expect(yield* previousRow.getByRole("cell").first().innerText()).toBe(
				`${previousRange} · ${previousDate}`,
			);
			expect(yield* previousRow.getByRole("cell").nth(1).innerText()).toMatch(
				/^Not recorded · Known observations · 0 observations/,
			);
			expect(yield* previousRow.getByRole("button").count).toBe(0);
			if (date !== "Sep 2, 2026" && date !== "Sep 4, 2026") {
				const row = periodRow(pagesTable, currentRange, date);
				expect(yield* row.getByRole("cell").nth(1).innerText()).toMatch(/^Not recorded ·/);
				expect(yield* row.getByRole("button").count).toBe(0);
			}
		}
		const exactPages = yield* pagesTable.innerText();
		yield* frame.getByRole("button", { exact: true, name: "Media type: All media types" }).click();
		yield* frame.getByRole("radio", { exact: true, name: "Book" }).click();
		expect(
			yield* frame.getByRole("button", { exact: true, name: "Trend metric: Pages" }).count,
		).toBe(1);
		expect(yield* pagesTable.innerText()).toBe(exactPages);
		yield* frame.getByRole("button", { exact: true, name: "Media type: Book" }).click();
		yield* frame.getByRole("radio", { exact: true, name: "All media types" }).click();
		yield* frame.getByRole("button", { exact: true, name: "Trend metric: Pages" }).click();
		yield* frame.getByRole("radio", { exact: true, name: "Minutes" }).click();
		const minutesTable = frame.getByRole("table", {
			exact: true,
			name: "Minutes by reporting period exact values",
		});
		expect(
			yield* periodRow(minutesTable, currentRange, "Sep 2, 2026")
				.getByRole("cell")
				.nth(1)
				.innerText(),
		).toBe(
			"0 minutes · Known observations · 1 observations · Recorded · 0 minutes · Estimated · 0 minutes · Missing observations · 0 observations",
		);
		expect(
			yield* periodRow(minutesTable, currentRange, "Sep 5, 2026")
				.getByRole("cell")
				.nth(1)
				.innerText(),
		).toBe(
			"Not recorded · Known observations · 0 observations · Recorded · 0 minutes · Estimated · 0 minutes · Missing observations · 1 observations · Partial lower bound",
		);
		expect(
			yield* periodRow(minutesTable, currentRange, "Sep 5, 2026").getByRole("button").count,
		).toBe(0);
		yield* frame.getByRole("button", { exact: true, name: "Trend metric: Minutes" }).click();
		yield* frame.getByRole("radio", { exact: true, name: "Pages" }).click();
		yield* exactValues.first().click();
		yield* pagesTable.waitFor({ state: "hidden" });

		const weekSelection: ReportingSelection = { ...fixture.reportingSelection, grouping: "week" };
		yield* frame.getByRole("button", { exact: true, name: "Group by: Day" }).click();
		yield* frame.getByRole("radio", { exact: true, name: "Week" }).click();
		yield* page.waitForURL((url) => hasAnalyticsLocation(url, weekSelection, section));
		yield* frame.getByRole("button", { exact: true, name: "Group by: Week" }).waitFor();
		const freshMetric = frame.getByRole("button", {
			exact: true,
			name: "Trend metric: Active observations",
		});
		yield* freshMetric.waitFor();
		expect(yield* freshMetric.count).toBe(1);
		yield* freshMetric.click();
		yield* frame.getByRole("radio", { exact: true, name: "Pages" }).click();
		yield* frame.getByRole("img", { exact: true, name: "Pages by reporting period" }).waitFor();
		yield* exactValues.first().click();
		yield* pagesTable.waitForFunction((table) => table.querySelectorAll("tr").length === 5);
		expect(yield* pagesTable.innerText()).toContain(
			"100 pages · Known observations · 2 observations · Recorded · 40 pages · Estimated · 60 pages",
		);
		expect(yield* summary.innerText()).toBe(initialSummary);
		yield* exactValues.first().click();
		yield* pagesTable.waitFor({ state: "hidden" });
		yield* page.goBack();
		yield* page.waitForURL((url) => hasAnalyticsLocation(url, fixture.reportingSelection, section));
		yield* frame.getByRole("button", { exact: true, name: "Group by: Day" }).waitFor();
		yield* freshMetric.waitFor();
		expect(yield* freshMetric.count).toBe(1);
		yield* freshMetric.click();
		yield* frame.getByRole("radio", { exact: true, name: "Pages" }).click();
		yield* frame.getByRole("img", { exact: true, name: "Pages by reporting period" }).waitFor();
		yield* exactValues.first().click();
		yield* pagesTable.waitForFunction((table) => table.querySelectorAll("tr").length === 15);
		expect(yield* pagesTable.innerText()).toBe(exactPages);
		expect(yield* summary.innerText()).toBe(initialSummary);
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("accepts Media ranking records, real source correction, and offline refresh recovery", () =>
	Effect.gen(function* () {
		const { page, frame, summary, context, fixture, section } = yield* openMediaAnalytics();
		const input = {
			now: fixture.now,
			timeZone: fixture.timeZone,
			reference: fixture.reference,
			selection: fixture.reportingSelection,
		};
		const ranking = yield* executeRyotQLRecipe(
			fixture.account.client,
			mediaAnalyticsRankingRecipe(input),
		);
		expect(ranking.pageInfo.hasMore).toBe(false);
		const tiedEntities = [fixture.entities.book, fixture.entities.movie].sort((a, b) =>
			a.id.localeCompare(b.id),
		);
		expect(
			ranking.items.map(({ entityId, activeObservations }) => ({ entityId, activeObservations })),
		).toEqual([
			...tiedEntities.map(({ id }) => ({ entityId: id, activeObservations: 2 })),
			{ activeObservations: 1, entityId: fixture.entities.anime.id },
		]);
		const records = yield* executeRyotQLRecipe(
			fixture.account.client,
			mediaAnalyticsRecordsRecipe(input),
		);
		expect(records.pageInfo.hasMore).toBe(false);
		const activeSourceIds = [0, 1, 2, 3, 5].map((index) =>
			requirePresent(fixture.sourceEventIds[index], "Expected consumption source ID"),
		);
		expect(
			new Set(
				records.items
					.filter(({ contribution }) => contribution.activeObservation)
					.map(({ id }) => id),
			),
		).toEqual(new Set(activeSourceIds));
		expect(records.items.map(({ id }) => id)).not.toContain(fixture.sourceEventIds[4]);
		expect(records.items.every(({ eventType }) => eventType !== "review")).toBe(true);
		expect(new Set(records.items.map(({ id }) => id)).size).toBe(records.items.length);

		const chartsTab = frame.getByRole("tab", { exact: true, name: "Charts" });
		const rankingsTab = frame.getByRole("tab", { exact: true, name: "Rankings" });
		yield* chartsTab.focus();
		yield* chartsTab.press("ArrowRight");
		yield* rankingsTab.waitForFunction((tab) => tab.getAttribute("aria-selected") === "true");
		expect(yield* chartsTab.getAttribute("aria-selected")).toBe("false");
		expect(yield* frame.getByRole("tabpanel").count).toBe(1);
		expect(yield* frame.getByRole("tabpanel").getAttribute("id")).toBe(
			yield* rankingsTab.getAttribute("aria-controls"),
		);
		expect(yield* frame.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
			yield* rankingsTab.getAttribute("id"),
		);
		const rankingTable = frame.getByRole("table", { exact: true, name: "Media entity rankings" });
		yield* rankingTable.waitForFunction((table) => table.querySelectorAll("tbody tr").length === 3);
		expect(yield* rankingTable.getByRole("link").allTextContents()).toEqual(
			ranking.items.map(({ name }) => name),
		);
		for (const [entity, category, observations, titles] of [
			[fixture.entities.book, "Book", 2, 1],
			[fixture.entities.movie, "Movie", 2, 2],
			[fixture.entities.anime, "Anime", 1, 0],
		] satisfies ReadonlyArray<readonly [typeof fixture.entities.book, string, number, number]>) {
			const row = rankingTable.getByRole("row", { name: entity.name });
			expect(yield* row.getByRole("cell").allTextContents()).toEqual([
				entity.name,
				category,
				`${observations} observations`,
				`${titles} titles`,
				"0 episodes",
				"View records",
			]);
			expect(yield* row.getByRole("link").getAttribute("href")).toBe(
				`/e/${encodeURIComponent(entity.id)}`,
			);
		}
		const initialRankings = yield* rankingTable.innerText();

		const bookDrill = rankingTable.getByRole("button", {
			exact: true,
			name: `View records contributing to ${fixture.entities.book.name}`,
		});
		yield* bookDrill.click();
		const dialog = frame.getByRole("dialog");
		yield* dialog.getByText("2 records loaded", { exact: true }).waitFor();
		expect(yield* dialog.count).toBe(1);
		expect(
			yield* dialog.getByText(`${fixture.entities.book.name} · ${currentRange}`, { exact: true })
				.count,
		).toBe(1);
		expect(yield* dialog.innerText()).toContain(
			`Period: ${currentRange} · Time zone: UTC · Type: book · Active observations only`,
		);
		const bookRecords = dialog.getByRole("table", { exact: true, name: "Media analytics records" });
		expect(yield* bookRecords.locator("tbody tr").count).toBe(2);
		for (const [date, recorded, estimated] of [
			["2026-09-02", 40, 0],
			["2026-09-04", 0, 60],
		] satisfies ReadonlyArray<readonly [string, number, number]>) {
			const row = bookRecords.locator(`tbody tr:has(time[datetime="${date}"])`);
			expect(yield* row.count).toBe(1);
			expect(yield* row.locator("time").innerText()).toBe(date);
			expect(yield* row.getByRole("link").getAttribute("href")).toBe(
				`/e/${encodeURIComponent(fixture.entities.book.id)}`,
			);
			expect(yield* row.getByRole("cell").nth(4).innerText()).toContain(
				"Frozen consumption basis: pages · total 100 · source property pages",
			);
			expect(yield* row.getByRole("cell").nth(4).innerText()).toContain(
				`Source calendar date: ${date}`,
			);
			expect(yield* row.getByRole("cell").nth(5).innerText()).toContain(
				`Pages: ${recorded} recorded · ${estimated} estimated · missing: no · superseded estimate: no`,
			);
		}
		expect(
			yield* bookRecords.getByRole("row", { name: "Source progress pages: 40 pages" }).count,
		).toBe(1);
		yield* page.keyboard.press("Escape");
		yield* dialog.waitFor({ state: "hidden" });
		expect(
			yield* bookDrill.evaluate((button) => button.ownerDocument.activeElement === button),
		).toBe(true);

		const allRecordsButton = frame.getByRole("button", { exact: true, name: "All records" });
		yield* allRecordsButton.click();
		yield* dialog.getByText(`${records.items.length} records loaded`, { exact: true }).waitFor();
		expect(yield* dialog.count).toBe(1);
		expect(yield* dialog.getByText(`All records · ${currentRange}`, { exact: true }).count).toBe(1);
		const allRecordsTable = dialog.getByRole("table", {
			exact: true,
			name: "Media analytics records",
		});
		expect(yield* allRecordsTable.locator("tbody tr").count).toBe(records.items.length);
		for (const [index, record] of records.items.entries()) {
			const row = allRecordsTable.locator("tbody tr").nth(index);
			expect(yield* row.getByRole("link").innerText()).toBe(record.name);
			expect(yield* row.getByRole("link").getAttribute("href")).toBe(
				`/e/${encodeURIComponent(record.entityId)}`,
			);
			expect(yield* row.getByRole("cell").nth(2).innerText()).toBe(record.eventType);
			expect(yield* row.locator("time").getAttribute("datetime")).toBe(
				record.contribution.attribution.kind === "unknown"
					? null
					: record.contribution.attribution.value,
			);
		}
		expect(yield* allRecordsTable.getByText("Unknown date", { exact: true }).count).toBe(0);
		expect(yield* allRecordsTable.getByText("review", { exact: true }).count).toBe(0);
		const animeRow = allRecordsTable
			.getByRole("row", { name: fixture.entities.anime.name })
			.filter({ hasText: "item-complete" });
		expect(yield* animeRow.getByRole("cell").nth(2).innerText()).toBe("item-complete");
		expect(yield* animeRow.getByRole("cell").nth(4).innerText()).toContain(
			"Consumed item position: episodes position 7",
		);
		expect(yield* animeRow.getByRole("cell").nth(5).innerText()).toContain("Title completions: 0");
		expect(yield* animeRow.getByRole("cell").nth(5).innerText()).toContain(
			"Episodes: 1 recorded · 0 estimated · missing: no",
		);
		expect(yield* animeRow.getByRole("cell").nth(5).innerText()).not.toContain("7 recorded");
		const movieZeroRow = allRecordsTable.locator(
			'tbody tr:has(time[datetime="2026-09-02T18:00:00.000Z"])',
		);
		expect(yield* movieZeroRow.getByRole("cell").nth(4).innerText()).toContain(
			"Manually recorded time: 0 minutes",
		);
		expect(yield* movieZeroRow.getByRole("cell").nth(5).innerText()).toContain(
			"Minutes: 0 recorded · 0 estimated · missing: no",
		);
		const movieMissingRow = allRecordsTable.locator(
			'tbody tr:has(time[datetime="2026-09-05T18:00:00.000Z"])',
		);
		expect(yield* movieMissingRow.getByRole("cell").nth(5).innerText()).toContain(
			"Minutes: 0 recorded · 0 estimated · missing: yes",
		);
		yield* page.keyboard.press("Escape");
		yield* dialog.waitFor({ state: "hidden" });
		expect(
			yield* allRecordsButton.evaluate((button) => button.ownerDocument.activeElement === button),
		).toBe(true);

		const reviewsBefore = yield* summary
			.getByRole("table", { exact: true, name: "Review count and rating by media category" })
			.innerText();
		const minutesBefore = yield* summaryCoverage(summary, "Minutes").innerText();
		const episodesBefore = yield* summaryCoverage(summary, "Episodes").innerText();
		const progressId = requirePresent(
			fixture.sourceEventIds[0],
			"Expected the book progress source ID",
		);
		const progressSource = requirePresent(
			fixture.sourceEvents[0],
			"Expected the original book progress source",
		);
		yield* fixture.account.client.call((client) =>
			client.events.update({
				params: { eventId: progressId },
				payload: { properties: { remove: [], set: { progressPages: 50 } } },
			}),
		);
		yield* settledHistoryCorrection(fixture.account.client, fixture.account.userId);
		const now = yield* Clock.currentTimeMillis;
		const corrected = yield* waitForMediaConsumptionReport(fixture.account.client, {
			...input,
			now,
		});
		const correctedBook = requireMediaConsumptionGroup(corrected, "book");
		expect(correctedBook).toMatchObject({
			pagesMissing: 0,
			pagesRecorded: 50,
			pagesEstimated: 50,
			titleCompletions: 1,
			activeObservations: 2,
		});
		expect((correctedBook.pagesRecorded ?? 0) + (correctedBook.pagesEstimated ?? 0)).toBe(100);
		for (const mediaType of ["movie", "anime"]) {
			expect(requireMediaConsumptionGroup(corrected, mediaType)).toEqual(
				requireMediaConsumptionGroup(fixture.report, mediaType),
			);
		}
		expect(corrected.previous).toEqual(fixture.report.previous);
		expect(corrected.reviews).toEqual(fixture.report.reviews);
		const correctedRecords = yield* executeRyotQLRecipe(
			fixture.account.client,
			mediaAnalyticsRecordsRecipe({ ...input, now }),
		);
		expect(correctedRecords.items.map(({ id }) => id)).toEqual(records.items.map(({ id }) => id));
		const correctedProgress = requirePresent(
			correctedRecords.items.find(({ id }) => id === progressId),
			"Expected the corrected progress record",
		);
		expect(correctedProgress.facts).toEqual({ ...progressSource.properties, progressPages: 50 });
		expect(correctedProgress.occurredAt).toBe(progressSource.occurredAt);
		expect(correctedProgress.contribution.pages).toMatchObject({
			recorded: 50,
			estimated: 0,
			missing: false,
		});
		expect(
			correctedRecords.items.filter(({ entityId }) => entityId !== fixture.entities.book.id),
		).toEqual(records.items.filter(({ entityId }) => entityId !== fixture.entities.book.id));

		yield* page.reload;
		yield* page.waitForURL((url) => hasAnalyticsLocation(url, fixture.reportingSelection, section));
		const refreshedFrame = analyticsFrame(page);
		const refreshedSummary = refreshedFrame.getByRole("region", {
			exact: true,
			name: "Media analytics summary",
		});
		yield* summaryCoverage(refreshedSummary, "Pages")
			.and(
				refreshedSummary.getByText(
					"Known observations · 2 observations · Recorded · 50 pages · Estimated · 50 pages · Missing observations · 0 observations",
					{ exact: true },
				),
			)
			.waitFor();
		expect(yield* summaryValue(refreshedSummary, "Pages").innerText()).toBe("100 pages");
		expect(yield* summaryValue(refreshedSummary, "Active observations").innerText()).toBe(
			"5 observations",
		);
		expect(yield* summaryValue(refreshedSummary, "Active days").innerText()).toBe("3 days");
		expect(yield* summaryValue(refreshedSummary, "Distinct completed titles").innerText()).toBe(
			"2 titles",
		);
		expect(yield* summaryCoverage(refreshedSummary, "Minutes").innerText()).toBe(minutesBefore);
		expect(yield* summaryCoverage(refreshedSummary, "Episodes").innerText()).toBe(episodesBefore);
		expect(
			yield* refreshedSummary
				.getByRole("table", { exact: true, name: "Review count and rating by media category" })
				.innerText(),
		).toBe(reviewsBefore);
		expect(yield* refreshedSummary.innerText()).toContain("Source average · 40 /100");
		expect(yield* refreshedSummary.innerText()).toContain(
			"Full-history source coverage includes 1 unknown-date observations",
		);
		yield* refreshedFrame
			.getByRole("button", { exact: true, name: "Trend metric: Active observations" })
			.click();
		yield* refreshedFrame.getByRole("radio", { exact: true, name: "Pages" }).click();
		yield* refreshedFrame.getByText("View exact values", { exact: true }).first().click();
		const correctedPagesTable = refreshedFrame.getByRole("table", {
			exact: true,
			name: "Pages by reporting period exact values",
		});
		yield* correctedPagesTable.waitForFunction(
			(table) => table.querySelectorAll("tr").length === 15,
		);
		expect(
			yield* periodRow(correctedPagesTable, currentRange, "Sep 2, 2026")
				.getByRole("cell")
				.nth(1)
				.innerText(),
		).toBe(
			"50 pages · Known observations · 1 observations · Recorded · 50 pages · Estimated · 0 pages · Missing observations · 0 observations",
		);
		expect(
			yield* periodRow(correctedPagesTable, currentRange, "Sep 4, 2026")
				.getByRole("cell")
				.nth(1)
				.innerText(),
		).toBe(
			"50 pages · Known observations · 1 observations · Recorded · 0 pages · Estimated · 50 pages · Missing observations · 0 observations",
		);

		const refreshedRankingsTab = refreshedFrame.getByRole("tab", { exact: true, name: "Rankings" });
		yield* refreshedRankingsTab.click();
		yield* refreshedRankingsTab.waitForFunction(
			(tab) => tab.getAttribute("aria-selected") === "true",
		);
		const refreshedRankingTable = refreshedFrame.getByRole("table", {
			exact: true,
			name: "Media entity rankings",
		});
		yield* refreshedRankingTable.waitForFunction(
			(table) => table.querySelectorAll("tbody tr").length === 3,
		);
		expect(yield* refreshedRankingTable.innerText()).toBe(initialRankings);
		const refreshedBookDrill = refreshedRankingTable.getByRole("button", {
			exact: true,
			name: `View records contributing to ${fixture.entities.book.name}`,
		});
		yield* refreshedBookDrill.click();
		const refreshedDialog = refreshedFrame.getByRole("dialog");
		yield* refreshedDialog.getByText("2 records loaded", { exact: true }).waitFor();
		expect(yield* refreshedDialog.count).toBe(1);
		expect(
			yield* refreshedDialog.getByText(`${fixture.entities.book.name} · ${currentRange}`, {
				exact: true,
			}).count,
		).toBe(1);
		const correctedBookTable = refreshedDialog.getByRole("table", {
			exact: true,
			name: "Media analytics records",
		});
		for (const [date, recorded, estimated] of [
			["2026-09-02", 50, 0],
			["2026-09-04", 0, 50],
		] satisfies ReadonlyArray<readonly [string, number, number]>) {
			const row = correctedBookTable.locator(`tbody tr:has(time[datetime="${date}"])`);
			expect(yield* row.count).toBe(1);
			expect(yield* row.locator("time").innerText()).toBe(date);
			expect(yield* row.getByRole("cell").nth(4).innerText()).toContain(
				"Frozen consumption basis: pages · total 100 · source property pages",
			);
			expect(yield* row.getByRole("cell").nth(5).innerText()).toContain(
				`Pages: ${recorded} recorded · ${estimated} estimated · missing: no`,
			);
		}
		expect(
			yield* correctedBookTable.getByRole("row", { name: "Source progress pages: 50 pages" }).count,
		).toBe(1);
		expect(
			yield* correctedBookTable.getByRole("row", { name: "Source progress pages: 40 pages" }).count,
		).toBe(0);
		yield* page.keyboard.press("Escape");
		yield* refreshedDialog.waitFor({ state: "hidden" });
		expect(
			yield* refreshedBookDrill.evaluate((button) => button.ownerDocument.activeElement === button),
		).toBe(true);

		const retainedRankings = yield* refreshedRankingTable.innerText();
		yield* context.setOffline(true);
		yield* Effect.gen(function* () {
			yield* refreshedFrame
				.getByRole("region", { exact: true, name: "Media rankings" })
				.getByRole("button", { exact: true, name: "Refresh" })
				.click();
			yield* refreshedFrame
				.getByText("The rankings couldn't be refreshed.", { exact: true })
				.waitFor();
			expect(yield* refreshedRankingTable.innerText()).toBe(retainedRankings);
		}).pipe(Effect.ensuring(context.setOffline(false).pipe(Effect.orDie)));
		yield* refreshedFrame.getByRole("button", { exact: true, name: "Try again" }).click();
		yield* refreshedFrame
			.getByText("The rankings couldn't be refreshed.", { exact: true })
			.waitFor({ state: "hidden" });
		expect(yield* refreshedRankingTable.innerText()).toBe(retainedRankings);
		expect(yield* refreshedRankingsTab.getAttribute("aria-selected")).toBe("true");
		expect(yield* summaryValue(refreshedSummary, "Pages").innerText()).toBe("100 pages");
		expect(hasAnalyticsLocation(new URL(page.url()), fixture.reportingSelection, section)).toBe(
			true,
		);
	}).pipe(PlaywrightSpawner.withBrowser),
);
