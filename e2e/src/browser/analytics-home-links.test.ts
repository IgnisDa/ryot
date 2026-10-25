import { pluginPath, savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import { identityTupleKey } from "@ryot-app/contract/modules/plugins/references";
import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { fitnessPlugin } from "@ryot-app/fitness-plugin";
import { mediaPlugin } from "@ryot-app/media-plugin";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { getUserSettings, updateUserSettingsPreferences } from "~/fixtures/kernel/account";
import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { createEntity } from "~/fixtures/kernel/entities";
import { findBuiltinPluginByPackage } from "~/fixtures/kernel/plugins";
import { deleteUserAndWait } from "~/fixtures/kernel/user-lifecycle";
import { findMediaEntitySchema } from "~/fixtures/plugins/media/entity-schemas";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const iframeSelector = 'main > div:not([aria-hidden="true"]) iframe';
const analyticsPath = savedViewPath({ kind: "kernel", slug: "analytics" });
const cases = [
	{
		section: "media",
		homeTitle: "Media",
		needsLibrary: true,
		contributor: "Media",
		packageId: mediaPlugin.metadata.packageId,
	},
	{
		homeTitle: "Home",
		section: "fitness",
		needsLibrary: false,
		contributor: "Fitness",
		packageId: fitnessPlugin.metadata.packageId,
	},
];

for (const testCase of cases) {
	it.live(`opens kernel Analytics from the active ${testCase.contributor} Home iframe`, () =>
		Effect.gen(function* () {
			const account = yield* createAuthenticatedClient();
			yield* Effect.addFinalizer(() =>
				deleteUserAndWait(account.userId, account.client.target).pipe(Effect.ignore),
			);
			yield* updateUserSettingsPreferences(account.client, {
				reportingTimeZone: TimeZone.make("UTC"),
			});
			expect((yield* getUserSettings(account.client)).preferences.reportingTimeZone).toBe("UTC");
			const installed = yield* findBuiltinPluginByPackage(account.client, {
				scope: "system",
				packageId: testCase.packageId,
			});
			if (testCase.needsLibrary) {
				const { schema, pluginId } = yield* findMediaEntitySchema(account.client, "book");
				expect(pluginId).toBe(installed.pluginId);
				yield* createEntity(account.client, {
					properties: {},
					entitySchema: schema.reference,
					name: `Home analytics link ${crypto.randomUUID()}`,
				});
			}
			const browser = yield* Playwright.Browser;
			const context = yield* browser.newContext({
				timezoneId: "America/New_York",
				viewport: { width: 1280, height: 900 },
			});
			const page = yield* context.newPage;
			const homePath = pluginPath(installed.packageId);
			yield* signInThroughHostedOAuth(page, account.email, account.password, {
				entryPath: homePath,
			});
			yield* page.waitForURL(`${getFrontendUrl()}${homePath}`);
			expect(yield* page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
				"America/New_York",
			);
			const home = page.locator(iframeSelector).contentFrame();
			yield* home
				.getByRole("heading", { level: 1, exact: true, name: testCase.homeTitle })
				.waitFor();
			if (testCase.needsLibrary) {
				yield* home
					.getByRole("status", { exact: true, name: "Loading your media" })
					.waitFor({ state: "hidden" });
				yield* home.locator("main > div").evaluate((body) => {
					body.lastElementChild?.scrollIntoView({ block: "end", behavior: "instant" });
				});
			}
			const link = home.getByRole("link", { exact: true, name: "Analytics" });
			yield* link.waitFor({ state: "visible" });
			expect(yield* link.getAttribute("href")).toBe(analyticsPath);
			yield* link.click();
			yield* page.waitForURL(`${getFrontendUrl()}${analyticsPath}`);
			const iframe = page.locator(iframeSelector);
			const analytics = iframe.contentFrame();
			const controls = analytics.getByRole("region", { exact: true, name: "Analytics controls" });
			yield* analytics.getByRole("heading", { level: 1, exact: true, name: "Analytics" }).waitFor();
			expect(yield* iframe.count).toBe(1);
			expect(yield* iframe.getAttribute("sandbox")).toBe("allow-scripts");
			expect(yield* iframe.getAttribute("src")).toBeNull();
			expect(yield* iframe.getAttribute("srcdoc")).not.toBeNull();
			expect(yield* analytics.getByRole("heading", { level: 1 }).count).toBe(1);
			expect(
				yield* page.getByRole("heading", { level: 1, exact: true, name: "Analytics" }).count,
			).toBe(0);
			yield* controls.getByText("Reporting time zone: UTC", { exact: true }).waitFor();
			const sections = analytics.getByRole("navigation", {
				exact: true,
				name: "Analytics sections",
			});
			expect(
				yield* sections
					.getByRole("button", { exact: true, name: "Collection reviews" })
					.getAttribute("aria-pressed"),
			).toBe("true");
			const contributor = sections.getByRole("button", { exact: true, name: testCase.contributor });
			yield* contributor.waitFor({ state: "visible" });
			expect(yield* contributor.getAttribute("aria-pressed")).toBe("false");
			expect(yield* contributor.isEnabled()).toBe(true);
			yield* contributor.click();
			const section = identityTupleKey(installed.pluginId, testCase.section);
			yield* page.waitForURL(
				(url) => url.pathname === analyticsPath && url.searchParams.get("section") === section,
			);
			yield* contributor.waitForFunction(
				(button) => button.getAttribute("aria-pressed") === "true",
			);
			yield* analytics
				.getByRole("heading", { level: 2, exact: true, name: testCase.contributor })
				.waitFor();
			yield* controls.getByText("Reporting time zone: UTC", { exact: true }).waitFor();
			expect((yield* getUserSettings(account.client)).preferences.reportingTimeZone).toBe("UTC");
		}).pipe(PlaywrightSpawner.withBrowser),
	);
}
