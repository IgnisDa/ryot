import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import {
	installPreferencePrivatePlugin,
	listPluginUserSettings,
} from "~/fixtures/kernel/plugin-user-settings";
import { requirePresent } from "~/support/assertions";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const settingsSidebar = (page: Playwright.Page) => page.getByTestId("settings-sidebar");

const openPluginPreferences = (page: Playwright.Page) =>
	Effect.gen(function* () {
		yield* page.goto(`${getFrontendUrl()}/settings/preferences`);
		yield* settingsSidebar(page).waitFor({ state: "visible" });
		yield* settingsSidebar(page).getByRole("link", { name: "Plugin preferences" }).click();
		yield* page.waitForURL((url) => url.pathname === "/settings/plugin-preferences");
		yield* page.getByRole("heading", { level: 1, name: "Plugin preferences" }).waitFor();
	});

it.live("saves plugin preferences, validates drafts, and guards unsaved navigation", () =>
	Effect.gen(function* () {
		const owner = yield* createAuthenticatedClient();
		const privatePlugin = yield* installPreferencePrivatePlugin({ client: owner.client });
		const outsider = yield* createAuthenticatedClient();
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 800 } });
		yield* signInThroughHostedOAuth(page, owner.email, owner.password);

		yield* page.goto(`${getFrontendUrl()}/settings/preferences`);
		yield* page.getByRole("button", { name: "Entity language: Provider default" }).waitFor();
		expect(yield* page.getByRole("switch", { name: "Show NSFW content" }).count).toBe(0);
		yield* page.getByRole("button", { name: "Entity language: Provider default" }).click();
		yield* page.getByRole("radio", { name: "Spanish" }).click();
		yield* page.getByRole("button", { name: "Save changes" }).click();
		yield* page.getByText("Preferences saved.").waitFor({ state: "visible" });
		yield* page.reload;
		yield* page.getByRole("button", { name: "Entity language: Spanish" }).waitFor();

		yield* openPluginPreferences(page);
		const mediaLink = page.getByRole("link", { name: "Media" });
		yield* mediaLink.click();
		yield* page.waitForURL((url) => /\/settings\/plugin-preferences\/[^/]+$/.test(url.pathname));
		const nsfw = page.getByRole("switch", { name: "Show NSFW content" });
		yield* nsfw.waitFor({ state: "visible" });
		expect(yield* nsfw.getAttribute("aria-checked")).toBe("false");
		yield* nsfw.click();
		yield* page.getByRole("button", { name: "Save changes" }).click();
		yield* page.getByText("Plugin settings saved.").waitFor({ state: "visible" });
		yield* page.reload;
		expect(yield* nsfw.getAttribute("aria-checked")).toBe("true");
		const mediaSetting = requirePresent(
			(yield* listPluginUserSettings(owner.client)).find(({ name }) => name === "Media"),
			"Media settings not found",
		);
		expect(mediaSetting.settings).toEqual({ allowNsfw: true });

		yield* page.getByRole("button", { name: "Reset to defaults" }).click();
		yield* page.getByText("Plugin settings reset to defaults.").waitFor({ state: "visible" });
		yield* page.reload;
		expect(yield* nsfw.getAttribute("aria-checked")).toBe("false");
		expect(
			(yield* listPluginUserSettings(owner.client)).find(({ name }) => name === "Media")?.settings,
		).toEqual({});

		yield* openPluginPreferences(page);
		yield* page.getByRole("link", { name: "Preference test plugin" }).click();
		yield* page.waitForURL((url) => /\/settings\/plugin-preferences\/[^/]+$/.test(url.pathname));
		const enabled = page.getByRole("switch", { name: "Enable reminders" });
		const limit = page.getByRole("textbox", { name: "Reminder limit" });
		expect(yield* enabled.getAttribute("aria-checked")).toBe("false");
		expect(yield* limit.inputValue()).toBe("5");
		yield* enabled.click();
		yield* limit.fill("3");
		yield* page.getByRole("button", { name: "Save changes" }).click();
		yield* page.getByText("Plugin settings saved.").waitFor({ state: "visible" });
		yield* page.reload;
		expect(yield* enabled.getAttribute("aria-checked")).toBe("true");
		expect(yield* limit.inputValue()).toBe("3");

		yield* limit.fill("11");
		yield* page.getByRole("button", { name: "Save changes" }).click();
		yield* page.getByText("Reminder limit is above the maximum").waitFor({ state: "visible" });
		expect(yield* page.getByText("Plugin settings saved.").count).toBe(0);

		yield* settingsSidebar(page).getByRole("link", { name: "Account" }).click();
		const confirmation = page.getByRole("dialog", { name: "Discard unsaved changes?" });
		yield* confirmation.waitFor({ state: "visible" });
		yield* confirmation.getByRole("button", { name: "Cancel" }).click();
		yield* confirmation.waitFor({ state: "hidden" });
		expect(yield* limit.inputValue()).toBe("11");

		yield* settingsSidebar(page).getByRole("link", { name: "Account" }).click();
		yield* confirmation.waitFor({ state: "visible" });
		yield* confirmation.getByRole("button", { name: "Discard changes" }).click();
		yield* page.waitForURL((url) => url.pathname === "/settings/account");
		yield* page.getByRole("heading", { level: 2, name: "Profile" }).waitFor();
		const persistedPrivate = requirePresent(
			(yield* listPluginUserSettings(owner.client)).find(
				({ id }) => id === privatePlugin.setting.id,
			),
			"Private plugin settings not found",
		);
		expect(persistedPrivate.settings).toEqual({ limit: 3, enabled: true });

		const outsiderPage = yield* browser.newPage({ viewport: { width: 1280, height: 800 } });
		yield* signInThroughHostedOAuth(outsiderPage, outsider.email, outsider.password);
		yield* outsiderPage.goto(
			`${getFrontendUrl()}/settings/plugin-preferences/${privatePlugin.setting.id}`,
		);
		yield* outsiderPage.getByText("Plugin preferences not found.").waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);
