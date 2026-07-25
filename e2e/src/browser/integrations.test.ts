import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createTestUser } from "~/fixtures/kernel";
import { browserLayer, signInThroughHostedOAuth } from "~/support/browser";
import { beforeAll, expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/frontend";

const SUITE_ID = crypto.randomUUID();

const PROVIDER_NAME = "Kodi";
const INTEGRATION_NAME = `Kodi ${SUITE_ID}`;
const RENAMED_INTEGRATION = `${INTEGRATION_NAME} renamed`;

let email: string;
let password: string;

const settingsSidebar = (page: Playwright.Page) => page.getByTestId("settings-sidebar");

const wizard = (page: Playwright.Page) => page.getByRole("dialog", { name: "Connect a service" });

const integrationRow = (page: Playwright.Page, name: string) =>
	page.getByRole("link", { name: `Open the ${name} integration` });

const openIntegrations = (page: Playwright.Page) =>
	Effect.gen(function* () {
		yield* page.goto(`${getFrontendUrl()}/settings/preferences`);
		yield* settingsSidebar(page).waitFor({ state: "visible" });
		yield* settingsSidebar(page).getByRole("link", { name: "Integrations" }).click();
		yield* page.waitForURL((url) => url.pathname === "/settings/integrations");
		yield* page.getByRole("heading", { level: 1, name: "Integrations" }).waitFor();
	});

const connectKodi = (page: Playwright.Page) =>
	Effect.gen(function* () {
		yield* page.getByRole("button", { name: "Connect a service" }).first().click();
		yield* wizard(page).waitFor({ state: "visible" });
		yield* page.waitForURL((url) => url.searchParams.get("create") === "true");

		yield* wizard(page).getByLabel("Search services").fill(PROVIDER_NAME);
		yield* wizard(page)
			.getByRole("button", { name: `Connect ${PROVIDER_NAME}` })
			.click();
		yield* wizard(page).getByRole("heading", { name: PROVIDER_NAME }).waitFor();

		yield* wizard(page).getByLabel("Name").fill(INTEGRATION_NAME);
		yield* wizard(page).getByRole("button", { name: "Continue" }).click();
		yield* wizard(page).getByRole("button", { name: "Connect", exact: true }).click();
		yield* wizard(page).waitFor({ state: "hidden" });
	});

const withIntegrationsBrowser = <E, R>(run: (page: Playwright.Page) => Effect.Effect<void, E, R>) =>
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

it.live("connects, edits and deletes an integration from settings", () =>
	withIntegrationsBrowser((page) =>
		Effect.gen(function* () {
			yield* openIntegrations(page);
			yield* page.getByText("No integrations yet").waitFor({ state: "visible" });

			yield* connectKodi(page);
			const row = integrationRow(page, INTEGRATION_NAME);
			yield* row.waitFor({ state: "visible" });
			expect(yield* row.innerText()).toContain("Webhook");
			expect(yield* row.innerText()).toContain("Active · Never synced");

			yield* page.getByRole("button", { name: "Sync all integrations" }).click();
			yield* page
				.getByText("Sync started. Updates will appear as integrations finish.")
				.waitFor({ state: "visible" });

			yield* row.click();
			yield* page.waitForURL((url) => url.pathname.startsWith("/settings/integrations/"));
			yield* page.getByRole("heading", { level: 1, name: INTEGRATION_NAME }).waitFor();
			yield* page.getByRole("button", { name: "Copy webhook URL" }).waitFor({ state: "visible" });
			yield* page.getByText("This integration has not run yet.").waitFor({ state: "visible" });

			yield* page.getByLabel("Name").fill(RENAMED_INTEGRATION);
			yield* page.getByRole("button", { name: "Save changes" }).click();
			yield* page.getByRole("heading", { level: 1, name: RENAMED_INTEGRATION }).waitFor();

			yield* page.getByRole("button", { name: "Integration actions" }).click();
			yield* page.getByRole("menuitem", { name: "Delete integration" }).click();
			const confirmation = page.getByRole("dialog");
			yield* confirmation.waitFor({ state: "visible" });
			yield* confirmation.getByRole("button", { name: "Delete integration" }).click();

			yield* page.waitForURL((url) => url.pathname === "/settings/integrations");
			yield* page.getByText("No integrations yet").waitFor({ state: "visible" });
			expect(yield* integrationRow(page, RENAMED_INTEGRATION).count).toBe(0);
		}),
	).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("keeps the wizard in the URL so closing it returns to the list", () =>
	withIntegrationsBrowser((page) =>
		Effect.gen(function* () {
			yield* openIntegrations(page);
			yield* page.getByRole("button", { name: "Connect a service" }).first().click();
			yield* wizard(page).waitFor({ state: "visible" });

			yield* wizard(page).getByLabel("Search services").fill(`nomatch${SUITE_ID}`);
			yield* wizard(page).getByText("Nothing matches that").waitFor({ state: "visible" });

			yield* wizard(page).getByRole("button", { name: "Close the integration wizard" }).click();
			yield* wizard(page).waitFor({ state: "hidden" });
			yield* page.waitForURL((url) => !url.searchParams.has("create"));
		}),
	).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);
