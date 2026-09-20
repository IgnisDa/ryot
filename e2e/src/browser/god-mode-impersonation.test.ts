import { OAUTH_IMPERSONATION_WEB_CLIENT_ID, StoredTokenSet } from "@ryot-app/contract/oauth";
import { Effect, Schema } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createTestUser, refreshImpersonationOAuthTokens } from "~/fixtures/kernel";
import { assertCondition, requirePresent } from "~/support/assertions";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getAdminAccessToken, getFrontendUrl } from "~/support/harness-target";

const viewports = [
	{ label: "desktop", viewport: { width: 1280, height: 800 } },
	{ label: "mobile", viewport: { width: 390, height: 844 } },
] as const;

const openSettingsFromWorkspace = (page: Playwright.Page, frontendUrl: string, isMobile: boolean) =>
	Effect.gen(function* () {
		if (isMobile) {
			yield* page.getByRole("button", { name: "Open navigation" }).click();
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
	it.live(`impersonates a different user from God Mode on ${label}`, () =>
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

			yield* page.goto(`${frontendUrl}/god-mode/users`);
			yield* page.getByLabel("Admin access token").fill(getAdminAccessToken());
			yield* page.getByRole("button", { name: "Unlock God Mode" }).click();
			yield* page.getByRole("heading", { level: 1, name: "Users" }).waitFor({ state: "visible" });
			yield* page.getByLabel("Search users by email").fill(target.email);
			yield* page.getByRole("button", { exact: true, name: "Search" }).click();
			const actions = page.getByRole("button", { name: `Actions for ${target.email}` });
			yield* actions.waitFor({ state: "visible" });
			yield* actions.click();
			yield* page.getByRole("menuitem", { exact: true, name: "Impersonate user" }).click();

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

			const tokenStorageKey = `ryot:oauth:tokens:${new URL(frontendUrl).origin}`;
			const serializedTokenSet = yield* page.evaluate(
				(key) => localStorage.getItem(key),
				tokenStorageKey,
			);
			const tokenSet = yield* Schema.decodeEffect(Schema.fromJsonString(StoredTokenSet))(
				requirePresent(serializedTokenSet, "Impersonation tokens were not stored in this context"),
			);
			assertCondition(
				tokenSet.clientId === OAUTH_IMPERSONATION_WEB_CLIENT_ID,
				"The browser did not store the web impersonation client",
			);
			const refresh = yield* refreshImpersonationOAuthTokens(
				new URL(frontendUrl).origin,
				tokenSet.clientId,
				tokenSet.refreshToken,
			);
			expect(refresh.response.status).toBe(200);
			const refreshedTokens = requirePresent(refresh.tokens, "OAuth refresh returned no tokens");
			const refreshedTokenSet = {
				...tokenSet,
				scope: refreshedTokens.scope,
				tokenType: refreshedTokens.token_type,
				accessToken: refreshedTokens.access_token,
				idToken: refreshedTokens.id_token ?? tokenSet.idToken,
				accessTokenExpiresAt: refreshedTokens.expires_at * 1000,
				refreshToken: refreshedTokens.refresh_token ?? tokenSet.refreshToken,
			};
			const refreshedTokenSetValue = yield* Schema.encodeEffect(
				Schema.fromJsonString(StoredTokenSet),
			)(refreshedTokenSet);
			const documentSentinel = `e2e-document-${crypto.randomUUID()}`;
			yield* siblingPage.evaluate((id) => {
				const sentinel = document.createElement("span");
				sentinel.id = id;
				document.body.append(sentinel);
			}, documentSentinel);
			yield* siblingPage.evaluate(
				({ id, key }) =>
					window.addEventListener("storage", (event) => {
						if (event.key === key) {
							document.getElementById(id)?.setAttribute("data-storage-event", "seen");
						}
					}),
				{ id: documentSentinel, key: tokenStorageKey },
			);
			yield* page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
				key: tokenStorageKey,
				value: refreshedTokenSetValue,
			});
			yield* siblingPage
				.locator(`#${documentSentinel}`)
				.waitForFunction((element) => element.getAttribute("data-storage-event") === "seen");
			expect(
				yield* siblingPage.evaluate(
					(id) => document.getElementById(id)?.isConnected ?? false,
					documentSentinel,
				),
			).toBe(true);
			yield* siblingPage.getByTestId("authenticated-shell").waitFor({ state: "visible" });
			yield* siblingPage.getByTestId("impersonation-banner").waitFor({ state: "visible" });

			yield* page.getByRole("button", { name: "Stop impersonating" }).click();
			yield* page.waitForURL((url) => url.pathname === "/god-mode/users");
			yield* page.getByLabel("Admin access token").waitFor({ state: "visible" });
			expect(yield* page.getByTestId("authenticated-shell").count).toBe(0);
			expect(yield* page.getByTestId("impersonation-banner").count).toBe(0);
			yield* siblingPage.getByTestId("authenticated-shell").waitFor({ state: "hidden" });

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
