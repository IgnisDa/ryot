import { OAUTH_WEB_CLIENT_ID } from "@ryot/contract/oauth";
import { Effect } from "effect";
import { chromium } from "playwright";

import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/frontend";

it.live("signs up through the hosted OAuth flow", () =>
	Effect.promise(async () => {
		const frontendUrl = getFrontendUrl();
		const browser = await chromium.launch();
		const context = await browser.newContext();
		try {
			const page = await context.newPage();
			const hostedLoginRequest = page.waitForRequest(
				(request) => new URL(request.url()).pathname === "/oauth/login",
			);
			await page.goto(`${frontendUrl}/auth`);
			const loginRequest = await hostedLoginRequest;
			expect(new URL(loginRequest.url()).searchParams.get("client_id")).toBe(OAUTH_WEB_CLIENT_ID);
			await page.waitForURL((url) => url.pathname === "/oauth/login");

			const mode = page.getByRole("group", { name: "Authentication mode" });
			await mode.getByRole("button", { name: "Sign up", exact: true }).click();
			await page
				.getByLabel("Email address")
				.fill(`browser-signup-${crypto.randomUUID()}@example.com`);
			await page.getByLabel("Password").fill("password123");
			const signupRequest = page.waitForRequest(
				(request) => new URL(request.url()).pathname === "/api/auth/sign-up/email",
			);
			const tokenResponse = page.waitForResponse(
				(response) => new URL(response.url()).pathname === "/api/auth/oauth2/token",
			);
			await page.getByRole("button", { name: "Create account", exact: true }).click();

			const [request, oauthResponse] = await Promise.all([signupRequest, tokenResponse]);
			const body: unknown = request.postDataJSON();
			const oauthQuery = body && typeof body === "object" ? Reflect.get(body, "oauth_query") : null;
			expect(typeof oauthQuery).toBe("string");
			expect(oauthResponse.ok()).toBe(true);
			await page.getByTestId("authenticated-shell").waitFor({ state: "visible" });
			expect(new URL(page.url()).pathname).not.toMatch(/^\/auth(?:\/|$)/);
		} finally {
			await context.close();
			await browser.close();
		}
	}),
);
