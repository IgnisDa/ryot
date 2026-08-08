import { Effect } from "effect";
import { chromium, type Locator } from "playwright";

import {
	createTestUser,
	FIXTURE_CLIENT_REVISION_MARKERS,
	installFixtureClientPlugin,
	makeSession,
	updateFixtureClientPlugin,
} from "~/fixtures/kernel";
import { getApiUrl } from "~/support/api";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/frontend";

const step = async <T>(name: string, run: () => Promise<T>) => {
	try {
		return await run();
	} catch (error) {
		throw new Error(`Browser step failed: ${name}`, { cause: error });
	}
};

const expectVisibleText = async (locator: Locator, text: string) => {
	const match = locator.getByText(text, { exact: true });
	await match.waitFor({ state: "visible" });
	expect(await match.isVisible()).toBe(true);
};

it.live("runs the client plugin lifecycle in a real browser", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const frontendUrl = getFrontendUrl();
		const { cookies, email, password } = yield* createTestUser(apiUrl);
		const client = makeSession(apiUrl, { Cookie: cookies });
		const effectContext = yield* Effect.context();
		yield* installFixtureClientPlugin(client, "A", "", apiUrl);

		yield* Effect.promise(async () => {
			const browser = await chromium.launch();
			const context = await browser.newContext();
			try {
				const page = await context.newPage();
				const frame = page.locator('iframe[title="fixture plugin"]');
				const fixture = page.frameLocator('iframe[title="fixture plugin"]');
				const home = fixture.locator("main");

				await step("onboard and sign in", async () => {
					await page.goto(`${frontendUrl}/fixture`);
					await page.getByText("Self-hosted", { exact: true }).click();
					await page.getByLabel("Server URL").fill(new URL(apiUrl).origin);
					await page.getByRole("button", { name: "Continue" }).click();
					await page.waitForURL((url) => url.pathname === "/auth");
					await page.getByLabel("Email address").fill(email);
					await page.getByLabel("Password").fill(password);
					await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
					await page.waitForURL(`${frontendUrl}/fixture`);
				});

				await step("verify the isolated revision A frame", async () => {
					await frame.waitFor({ state: "visible" });
					expect(await frame.getAttribute("title")).toBe("fixture plugin");
					expect(await frame.getAttribute("sandbox")).toBe("allow-scripts");
					expect(await frame.getAttribute("referrerpolicy")).toBe("no-referrer");
					const artifactUrl = await frame.getAttribute("src");
					expect(artifactUrl?.startsWith(`${apiUrl}/plugins/artifacts/`)).toBe(true);
					expect(artifactUrl?.endsWith("/index.html")).toBe(true);
					await expectVisibleText(home, FIXTURE_CLIENT_REVISION_MARKERS.A);
				});

				await step("use catalog and operation bridges", async () => {
					await expectVisibleText(home, "Installed client plugins: fixture");
					await fixture.getByRole("button", { name: "Refresh catalog" }).click();
					await expectVisibleText(home, "Installed client plugins: fixture");
					await fixture.getByRole("button", { name: "Fetch greeting" }).click();
					await expectVisibleText(home, "Hello, Ryot");
					await fixture.getByRole("button", { name: "Fetch with invalid payload" }).click();
					await expectVisibleText(home, "Greetings are unavailable right now.");
				});

				await step("synchronize theme without resetting Home", async () => {
					await fixture.getByRole("button", { name: "Greet", exact: true }).click();
					await expectVisibleText(home, "Greeted 1 times.");
					const theme = page.getByLabel("Theme");
					await page.emulateMedia({ colorScheme: "dark" });
					await theme.selectOption("light");
					await expectVisibleText(home, "Resolved mode: light");
					await theme.selectOption("dark");
					await expectVisibleText(home, "Resolved mode: dark");
					await theme.selectOption("system");
					await expectVisibleText(home, "Resolved mode: dark");
					await page.emulateMedia({ colorScheme: "light" });
					await expectVisibleText(home, "Resolved mode: light");
					expect(page.url()).toBe(`${frontendUrl}/fixture`);
					await expectVisibleText(home, "Greeted 1 times.");
				});

				const navigationFrame = await frame.elementHandle();
				expect(navigationFrame).not.toBeNull();
				await step("navigate while preserving the iframe", async () => {
					await fixture.getByRole("link", { name: "Item 1 details" }).click();
					await page.waitForURL(`${frontendUrl}/fixture/details/item-1?tab=stats`);
					await expectVisibleText(fixture.locator("main"), "Item item-1, tab stats.");
					expect(
						await frame.evaluate((current, initial) => current === initial, navigationFrame),
					).toBe(true);

					await page.goBack();
					await page.waitForURL(`${frontendUrl}/fixture`);
					await expectVisibleText(home, "Greeted 0 times.");
					expect(
						await frame.evaluate((current, initial) => current === initial, navigationFrame),
					).toBe(true);

					await page.goForward();
					await page.waitForURL(`${frontendUrl}/fixture/details/item-1?tab=stats`);
					await expectVisibleText(fixture.locator("main"), "Item item-1, tab stats.");
					expect(
						await frame.evaluate((current, initial) => current === initial, navigationFrame),
					).toBe(true);

					await fixture.getByRole("button", { name: "Back" }).click();
					await page.waitForURL(`${frontendUrl}/fixture`);
					await expectVisibleText(home, "Greeted 0 times.");
					expect(
						await frame.evaluate((current, initial) => current === initial, navigationFrame),
					).toBe(true);
				});

				await step("recover from a plugin crash", async () => {
					await fixture.getByRole("button", { name: "Crash during render" }).click();
					await expectVisibleText(page.locator("body"), "This plugin stopped working.");
					const reload = page.getByRole("button", { name: "Reload plugin" });
					await reload.waitFor({ state: "visible" });
					await reload.click();
					await frame.waitFor({ state: "visible" });
					await expectVisibleText(home, FIXTURE_CLIENT_REVISION_MARKERS.A);
					await expectVisibleText(home, "Greeted 0 times.");
					expect(
						await frame.evaluate((current, initial) => current === initial, navigationFrame),
					).toBe(false);
				});

				await step("replace the frame from the live revision event", async () => {
					await fixture.getByRole("button", { name: "Greet", exact: true }).click();
					await expectVisibleText(home, "Greeted 1 times.");
					const revisionAArtifact = await frame.getAttribute("src");
					const outerUrl = page.url();
					expect(revisionAArtifact).not.toBeNull();
					await frame.evaluate((element) => element.setAttribute("data-e2e-revision", "A"));

					await Effect.runPromiseWith(effectContext)(
						updateFixtureClientPlugin(client, "B", "", apiUrl),
					);
					await expectVisibleText(home, FIXTURE_CLIENT_REVISION_MARKERS.B);
					await expectVisibleText(home, "Revision B is active.");
					const revisionBArtifact = await frame.getAttribute("src");
					expect(revisionBArtifact).not.toBe(revisionAArtifact);
					expect(await frame.getAttribute("data-e2e-revision")).toBeNull();
					expect(page.url()).toBe(outerUrl);
					await expectVisibleText(home, "Greeted 0 times.");
				});
			} finally {
				try {
					await context.close();
				} finally {
					await browser.close();
				}
			}
		});
	}),
);
