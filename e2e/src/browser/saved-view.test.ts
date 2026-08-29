import { Effect } from "effect";
import { chromium } from "playwright";

import { createSavedView, createTestUser, makeSession } from "~/fixtures/kernel";
import { getApiUrl } from "~/support/api";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/frontend";

const ADD_LOG = "TODO: open the provider add flow";

it.live("swaps the saved-view add affordance between viewports and answers its shortcuts", () =>
	Effect.gen(function* () {
		const { email, token, password } = yield* createTestUser();
		const client = makeSession(getApiUrl(), { Authorization: `Bearer ${token}` });
		const view = yield* createSavedView(client, { name: `Browser View ${crypto.randomUUID()}` });

		yield* Effect.promise(async () => {
			const frontendUrl = getFrontendUrl();
			const browser = await chromium.launch();
			const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
			try {
				const page = await context.newPage();
				await page.goto(`${frontendUrl}/auth`);
				await page.waitForURL((url) => url.pathname === "/oauth/login");
				await page.getByLabel("Email address").fill(email);
				await page.getByLabel("Password").fill(password);
				await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
				await page.getByTestId("authenticated-shell").waitFor({ state: "visible" });

				await page.goto(`${frontendUrl}/v/${view.slug}`);
				const fab = page.getByRole("button", { name: "Add to this view" });
				const headerAdd = page.getByRole("button", { name: "Add", exact: true });
				await headerAdd.waitFor({ state: "visible" });
				expect(await fab.isVisible()).toBe(false);

				const clicked = page.waitForEvent("console", (message) => message.text() === ADD_LOG);
				await headerAdd.click();
				await clicked;

				const pressed = page.waitForEvent("console", (message) => message.text() === ADD_LOG);
				await page.keyboard.press("a");
				await pressed;

				await page.keyboard.press("/");
				expect(await page.evaluate(() => document.activeElement?.getAttribute("type"))).toBe(
					"search",
				);

				await page.setViewportSize({ width: 480, height: 900 });
				await fab.waitFor({ state: "visible" });
				expect(await headerAdd.isVisible()).toBe(false);
			} finally {
				await context.close();
				await browser.close();
			}
		});
	}),
);
