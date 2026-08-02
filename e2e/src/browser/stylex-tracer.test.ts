import { mkdir } from "node:fs/promises";
/* oxlint-disable perfectionist/sort-objects -- Keep browser evidence grouped by behavior. */
import { fileURLToPath } from "node:url";

import { Effect, Option } from "effect";
import { chromium, Playwright, PlaywrightSpawner, webkit } from "effect-playwright";

import { createTestUser, makeSession } from "~/fixtures/kernel";
import { installStylexTracerPlugin } from "~/fixtures/plugins/stylex-tracer";
import { requirePresent } from "~/support/assertions";
import { signInThroughHostedOAuth } from "~/support/browser";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";
import { getApiUrl, getFrontendUrl } from "~/support/harness-target";

const enabled = process.env.RUN_STYLEX_TRACER_E2E === "1";
const screenshotRoot = fileURLToPath(
	new URL("../../../plugins/stylex-tracer/evidence/screenshots/", import.meta.url),
);
const engines = [
	{ name: "chromium", screenshots: true, layer: PlaywrightSpawner.layer(chromium) },
	{ name: "webkit", screenshots: false, layer: PlaywrightSpawner.layer(webkit) },
] as const;

let credentials: { readonly email: string; readonly password: string };
const productionOutcomes: Array<{
	readonly engine: string;
	readonly browserVersion: string;
	readonly userAgent: string;
	readonly assertions: readonly string[];
}> = [];

// Browsers expose no option for nonzero safe-area env values. Patch only the shell's hidden
// platform detector so the production detector -> shell -> plugin bridge path remains intact.
const injectPlatformSafeAreaDetector = (page: Playwright.Page) =>
	page.addInitScript(() => {
		const original = window.getComputedStyle.bind(window);
		window.getComputedStyle = (element, pseudoElement) => {
			const style = original(element, pseudoElement);
			if (
				element instanceof HTMLElement &&
				element.getAttribute("aria-hidden") === "true" &&
				element.style.width === "0px" &&
				element.style.cssText.includes("env(safe-area-inset-top)")
			) {
				return new Proxy(style, {
					get: (target, property, receiver) => {
						if (property === "paddingTop") {
							return "13px";
						}
						if (property === "paddingBottom") {
							return "17px";
						}
						return Reflect.get(target, property, receiver);
					},
				});
			}
			return style;
		};
	});

const observeBridge = (page: Playwright.Page) =>
	page.addInitScript(() => {
		Reflect.set(globalThis, "stylexTracerBridgeInitializations", 0);
		window.addEventListener("message", (event) => {
			if (event.ports.length === 1) {
				const count = Reflect.get(globalThis, "stylexTracerBridgeInitializations");
				Reflect.set(
					globalThis,
					"stylexTracerBridgeInitializations",
					typeof count === "number" ? count + 1 : 1,
				);
			}
		});
	});

const waitForFonts = (root: Playwright.Page | Playwright.FrameLocator) =>
	root.locator("body").evaluate(async () => {
		await document.fonts.ready;
		await Promise.all([
			document.fonts.load('16px "Outfit Variable"', "StyleX tracer"),
			document.fonts.load('16px "Lora Variable"', "StyleX tracer"),
		]);
	});

