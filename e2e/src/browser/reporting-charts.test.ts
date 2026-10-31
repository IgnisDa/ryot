import { pluginPath } from "@ryot-app/contract/modules/plugins/navigation";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	createAuthenticatedClient,
	installPrivatePluginPackage,
	settledPrivateInstallation,
} from "~/fixtures/kernel";
import { reportingChartsPluginPackage } from "~/fixtures/kernel/reporting-charts";
import { activePluginIframe, signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const visualCases = [
	{ name: "desktop", compact: "wide", viewport: { width: 1280, height: 800 } },
	{ name: "compact", compact: "compact", viewport: { width: 390, height: 844 } },
] as const;

it.live("renders reporting charts in the isolated plugin document across visual modes", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const installation = yield* installPrivatePluginPackage({
			client,
			config: {},
			pluginPackage: yield* reportingChartsPluginPackage(),
		});
		const installed = yield* settledPrivateInstallation(client, installation.id);
		const fixturePath = pluginPath(installed.packageId);
		const fixtureUrl = `${getFrontendUrl()}${fixturePath}`;
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ hasTouch: true, viewport: { width: 1280, height: 800 } });
		yield* signInThroughHostedOAuth(page, email, password, { entryPath: fixturePath });
		yield* page.goto(fixtureUrl);

		const iframe = activePluginIframe(page);
		const frame = iframe.contentFrame();
		yield* frame
			.getByRole("heading", { level: 1, exact: true, name: "Reporting charts" })
			.waitFor();
		expect(yield* iframe.getAttribute("sandbox")).toBe("allow-scripts");
		expect(yield* iframe.getAttribute("srcdoc")).not.toBeNull();
		expect(yield* iframe.getAttribute("src")).toBeNull();

		const trend = frame.getByRole("region", { name: "Period trend chart" });
		const histogram = frame.getByRole("region", { name: "Hourly histogram chart" });
		const trendChart = trend.getByRole("img", { name: "Period trend" });
		const histogramChart = histogram.getByRole("img", { name: "Hourly histogram" });
		yield* trendChart.waitFor({ state: "visible" });
		yield* histogramChart.waitFor({ state: "visible" });

		for (const visualCase of visualCases) {
			yield* page.setViewportSize(visualCase.viewport);
			for (const colorScheme of ["light", "dark"] as const) {
				for (const reducedMotion of ["reduce", "no-preference"] as const) {
					yield* page.use((nativePage) => nativePage.emulateMedia({ colorScheme, reducedMotion }));
					yield* frame
						.getByText(`Viewport: ${visualCase.compact}`, { exact: true })
						.waitFor({ state: "visible" });
					const media = yield* frame.locator("body").evaluate((body) => {
						const view = body.ownerDocument.defaultView;
						return {
							dark: view?.matchMedia("(prefers-color-scheme: dark)").matches,
							reduced: view?.matchMedia("(prefers-reduced-motion: reduce)").matches,
						};
					});
					expect(media).toEqual({
						dark: colorScheme === "dark",
						reduced: reducedMotion === "reduce",
					});
					const hostOverflow = yield* page.evaluate(
						() => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
					);
					const pluginOverflow = yield* frame
						.locator("html")
						.evaluate(
							(documentElement) => documentElement.scrollWidth <= documentElement.clientWidth,
						);
					expect(hostOverflow).toBe(true);
					expect(pluginOverflow).toBe(true);
				}
			}
		}

		yield* page.setViewportSize({ width: 1280, height: 800 });
		yield* page.use((nativePage) =>
			nativePage.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" }),
		);
		yield* trend.getByText("Current period · Sep 1–3, 2026", { exact: true }).waitFor();
		yield* trend.getByText("Previous period · Aug 1–3, 2026", { exact: true }).waitFor();
		const trendDisplay = trend.getByRole("radiogroup", { name: "Period trend display" });
		const histogramDisplay = histogram.getByRole("radiogroup", {
			name: "Hourly histogram display",
		});
		yield* trendDisplay.getByRole("radio", { name: "Table" }).click();
		yield* trendChart.waitFor({ state: "detached" });
		const trendTable = trend.getByRole("table", { name: "Period trend exact values" });
		expect(yield* trendTable.getByRole("columnheader").allInnerTexts()).toEqual([
			"Period",
			"Current period · Sep 1–3, 2026",
			"Previous period · Aug 1–3, 2026",
		]);
		const trendValues = yield* trendTable.innerText();
		expect(trendValues).toContain("Sep 1, 2026");
		expect(trendValues).toContain("0 entries");
		expect(trendValues).toContain("Recorded");
		expect(trendValues).toContain("4 entries");
		expect(trendValues).toContain("Estimated");
		expect(trendValues).toContain("Not recorded");
		expect(trendValues).toContain("Missing");
		expect(trendValues).toContain("Aug 1, 2026");
		expect(trendValues).toContain("2 entries");
		expect(trendValues).toContain("1 entry");
		expect(trendValues).toContain("3 entries");
		const missingTrendRow = trendTable.getByRole("row").filter({ hasText: "Sep 3, 2026" });
		expect(yield* missingTrendRow.count).toBe(1);
		expect(yield* missingTrendRow.getByRole("button").count).toBe(1);
		expect(
			yield* missingTrendRow.getByRole("button", {
				exact: true,
				name: "View records: Aug 3, 2026 · 3 entries",
			}).count,
		).toBe(1);
		yield* histogramDisplay.getByRole("radio", { name: "Table" }).click();
		yield* histogramChart.waitFor({ state: "detached" });
		const histogramTable = histogram.getByRole("table", { name: "Hourly histogram exact values" });
		expect(yield* histogramTable.getByRole("row").count).toBe(25);
		expect(
			yield* histogramTable.getByRole("row").filter({ hasText: "08:00–09:00" }).innerText(),
		).toMatch(/4 entries\s+Recorded/);
		expect(
			yield* histogramTable.getByRole("row").filter({ hasText: "12:00–13:00" }).innerText(),
		).toMatch(/0 entries\s+Recorded/);
		expect(
			yield* histogramTable.getByRole("row").filter({ hasText: "18:00–19:00" }).innerText(),
		).toMatch(/Not recorded\s+Missing/);

		const selection = frame.getByLabel("Selected chart point");
		yield* trendDisplay.getByRole("radio", { name: "Chart" }).click();
		yield* trendTable.waitFor({ state: "detached" });
		yield* trendChart.focus();
		yield* trendChart.press("ArrowRight");
		yield* frame
			.getByRole("status", { includeHidden: true })
			.getByText(/4 entries · Estimated/)
			.waitFor({ state: "visible" });
		yield* trendChart.press("ArrowRight");
		yield* frame
			.getByRole("status", { includeHidden: true })
			.getByText(/Not recorded · Missing/)
			.waitFor({ state: "visible" });
		yield* frame
			.getByRole("status", { includeHidden: true })
			.getByText("3 entries", { exact: true })
			.waitFor({ state: "visible" });
		yield* trendChart.press("Enter");
		yield* selection.getByText(/previous.*2026-08-03.*3 entries/).waitFor({ state: "visible" });
		yield* trendDisplay.getByRole("radio", { name: "Table" }).click();
		yield* trendTable
			.getByRole("button", { exact: true, name: "View records: Aug 1, 2026 · 2 entries" })
			.click();
		yield* selection.getByText(/previous.*2026-08-01.*2 entries/).waitFor({ state: "visible" });
		yield* trendDisplay.getByRole("radio", { name: "Chart" }).click();

		const zeroPointPosition = yield* trendChart.evaluate((svg) => {
			const point = [...svg.querySelectorAll(".ts-chart__dot")].at(-1)?.querySelector("circle");
			if (!point) {
				throw new Error("Expected the recorded zero SVG point");
			}
			const pointBounds = point.getBoundingClientRect();
			const chartBounds = svg.getBoundingClientRect();
			return {
				y: pointBounds.top + pointBounds.height / 6 - chartBounds.top,
				x: pointBounds.left + (pointBounds.width * 2) / 3 - chartBounds.left,
			};
		});
		// The SVG owns selection; its focus ring can cover the point after pointer movement.
		yield* trendChart.click({ position: zeroPointPosition });
		yield* selection.getByText(/current.*2026-09-01.*0 entries/).waitFor({ state: "visible" });
		yield* page.setViewportSize({ width: 390, height: 844 });
		yield* page.use((nativePage) =>
			nativePage.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" }),
		);
		yield* frame.getByText("Viewport: compact", { exact: true }).waitFor({ state: "visible" });
		yield* histogramDisplay.getByRole("radio", { name: "Table" }).click();
		yield* histogramTable
			.getByRole("button", { exact: true, name: "View records: 08:00–09:00 · 4 entries" })
			.tap();
		yield* selection.getByText(/08:00.*4 entries/).waitFor({ state: "visible" });

		const noRecordedValues = "No recorded values in this period.";
		yield* frame.getByRole("button", { name: "Show empty data" }).click();
		yield* histogram.getByText(noRecordedValues, { exact: true }).waitFor();
		expect(yield* frame.getByText(noRecordedValues, { exact: true }).count).toBe(2);
		expect(yield* trendDisplay.count).toBe(0);
		expect(yield* histogramDisplay.count).toBe(0);
		yield* frame.getByRole("button", { name: "Show single value" }).click();
		yield* trendDisplay.getByRole("radio", { name: "Table" }).click();
		const singleTrendTable = trend.getByRole("table", { name: "Period trend exact values" });
		expect(yield* singleTrendTable.getByRole("columnheader").allInnerTexts()).toEqual([
			"Period",
			"Value",
		]);
		expect(
			yield* singleTrendTable.getByRole("row").filter({ hasText: "Sep 1, 2026" }).innerText(),
		).toMatch(/4 entries\s+Estimated/);
		yield* histogramDisplay.getByRole("radio", { name: "Table" }).click();
		expect(
			yield* histogram
				.getByRole("table", { name: "Hourly histogram exact values" })
				.getByRole("row")
				.filter({ hasText: "08:00–09:00" })
				.innerText(),
		).toMatch(/4 entries\s+Estimated/);
		yield* frame.getByRole("button", { name: "Show zero-only data" }).click();
		const nothingRecorded = "Nothing recorded in this period.";
		yield* histogram.getByText(nothingRecorded, { exact: true }).waitFor();
		expect(yield* frame.getByText(nothingRecorded, { exact: true }).count).toBe(2);
		expect(yield* frame.getByRole("table").count).toBe(0);
		expect(yield* trendDisplay.count).toBe(0);
		expect(yield* histogramDisplay.count).toBe(0);
		yield* frame.getByRole("button", { name: "Show missing-only data" }).click();
		yield* histogram.getByText(noRecordedValues, { exact: true }).waitFor();
		expect(yield* frame.getByText(noRecordedValues, { exact: true }).count).toBe(2);
		expect(yield* trendDisplay.count).toBe(0);
		expect(yield* histogramDisplay.count).toBe(0);
	}).pipe(PlaywrightSpawner.withBrowser),
);
