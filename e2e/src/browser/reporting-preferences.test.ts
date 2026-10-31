import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const reportingTimeZone = (page: Playwright.Page) =>
	page.getByRole("textbox", { name: "Reporting time zone" });

it.live("stores the sign-up device zone and keeps it after travel", () =>
	Effect.gen(function* () {
		const browser = yield* Playwright.Browser;
		const home = getFrontendUrl();
		const email = `reporting-${yield* randomUuid}@example.com`;
		const password = "password123";
		const firstContext = yield* browser.newContext({
			timezoneId: "America/New_York",
			viewport: { width: 1280, height: 800 },
		});
		const firstPage = yield* firstContext.newPage;
		yield* firstPage.goto(`${home}/auth`);
		yield* firstPage.waitForURL((url) => url.pathname === "/oauth/login");
		yield* firstPage
			.getByRole("group", { name: "Authentication mode" })
			.getByRole("button", { exact: true, name: "Sign up" })
			.click();
		yield* firstPage.getByLabel("Email address").fill(email);
		yield* firstPage.getByLabel("Password").fill(password);
		yield* firstPage.getByRole("button", { exact: true, name: "Create account" }).click();
		yield* firstPage.getByTestId("authenticated-shell").waitFor({ state: "visible" });

		yield* firstPage.goto(`${home}/settings/preferences`);
		const firstZone = reportingTimeZone(firstPage);
		yield* firstZone.waitFor({ state: "visible" });
		expect(yield* firstZone.inputValue()).toBe("America/New_York");
		yield* firstZone.fill("Asia/Kolkata");
		yield* firstPage.getByRole("button", { name: "Save changes" }).click();
		yield* firstPage.getByText("Preferences saved.", { exact: true }).waitFor({ state: "visible" });

		const secondContext = yield* browser.newContext({
			timezoneId: "Pacific/Auckland",
			viewport: { width: 1280, height: 800 },
		});
		const secondPage = yield* secondContext.newPage;
		yield* signInThroughHostedOAuth(secondPage, email, password);
		yield* secondPage.goto(`${home}/settings/preferences`);
		const secondZone = reportingTimeZone(secondPage);
		yield* secondZone.waitFor({ state: "visible" });
		expect(yield* secondZone.inputValue()).toBe("Asia/Kolkata");

		yield* secondZone.fill("Not/AZone");
		yield* secondPage
			.getByText("Enter a valid IANA time zone.", { exact: true })
			.waitFor({ state: "visible" });
		expect(yield* secondPage.getByRole("button", { name: "Save changes" }).isDisabled()).toBe(true);
	}).pipe(PlaywrightSpawner.withBrowser),
);