const assertPanelBehavior = (
	page: Playwright.Page,
	root: Playwright.Page | Playwright.FrameLocator,
	expectedLayout: "compact" | "wide",
) =>
	Effect.gen(function* () {
		const panel = root.getByTestId("stylex-tracer-panel");
		const name = root.getByLabel("Name");
		const progress = root.getByRole("progressbar", { name: "Tracer progress" });
		const advance = root.getByRole("button", { name: "Advance progress" });
		const detailsButton = root.getByRole("button", { name: "Details" });
		yield* panel.waitFor({ state: "visible" });
		expect(yield* panel.getAttribute("data-layout")).toBe(expectedLayout);
		expect(yield* name.inputValue()).toBe("Ryot");
		expect(yield* name.getAttribute("aria-invalid")).toBeNull();
		expect(yield* progress.getAttribute("aria-valuenow")).toBe("35");

		const initial = yield* panel.evaluate((element) => {
			const advanceButton = Array.from(element.querySelectorAll("button")).find(
				(button) => button.textContent.trim() === "Advance progress",
			);
			const heading = element.querySelector("h2");
			const style = getComputedStyle(element);
			const buttonStyle = advanceButton ? getComputedStyle(advanceButton) : null;
			return {
				color: buttonStyle?.color,
				paddingTop: style.paddingTop,
				paddingBottom: style.paddingBottom,
				background: buttonStyle?.backgroundColor,
				font: heading ? getComputedStyle(heading).fontFamily : "",
			};
		});
		expect(initial).toMatchObject({
			paddingTop: "37px",
			paddingBottom: "41px",
			color: "rgb(255, 247, 251)",
			background: "rgb(143, 63, 113)",
		});
		expect(initial.font).toContain("Lora Variable");
		yield* name.focus();
		const focusedField = yield* name.evaluate((element) => {
			const style = getComputedStyle(element);
			const placeholder = getComputedStyle(element, "::placeholder");
			return {
				border: style.borderColor,
				outline: style.outlineColor,
				placeholderColor: placeholder.color,
				placeholderOpacity: placeholder.opacity,
			};
		});
		expect(focusedField).toMatchObject({
			border: "rgb(37, 99, 235)",
			outline: "rgb(37, 99, 235)",
			placeholderColor: "rgb(107, 101, 91)",
			placeholderOpacity: "0.72",
		});
		yield* page.emulateMedia({ reducedMotion: "reduce" });
		expect(
			Number.parseFloat(
				yield* progress
					.locator("div")
					.evaluate((element) => getComputedStyle(element).transitionDuration),
			),
		).toBeLessThanOrEqual(0.000_01);
		expect(
			Number.parseFloat(
				yield* advance.evaluate((element) => getComputedStyle(element).transitionDuration),
			),
		).toBeLessThanOrEqual(0.000_01);
		yield* page.emulateMedia({ reducedMotion: "no-preference" });

		const dynamicCssBefore = yield* progress.evaluate(() => ({
			styles: document.querySelectorAll("style").length,
			rules: Array.from(document.styleSheets).reduce((total, sheet) => {
				try {
					return total + sheet.cssRules.length;
				} catch {
					return total;
				}
			}, 0),
		}));
		const widthBefore = yield* progress
			.locator("div")
			.evaluate((element) => Number.parseFloat(getComputedStyle(element).width));
		yield* advance.click();
		expect(yield* progress.getAttribute("aria-valuenow")).toBe("42");
		let widthAfter = widthBefore;
		for (let attempt = 0; attempt < 20 && widthAfter <= widthBefore; attempt += 1) {
			yield* Effect.sleep("25 millis");
			widthAfter = yield* progress
				.locator("div")
				.evaluate((element) => Number.parseFloat(getComputedStyle(element).width));
		}
		expect(widthAfter).toBeGreaterThan(widthBefore);
		expect(
			yield* progress.evaluate(() => ({
				styles: document.querySelectorAll("style").length,
				rules: Array.from(document.styleSheets).reduce((total, sheet) => {
					try {
						return total + sheet.cssRules.length;
					} catch {
						return total;
					}
				}, 0),
			})),
		).toEqual(dynamicCssBefore);

		yield* name.fill("");
		expect(yield* name.getAttribute("aria-invalid")).toBe("true");
		yield* root.getByRole("alert").waitFor({ state: "visible" });
		expect(yield* advance.isDisabled()).toBe(true);
		yield* name.fill("Ryot");
		for (let index = 0; index < 9; index += 1) {
			yield* advance.click();
		}
		expect(yield* progress.getAttribute("aria-valuenow")).toBe("100");
		expect(yield* advance.isDisabled()).toBe(true);
		yield* root.getByRole("button", { name: "Reset" }).click();
		expect(yield* name.inputValue()).toBe("Ryot");
		expect(yield* progress.getAttribute("aria-valuenow")).toBe("35");

		yield* detailsButton.click();
		const details = root.getByRole("dialog", { name: "Tracer details" });
		yield* details.waitFor({ state: "visible" });
		expect(
			yield* details.evaluate((element) => {
				const panelElement = document.querySelector('[data-testid="stylex-tracer-panel"]');
				const portalRoot = element.parentElement;
				const style = getComputedStyle(element);
				return {
					color: style.color,
					background: style.backgroundColor,
					theme: portalRoot?.dataset.stylexTracerTheme,
					outside: panelElement !== null && !panelElement.contains(element),
				};
			}),
		).toMatchObject({ outside: true, theme: "light", background: "rgb(255, 255, 255)" });
		yield* page.keyboard.press("Escape");
		yield* details.waitFor({ state: "hidden" });
		expect(yield* detailsButton.evaluate((element) => element === document.activeElement)).toBe(
			true,
		);
	});

