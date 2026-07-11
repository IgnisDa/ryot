import { Effect } from "effect";
import type { Playwright } from "effect-playwright";
import { PlaywrightSpawner, chromium } from "effect-playwright";

import { getFrontendUrl } from "~/support/harness-target";

type BrowserSignInOptions = {
	readonly entryPath?: string;
	readonly captureHistory?: boolean;
};

export const browserLayer = PlaywrightSpawner.layer(chromium);

export const signInThroughHostedOAuth = (
	page: Playwright.Page,
	email: string,
	password: string,
	options: BrowserSignInOptions = {},
) =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		yield* page.goto(`${frontendUrl}${options.entryPath ?? "/auth"}`);
		yield* page.waitForURL((url) => url.pathname === "/oauth/login");
		yield* page.getByLabel("Email address").fill(email);
		yield* page.getByLabel("Password").fill(password);
		const historyLengthBeforeSubmit = options.captureHistory
			? yield* page.evaluate(() => history.length)
			: undefined;
		yield* page.getByRole("button", { name: "Sign in", exact: true }).last().click();
		yield* page.getByTestId("authenticated-shell").waitFor({ state: "visible" });
		const homePath = yield* page
			.getByRole("link", { name: "Home", exact: true })
			.getAttribute("href");
		return { historyLengthBeforeSubmit, homeUrl: new URL(homePath ?? "/", frontendUrl).toString() };
	});
