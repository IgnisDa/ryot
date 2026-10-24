import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { getUserSettings } from "~/fixtures/kernel/account";
import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { pollUntil } from "~/fixtures/kernel/polling";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const reportingTimeZone = (page: Playwright.Page) =>
	page.getByRole("textbox", { name: "Reporting time zone" });

const waitForReportingTimeZone = (
	client: Parameters<typeof getUserSettings>[0],
	timeZone: string,
) =>
	pollUntil(
		`reporting time zone initialization to ${timeZone}`,
		getUserSettings(client).pipe(
			Effect.map(({ preferences }) =>
				preferences.reportingTimeZone === timeZone ? preferences.reportingTimeZone : null,
			),
		),
	);

it.live("keeps the reporting time zone after travel and rejects invalid preferences", () =>
	Effect.gen(function* () {
		const owner = yield* createAuthenticatedClient();
		const browser = yield* Playwright.Browser;
		const home = getFrontendUrl();
		const firstContext = yield* browser.newContext({
			timezoneId: "America/New_York",
			viewport: { width: 1280, height: 800 },
		});
		const firstPage = yield* firstContext.newPage;
		yield* signInThroughHostedOAuth(firstPage, owner.email, owner.password);
		expect(yield* firstPage.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
			"America/New_York",
		);
		yield* waitForReportingTimeZone(owner.client, "America/New_York");

		yield* firstPage.goto(`${home}/settings/preferences`);
		const firstZone = reportingTimeZone(firstPage);
		yield* firstZone.waitFor({ state: "visible" });
		expect(yield* firstZone.inputValue()).toBe("America/New_York");
		yield* firstZone.fill("Asia/Kolkata");
		yield* firstPage.getByRole("button", { name: "Save changes" }).click();
		yield* firstPage.getByText("Preferences saved.", { exact: true }).waitFor({ state: "visible" });
		expect((yield* getUserSettings(owner.client)).preferences.reportingTimeZone).toBe(
			"Asia/Kolkata",
		);

		const secondContext = yield* browser.newContext({
			timezoneId: "Pacific/Auckland",
			viewport: { width: 1280, height: 800 },
		});
		const secondPage = yield* secondContext.newPage;
		yield* signInThroughHostedOAuth(secondPage, owner.email, owner.password);
		expect(yield* secondPage.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
			"Pacific/Auckland",
		);
		yield* secondPage.goto(`${home}/settings/preferences`);
		const secondZone = reportingTimeZone(secondPage);
		yield* secondZone.waitFor({ state: "visible" });
		expect(yield* secondZone.inputValue()).toBe("Asia/Kolkata");
		expect((yield* getUserSettings(owner.client)).preferences.reportingTimeZone).toBe(
			"Asia/Kolkata",
		);

		yield* secondZone.fill("Not/AZone");
		yield* secondPage
			.getByText("Enter a valid IANA time zone.", { exact: true })
			.waitFor({ state: "visible" });
		const save = secondPage.getByRole("button", { name: "Save changes" });
		expect(yield* save.isDisabled()).toBe(true);
		expect((yield* getUserSettings(owner.client)).preferences.reportingTimeZone).toBe(
			"Asia/Kolkata",
		);
	}).pipe(PlaywrightSpawner.withBrowser),
);