describe.skipIf(!enabled)("StyleX tracer browser verification", () => {
	beforeAll(async () => {
		expect(process.env.E2E_FRONTEND_ASSET_MODE).toBe("production");
		expect(process.env.E2E_FRONTEND_INDEX_SHA256).toMatch(/^[a-f0-9]{64}$/);
		expect(process.env.E2E_BACKEND_PROCESS_ID).toMatch(/^\d+$/);
		console.log(
			JSON.stringify({
				assetMode: process.env.E2E_FRONTEND_ASSET_MODE,
				backendProcessId: process.env.E2E_BACKEND_PROCESS_ID,
				frontendIndexSha256: process.env.E2E_FRONTEND_INDEX_SHA256,
			}),
		);
		const apiUrl = getApiUrl();
		await mkdir(screenshotRoot, { recursive: true });
		const user = await Effect.runPromise(createTestUser(apiUrl));
		credentials = user;
		const client = makeSession(apiUrl, { Authorization: `Bearer ${user.token}` });
		await Effect.runPromise(installStylexTracerPlugin(client, apiUrl));
	});
	afterAll(async () => {
		const evidencePath = process.env.STYLEX_TRACER_PRODUCTION_EVIDENCE;
		if (evidencePath === undefined) {
			return;
		}
		const sourceManifest = JSON.parse(process.env.E2E_STYLEX_SOURCE_MANIFEST ?? "null");
		expect(sourceManifest?.sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(productionOutcomes.map(({ engine }) => engine).sort()).toEqual(["chromium", "webkit"]);
		await Bun.write(
			evidencePath,
			`${JSON.stringify(
				{
					generatedAt: new Date().toISOString(),
					baselineHead: process.env.E2E_STYLEX_BASELINE_HEAD,
					assetMode: process.env.E2E_FRONTEND_ASSET_MODE,
					backendProcessId: process.env.E2E_BACKEND_PROCESS_ID,
					frontendIndexSha256: process.env.E2E_FRONTEND_INDEX_SHA256,
					sourceManifest,
					commands: {
						build:
							"RYOT_STYLEX_TRACER=1 bun turbo build --env-mode=loose --force --filter=@ryot-app/kernel-client --filter=@ryot-app/stylex-tracer-plugin",
						test:
							process.env.STYLEX_TRACER_PRODUCTION_COMMAND ??
							"RUN_STYLEX_TRACER_E2E=1 bun turbo --env-mode=loose --force --output-logs=full --filter=@ryot-app/e2e test --only -- 'src/browser/stylex-tracer.test.ts'",
					},
					engines: productionOutcomes,
					status: "PASS",
					qualification:
						"Playwright WebKit is browser-engine evidence, not Safari application or iOS device evidence",
				},
				null,
				2,
			)}\n`,
		);
	});

	for (const engine of engines) {
		it.live(`verifies kernel and archived plugin behavior in ${engine.name}`, () =>
			Effect.gen(function* () {
				const frontendUrl = getFrontendUrl();
				const browser = yield* Playwright.Browser;
				const page = yield* browser.newPage({
					colorScheme: "light",
					viewport: { width: 1280, height: 900 },
				});
				const userAgent = yield* page.evaluate(() => navigator.userAgent);
				const browserVersion =
					(engine.name === "chromium"
						? /(?:HeadlessChrome|Chrome)\/([^ ]+)/.exec(userAgent)?.[1]
						: /Version\/([^ ]+)/.exec(userAgent)?.[1]) ?? "unknown";
				expect(browserVersion).not.toBe("unknown");
				yield* injectPlatformSafeAreaDetector(page);
				yield* observeBridge(page);
				yield* signInThroughHostedOAuth(page, credentials.email, credentials.password, {
					entryPath: "/stylex-tracer-kernel",
				});
				yield* page.waitForURL(`${frontendUrl}/stylex-tracer-kernel`);
				expect(yield* page.locator("html").getAttribute("data-theme")).toBeNull();
				const kernelPanel = page.getByTestId("stylex-tracer-panel");
				yield* assertPanelBehavior(page, page, "wide");
				yield* waitForFonts(page);
				if (engine.screenshots) {
					yield* page.screenshot({
						fullPage: true,
						path: `${screenshotRoot}kernel-desktop-light.png`,
					});
				}

				yield* page.getByLabel("Name").fill("Preserved kernel");
				yield* page.getByRole("button", { name: "Advance progress" }).click();
				yield* page.getByRole("button", { name: "Details" }).click();
				const kernelDetails = page.getByRole("dialog", { name: "Tracer details" });
				yield* kernelDetails.waitFor({ state: "visible" });
				yield* page.emulateMedia({ colorScheme: "dark" });
				yield* page
					.getByText("Resolved theme: dark", { exact: false })
					.waitFor({ state: "visible" });
				expect(yield* page.getByLabel("Name").inputValue()).toBe("Preserved kernel");
				expect(yield* page.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("42");
				expect(yield* kernelDetails.isVisible()).toBe(true);
				expect(
					yield* kernelDetails.evaluate(
						(element) => element.parentElement?.dataset.stylexTracerTheme,
					),
				).toBe("dark");
				expect(
					yield* kernelPanel.evaluate((element) => getComputedStyle(element).backgroundColor),
				).toBe("rgb(33, 31, 27)");
				yield* page.keyboard.press("Escape");
				yield* kernelDetails.waitFor({ state: "hidden" });
				yield* page.setViewportSize({ width: 390, height: 844 });
				yield* page.getByText("Layout: compact", { exact: false }).waitFor({ state: "visible" });
				yield* page.setViewportSize({ width: 1280, height: 900 });
				yield* page.getByText("Layout: wide", { exact: false }).waitFor({ state: "visible" });
				if (engine.screenshots) {
					yield* page.screenshot({
						fullPage: true,
						path: `${screenshotRoot}kernel-desktop-dark.png`,
					});
				}

				yield* page.emulateMedia({ colorScheme: "light" });
				yield* page.goto(`${frontendUrl}/stylex-tracer`, { waitUntil: "commit" });
				const frame = page.locator('iframe[title="stylex-tracer plugin"]');
				yield* frame.waitFor({ state: "visible" });
				expect(yield* frame.getAttribute("sandbox")).toBe("allow-scripts");
				expect(yield* frame.getAttribute("referrerpolicy")).toBe("no-referrer");
				const artifactUrl = requirePresent(
					yield* frame.getAttribute("src"),
					"StyleX tracer artifact URL is missing",
				);
				expect(new URL(artifactUrl).pathname).toMatch(
					/^\/api\/client-pages\/artifacts\/[A-Za-z0-9_-]{43}\/index\.html$/,
				);
				const plugin = frame.contentFrame();
				const pluginBackground = plugin.locator('[data-stylex-document="tracer"]');
				yield* assertPanelBehavior(page, plugin, "wide");
				yield* frame.evaluate((element) =>
					element.setAttribute("data-stylex-tracer-e2e", "mounted"),
				);
				expect(
					yield* plugin
						.locator("body")
						.evaluate(() => Reflect.get(globalThis, "stylexTracerBridgeInitializations")),
				).toBe(1);

				yield* frame.evaluate((element) => {
					element.style.width = "360px";
					element.style.maxWidth = "360px";
				});
				expect(Option.getOrThrow(yield* frame.boundingBox()).width).toBeLessThanOrEqual(360);
				expect(yield* plugin.getByTestId("stylex-tracer-panel").getAttribute("data-layout")).toBe(
					"wide",
				);
				yield* frame.evaluate((element) => {
					element.style.removeProperty("width");
					element.style.removeProperty("max-width");
				});

				const artifactEvidence = yield* plugin.locator("body").evaluate(async () => {
					const image = document.querySelector("img");
					const documentRoot = document.querySelector('[data-stylex-document="tracer"]');
					const badge = Array.from(document.querySelectorAll("div")).find(
						(element) => element.textContent.trim() === "Archive-local token",
					);
					const stylesheets = Array.from(
						document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
					);
					const stylesheetContents = await Promise.all(
						stylesheets.map(async ({ href }) => {
							const response = await fetch(href);
							return response.text();
						}),
					);
					const css = stylesheetContents.join("\n");
					const routingWrapper = document.querySelector<HTMLElement>('[style*="var(--bg)"]');
					return {
						css,
						documents: document.querySelectorAll('[data-stylex-document="tracer"]').length,
						imageComplete: image?.complete,
						imageWidth: image?.naturalWidth,
						imagePath: image ? new URL(image.currentSrc).pathname : "",
						badgeStyle: badge
							? {
									background: getComputedStyle(badge).backgroundColor,
									color: getComputedStyle(badge).color,
								}
							: null,
						documentStyle: documentRoot
							? {
									background: getComputedStyle(documentRoot).backgroundColor,
									color: getComputedStyle(documentRoot).color,
									font: getComputedStyle(documentRoot).fontFamily,
								}
							: null,
						routingWrapper: routingWrapper
							? {
									computedBackground: getComputedStyle(routingWrapper).backgroundColor,
									inlineBackground: routingWrapper.style.background,
								}
							: null,
					};
				});
				expect(artifactEvidence.imageComplete).toBe(true);
				expect(artifactEvidence.imageWidth).toBeGreaterThan(0);
				expect(artifactEvidence.documents).toBe(1);
				expect(artifactEvidence.imagePath).toMatch(/\/[A-Za-z0-9_-]+\.svg$/);
				expect(artifactEvidence.documentStyle).toMatchObject({
					color: "rgb(37, 34, 29)",
					background: "rgb(245, 242, 235)",
				});
				expect(artifactEvidence.documentStyle?.font).toContain("Outfit Variable");
				expect(artifactEvidence.routingWrapper).toEqual({
					computedBackground: "rgba(0, 0, 0, 0)",
					inlineBackground: "var(--bg)",
				});
				expect(artifactEvidence.badgeStyle).toEqual({
					color: "rgb(216, 255, 243)",
					background: "rgb(23, 63, 53)",
				});
				expect(artifactEvidence.css).toContain("font-family");
				expect(artifactEvidence.css).toContain("background-color");
				expect(artifactEvidence.css).toContain("color:");
				expect(artifactEvidence.css).not.toMatch(
					/tailwind|preflight|theme\.css|palette\.css|--color-|--bg:|--accent:/i,
				);

				yield* plugin.getByLabel("Name").fill("Preserved plugin");
				yield* plugin.getByRole("button", { name: "Advance progress" }).click();
				yield* plugin.getByRole("button", { name: "Details" }).click();
				const mountedDetails = plugin.getByRole("dialog", { name: "Tracer details" });
				yield* mountedDetails.waitFor({ state: "visible" });
				expect(
					yield* pluginBackground.evaluate((element) => element.closest("[inert]") !== null),
				).toBe(true);
				expect(
					yield* mountedDetails.evaluate((element) => element.closest("[inert]") === null),
				).toBe(true);
				yield* page.emulateMedia({ colorScheme: "dark" });
				yield* plugin
					.getByText("Resolved theme: dark", { exact: false })
					.waitFor({ state: "visible" });
				expect(yield* frame.getAttribute("data-stylex-tracer-e2e")).toBe("mounted");
				expect(yield* plugin.getByLabel("Name").inputValue()).toBe("Preserved plugin");
				expect(yield* plugin.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("42");
				expect(yield* mountedDetails.isVisible()).toBe(true);
				expect(
					yield* mountedDetails.evaluate(
						(element) => element.parentElement?.dataset.stylexTracerTheme,
					),
				).toBe("dark");
				expect(
					yield* plugin
						.getByTestId("stylex-tracer-panel")
						.evaluate((element) => getComputedStyle(element).backgroundColor),
				).toBe("rgb(33, 31, 27)");
				yield* mountedDetails.getByRole("button", { name: "Close details" }).click();
				yield* mountedDetails.waitFor({ state: "hidden" });
				expect(
					yield* pluginBackground.evaluate((element) => element.closest("[inert]") === null),
				).toBe(true);
				expect(
					yield* plugin
						.getByRole("button", { name: "Details" })
						.evaluate((element) => element === document.activeElement),
				).toBe(true);

				yield* page.setViewportSize({ width: 390, height: 844 });
				yield* plugin.getByText("Layout: compact", { exact: false }).waitFor({ state: "visible" });
				if (engine.screenshots) {
					yield* waitForFonts(plugin);
					yield* page.emulateMedia({ colorScheme: "light" });
					yield* plugin
						.getByText("Resolved theme: light", { exact: false })
						.waitFor({ state: "visible" });
					yield* page.screenshot({
						fullPage: true,
						path: `${screenshotRoot}plugin-mobile-light.png`,
					});
					yield* page.emulateMedia({ colorScheme: "dark" });
					yield* plugin
						.getByText("Resolved theme: dark", { exact: false })
						.waitFor({ state: "visible" });
					yield* page.screenshot({
						fullPage: true,
						path: `${screenshotRoot}plugin-mobile-dark.png`,
					});
				}

				yield* plugin.getByRole("button", { name: "Details" }).click();
				const darkDetails = plugin.getByRole("dialog", { name: "Tracer details" });
				yield* darkDetails.waitFor({ state: "visible" });
				expect(
					yield* pluginBackground.evaluate((element) => element.closest("[inert]") !== null),
				).toBe(true);
				expect(
					yield* darkDetails.evaluate((element) => ({
						theme: element.parentElement?.dataset.stylexTracerTheme,
						color: getComputedStyle(element).color,
						background: getComputedStyle(element).backgroundColor,
					})),
				).toEqual({ theme: "dark", color: "rgb(245, 241, 232)", background: "rgb(42, 39, 34)" });
				yield* page.goto(`${frontendUrl}/stylex-tracer-kernel`);
				expect(yield* page.locator('iframe[title="stylex-tracer plugin"]').count).toBe(0);
				expect(yield* page.getByTestId("stylex-tracer-details").count).toBe(0);

				yield* page.goBack({ waitUntil: "commit" });
				yield* page.waitForURL(`${frontendUrl}/stylex-tracer`);
				const reenteredFrame = page.locator('iframe[title="stylex-tracer plugin"]');
				yield* reenteredFrame.waitFor({ state: "visible" });
				const reentered = reenteredFrame.contentFrame();
				expect(yield* reentered.getByLabel("Name").inputValue()).toBe("Ryot");
				expect(yield* reentered.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("35");
				expect(yield* reentered.getByTestId("stylex-tracer-details").count).toBe(0);
				const reenteredBackground = reentered.locator('[data-stylex-document="tracer"]');
				expect(yield* reenteredBackground.count).toBe(1);
				expect(
					yield* reenteredBackground.evaluate((element) => element.closest("[inert]") === null),
				).toBe(true);
				expect(yield* reenteredFrame.getAttribute("src")).not.toBe(artifactUrl);
				expect(yield* reenteredFrame.getAttribute("data-stylex-tracer-e2e")).toBeNull();
				expect(
					yield* reentered
						.locator("body")
						.evaluate(() => Reflect.get(globalThis, "stylexTracerBridgeInitializations")),
				).toBe(1);
				productionOutcomes.push({
					engine: engine.name,
					browserVersion,
					userAgent,
					assertions: [
						"production asset attestation",
						"kernel render and interaction",
						"permitted override and focus",
						"theme change with portal open",
						"archived plugin artifact and CSS",
						"plugin lifecycle re-entry",
					],
				});
			}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(engine.layer)),
		);
	}
});
