import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createTestUser } from "~/fixtures/kernel";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const settingsSidebar = (page: Playwright.Page) => page.getByTestId("settings-sidebar");

it.live("keeps account and server-wide sections on their own pages", () =>
	Effect.gen(function* () {
		const { email, password } = yield* createTestUser();
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 800 } });
		yield* signInThroughHostedOAuth(page, email, password);

		yield* page.goto(`${getFrontendUrl()}/settings`);
		yield* page.waitForURL((url) => url.pathname === "/settings/preferences");
		yield* settingsSidebar(page).getByRole("link", { name: "Account" }).click();
		yield* page.waitForURL((url) => url.pathname === "/settings/account");
		yield* page.getByRole("heading", { level: 2, name: "Profile" }).waitFor();
		expect(yield* page.getByRole("heading", { name: "Version" }).count).toBe(0);
		expect(yield* page.getByRole("link", { name: /God Mode/ }).count).toBe(0);

		yield* settingsSidebar(page).getByRole("link", { name: "About" }).click();
		yield* page.waitForURL((url) => url.pathname === "/settings/about");
		yield* page
			.getByRole("heading", { level: 2, name: "Version" })
			.locator("xpath=ancestor::section[1]")
			.getByText("Server", { exact: true })
			.waitFor({ state: "visible" });

		yield* settingsSidebar(page).getByRole("link", { name: "Administration" }).click();
		yield* page.waitForURL((url) => url.pathname === "/settings/administration");
		yield* page.getByRole("link", { name: /God Mode/ }).click();
		yield* page.waitForURL((url) => url.pathname.startsWith("/god-mode"));
	}).pipe(PlaywrightSpawner.withBrowser),
);
