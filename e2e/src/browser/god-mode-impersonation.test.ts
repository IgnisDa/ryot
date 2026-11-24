import { BROWSER_SESSION_PATH } from "@ryot-app/contract/oauth";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createTestUser } from "~/fixtures/kernel";
import { pluginFrame, signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getAdminAccessToken, getFrontendUrl } from "~/support/harness-target";

const viewports = [
	{ label: "desktop", viewport: { width: 1280, height: 800 } },
	{ label: "mobile", viewport: { width: 390, height: 844 } },
] as const;

const openSettingsFromWorkspace = (page: Playwright.Page, frontendUrl: string, isMobile: boolean) =>
	Effect.gen(function* () {
		if (isMobile) {
			yield* pluginFrame(page).getByRole("button", { name: "Open navigation" }).click();
			yield* page.getByTestId("mobile-drawer").getByRole("link", { name: "Open settings" }).click();
		} else {
			yield* page.getByRole("link", { name: "Open settings" }).click();
		}
		yield* page.waitForURL((url) => url.pathname === "/settings");
		yield* page.goto(`${frontendUrl}/settings/account`);
		yield* page.getByRole("heading", { level: 2, name: "Profile" }).waitFor();
	});

const expectAccount = (page: Playwright.Page, email: string) =>
	Effect.gen(function* () {
		yield* page.getByRole("heading", { level: 2, name: "Profile" }).waitFor();
		yield* page
			.getByTestId("shell-content")
			.getByText(email, { exact: true })
			.waitFor({ state: "visible" });
	});

for (const { label, viewport } of viewports) {
	it.live(`impersonates a different user from Instance Admin on ${label}`, () =>
		Effect.gen(function* () {
			const operator = yield* createTestUser();
			const target = yield* createTestUser();
			expect(operator.userId).not.toBe(target.userId);
			const browser = yield* Playwright.Browser;
			const context = yield* browser.newContext({ viewport });
			const page = yield* context.newPage;
			const frontendUrl = getFrontendUrl();
			const isMobile = viewport.width <= 390;

			yield* signInThroughHostedOAuth(page, operator.email, operator.password);
			yield* page.goto(`${frontendUrl}/settings/account`);
			yield* expectAccount(page, operator.email);
			const siblingPage = yield* context.newPage;
			yield* siblingPage.goto(`${frontendUrl}/settings/account`);
			yield* expectAccount(siblingPage, operator.email);

			yield* page.goto(`${frontendUrl}/instance-admin/users`);
			yield* page.getByLabel("Admin access token").fill(getAdminAccessToken());
			yield* page.getByRole("button", { name: "Unlock Instance Admin" }).click();
			yield* page.getByRole("heading", { level: 1, name: "Users" }).waitFor({ state: "visible" });
			yield* page.getByLabel("Search users by email").fill(target.email);
			yield* page.getByRole("button", { exact: true, name: "Search" }).click();
			const actions = page.getByRole("button", { name: `Actions for ${target.email}` });
			yield* actions.waitFor({ state: "visible" });
			yield* actions.click();
			yield* page.getByRole("menuitem", { exact: true, name: "Impersonate user" }).click();
			const impersonationLink = page.getByLabel("Impersonation link", { exact: true });
			yield* impersonationLink.waitFor({ state: "visible" });
			yield* page.goto(yield* impersonationLink.inputValue());

			const shell = page.getByTestId("authenticated-shell");
			const banner = page.getByRole("status").and(page.getByTestId("impersonation-banner"));
			yield* shell.waitFor({ state: "visible" });
			yield* banner.waitFor({ state: "visible" });
			expect(yield* banner.innerText()).toContain(
				`Impersonating Test User (${target.email}) until`,
			);

			yield* page.reload;
			yield* shell.waitFor({ state: "visible" });
			yield* banner.waitFor({ state: "visible" });
			yield* openSettingsFromWorkspace(page, frontendUrl, isMobile);
			yield* expectAccount(page, target.email);
			yield* banner.waitFor({ state: "visible" });

			yield* siblingPage.goto(frontendUrl);
			yield* siblingPage.getByTestId("authenticated-shell").waitFor({ state: "visible" });
			yield* siblingPage.getByTestId("impersonation-banner").waitFor({ state: "visible" });
			expect(yield* siblingPage.getByTestId("impersonation-banner").innerText()).toContain(
				target.email,
			);
			yield* openSettingsFromWorkspace(siblingPage, frontendUrl, isMobile);
			yield* expectAccount(siblingPage, target.email);

			const cookies = yield* page.use((browserPage) => browserPage.context().cookies());
			expect(cookies.find(({ name }) => name.endsWith("ryot-session"))).toMatchObject({
				httpOnly: true,
				sameSite: "Lax",
			});
			expect(
				yield* page.evaluate(() =>
					Object.keys(localStorage).some((key) => key.startsWith("ryot:oauth:tokens:")),
				),
			).toBe(false);

			const rejected = yield* page.use((browserPage) =>
				browserPage.request.delete(new URL(BROWSER_SESSION_PATH, frontendUrl).toString(), {
					headers: { origin: "https://other.example.test" },
				}),
			);
			expect(rejected.status()).toBe(403);
			yield* expectAccount(page, target.email);

			yield* page.getByRole("button", { name: "Stop impersonating" }).click();
			yield* page.waitForURL((url) => url.pathname === "/instance-admin/users");
			yield* page.getByLabel("Admin access token").waitFor({ state: "visible" });
			expect(yield* page.getByTestId("authenticated-shell").count).toBe(0);
			expect(yield* page.getByTestId("impersonation-banner").count).toBe(0);
			yield* siblingPage.getByTestId("authenticated-shell").waitFor({ state: "hidden" });
			yield* siblingPage.waitForURL((url) => url.pathname === "/oauth/login");

			yield* signInThroughHostedOAuth(siblingPage, target.email, target.password);
			expect(yield* siblingPage.getByTestId("impersonation-banner").count).toBe(0);
			yield* siblingPage.reload;
			yield* siblingPage.getByTestId("authenticated-shell").waitFor({ state: "visible" });
			expect(yield* siblingPage.getByTestId("impersonation-banner").count).toBe(0);
			yield* siblingPage.goto(`${frontendUrl}/settings/account`);
			yield* expectAccount(siblingPage, target.email);
			expect(yield* siblingPage.getByText(operator.email, { exact: true }).count).toBe(0);
			expect(new URL(siblingPage.url()).pathname).toBe("/settings/account");
		}).pipe(PlaywrightSpawner.withBrowser),
	);
}
