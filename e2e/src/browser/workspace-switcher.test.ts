import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createTestUser } from "~/fixtures/kernel";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";

it.live("opens the desktop workspace switcher with its keyboard shortcut", () =>
	Effect.gen(function* () {
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		const { email, password } = yield* createTestUser();
		yield* signInThroughHostedOAuth(page, email, password);

		const sidebar = page.getByTestId("desktop-sidebar");
		const shortcut = "Mod+Shift+Space";
		const trigger = sidebar.getByRole("button", { name: /workspace,/ });
		expect(yield* trigger.getAttribute("aria-keyshortcuts")).toBe(shortcut);
		const primaryModifier = yield* page.evaluate(() =>
			/Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control",
		);
		expect(yield* trigger.getByText("Space", { exact: true }).isVisible()).toBe(true);
		if (primaryModifier === "Meta") {
			expect(yield* trigger.locator('[data-app-icon="command"]').isVisible()).toBe(true);
		} else {
			expect(yield* trigger.getByText("Ctrl", { exact: true }).isVisible()).toBe(true);
			expect(yield* trigger.locator('[data-app-icon="command"]').count).toBe(0);
		}
		expect(yield* trigger.locator('[data-app-icon="arrow-big-up"]').isVisible()).toBe(true);

		yield* page.keyboard.press(`${primaryModifier}+Shift+Space`);

		const menu = sidebar.getByRole("menu", { name: "Workspaces" });
		yield* menu.waitFor({ state: "visible" });
		const currentWorkspace = menu.getByRole("menuitemradio", { checked: true });
		expect(yield* currentWorkspace.evaluate((element) => document.activeElement === element)).toBe(
			true,
		);

		yield* page.keyboard.press(`${primaryModifier}+Shift+Space`);
		expect(yield* menu.isVisible()).toBe(true);

		yield* page.keyboard.press("Escape");
		yield* menu.waitFor({ state: "hidden" });
	}).pipe(PlaywrightSpawner.withBrowser),
);
