import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createTestUser } from "~/fixtures/kernel";
import { browserLayer, signInThroughHostedOAuth } from "~/support/browser";
import { beforeAll, expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const SUITE_ID = crypto.randomUUID();

const WEBHOOK_URL = `https://discord.com/api/webhooks/1/${SUITE_ID}`;

let email: string;
let password: string;

const settingsSidebar = (page: Playwright.Page) => page.getByTestId("settings-sidebar");

const wizard = (page: Playwright.Page) => page.getByRole("dialog", { name: "Add a channel" });

const openNotificationChannels = (page: Playwright.Page) =>
	Effect.gen(function* () {
		yield* page.goto(`${getFrontendUrl()}/settings/preferences`);
		yield* settingsSidebar(page).waitFor({ state: "visible" });
		yield* settingsSidebar(page).getByRole("link", { name: "Notification channels" }).click();
		yield* page.waitForURL((url) => url.pathname === "/settings/notification-channels");
		yield* page.getByRole("heading", { level: 1, name: "Notification channels" }).waitFor();
	});

const addDiscordChannel = (page: Playwright.Page) =>
	Effect.gen(function* () {
		yield* page.getByRole("button", { name: "Add a channel" }).first().click();
		yield* wizard(page).waitFor({ state: "visible" });
		yield* page.waitForURL((url) => url.searchParams.get("create") === "true");

		yield* wizard(page).getByRole("button", { name: "Add Discord" }).click();
		yield* wizard(page).getByRole("heading", { name: "Discord" }).waitFor();

		yield* wizard(page).getByLabel("Webhook URL").fill(WEBHOOK_URL);
		yield* wizard(page).getByRole("button", { name: "Continue" }).click();
		yield* wizard(page).getByRole("button", { exact: true, name: "Add channel" }).click();
		yield* wizard(page).waitFor({ state: "hidden" });
	});

const withNotificationsBrowser = <E, R>(
	run: (page: Playwright.Page) => Effect.Effect<void, E, R>,
) =>
	Effect.gen(function* () {
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 800 } });
		yield* signInThroughHostedOAuth(page, email, password);
		yield* run(page);
	});

beforeAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const user = yield* createTestUser();
			email = user.email;
			password = user.password;
		}),
	);
});

it.live("adds, pauses, tests and deletes a notification channel", () =>
	withNotificationsBrowser((page) =>
		Effect.gen(function* () {
			yield* openNotificationChannels(page);
			yield* page.getByText("No notification channels yet").waitFor({ state: "visible" });

			yield* addDiscordChannel(page);
			const row = page.getByText("Discord webhook at https://discord.com");
			yield* row.waitFor({ state: "visible" });
			expect(yield* row.innerText()).toContain("Active");

			yield* page
				.getByRole("button", { name: "Send a test notification to every enabled channel" })
				.click();
			yield* page
				.getByText("Test notification queued for 1 enabled channel.")
				.waitFor({ state: "visible" });

			yield* page.getByRole("switch", { name: "Pause the Discord channel" }).click();
			yield* page
				.getByRole("switch", { name: "Enable the Discord channel" })
				.waitFor({ state: "visible" });
			expect(yield* row.innerText()).toContain("Paused");

			yield* page.getByRole("button", { name: "Delete the Discord channel" }).click();
			const confirmation = page.getByRole("dialog");
			yield* confirmation.waitFor({ state: "visible" });
			yield* confirmation.getByRole("button", { name: "Delete channel" }).click();

			yield* page.getByText("No notification channels yet").waitFor({ state: "visible" });
		}),
	).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("hides email behind the SMTP requirement and keeps the wizard in the URL", () =>
	withNotificationsBrowser((page) =>
		Effect.gen(function* () {
			yield* openNotificationChannels(page);
			yield* page.getByRole("button", { name: "Add a channel" }).first().click();
			yield* wizard(page).waitFor({ state: "visible" });

			yield* wizard(page).getByRole("button", { name: "Email is unavailable" }).waitFor();
			yield* wizard(page)
				.getByText("SMTP is not configured on this server.")
				.waitFor({ state: "visible" });

			yield* wizard(page).getByLabel("Search channels").fill(`nomatch${SUITE_ID}`);
			yield* wizard(page).getByText("Nothing matches that").waitFor({ state: "visible" });

			yield* wizard(page)
				.getByRole("button", { name: "Close the notification channel wizard" })
				.click();
			yield* wizard(page).waitFor({ state: "hidden" });
			yield* page.waitForURL((url) => !url.searchParams.has("create"));
		}),
	).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);
