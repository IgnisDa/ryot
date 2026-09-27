import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createTestUser, generateTotpCode } from "~/fixtures/kernel";
import { signInThroughHostedOAuth } from "~/support/browser";
import { it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const twoFactorSection = (page: Playwright.Page) =>
	page
		.getByRole("heading", { level: 2, name: "Two-factor authentication" })
		.locator("xpath=ancestor::section[1]");

const openManagement = (page: Playwright.Page, email: string, password: string) =>
	Effect.gen(function* () {
		yield* twoFactorSection(page).getByRole("link", { name: "Manage" }).click();
		yield* page.waitForURL((url) => url.pathname === "/oauth/two-factor");
		yield* page.getByLabel("Email address").fill(email);
		yield* page.getByLabel("Password").fill(password);
		yield* page.getByRole("button", { exact: true, name: "Sign in" }).click();
	});

const returnToSettings = (page: Playwright.Page, status: "On" | "Off") =>
	Effect.gen(function* () {
		yield* page.getByRole("button", { exact: true, name: "Done" }).click();
		yield* page.waitForURL((url) => url.pathname === "/settings/account");
		yield* twoFactorSection(page).getByText(status, { exact: true }).waitFor({ state: "visible" });
	});

it.live("enrolls and removes an authenticator app from account settings", () =>
	Effect.gen(function* () {
		const { email, password } = yield* createTestUser();
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 800 } });
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/settings/account`);
		yield* twoFactorSection(page).getByText("Off", { exact: true }).waitFor({ state: "visible" });

		yield* openManagement(page, email, password);
		const setup = page.getByRole("button", { name: "Set up authenticator app" });
		yield* setup.waitFor({ state: "visible" });
		yield* page.getByLabel("Password").fill(password);
		yield* setup.click();
		yield* page
			.getByRole("img", { name: "QR code for your authenticator app" })
			.waitFor({ state: "visible" });
		const secret = yield* page.getByLabel("Setup key").innerText();
		yield* page.getByLabel("Authenticator code").fill(generateTotpCode(secret));
		yield* page.getByRole("button", { name: "Turn on two-factor authentication" }).click();
		yield* page
			.getByRole("list", { name: "Backup codes" })
			.getByRole("listitem")
			.first()
			.waitFor({ state: "visible" });
		yield* returnToSettings(page, "On");

		yield* openManagement(page, email, password);
		const challenge = page.getByLabel("Authenticator code");
		yield* challenge.waitFor({ state: "visible" });
		yield* challenge.fill(generateTotpCode(secret));
		yield* page.getByRole("button", { exact: true, name: "Verify" }).click();
		yield* page.getByRole("button", { name: "Disable two-factor authentication" }).click();
		yield* page.getByLabel("Password").fill(password);
		yield* page.getByRole("button", { name: "Turn off two-factor authentication" }).click();
		yield* page.getByText("Two-factor authentication is off.").waitFor({ state: "visible" });
		yield* returnToSettings(page, "Off");
	}).pipe(PlaywrightSpawner.withBrowser),
);
