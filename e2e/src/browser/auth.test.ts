import { OAUTH_WEB_CLIENT_ID } from "@ryot-app/contract/oauth";
import { Effect, Fiber, Option, Stream } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { browserLayer } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

it.live("signs up through the hosted OAuth flow", () =>
	Effect.gen(function* () {
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		const frontendUrl = getFrontendUrl();
		const hostedLoginRequestFiber = yield* page.eventStream("request").pipe(
			Stream.filter((request) => new URL(request.url()).pathname === "/oauth/login"),
			Stream.runHead,
			Effect.forkChild({ startImmediately: true }),
		);
		yield* page.goto(`${frontendUrl}/auth`);
		const loginRequest = Option.getOrThrow(yield* Fiber.join(hostedLoginRequestFiber));
		expect(new URL(loginRequest.url()).searchParams.get("client_id")).toBe(OAUTH_WEB_CLIENT_ID);
		yield* page.waitForURL((url) => url.pathname === "/oauth/login");

		const mode = page.getByRole("group", { name: "Authentication mode" });
		yield* mode.getByRole("button", { name: "Sign up", exact: true }).click();
		yield* page
			.getByLabel("Email address")
			.fill(`browser-signup-${crypto.randomUUID()}@example.com`);
		yield* page.getByLabel("Password").fill("password123");
		const signupRequestFiber = yield* page.eventStream("request").pipe(
			Stream.filter((request) => new URL(request.url()).pathname === "/api/auth/sign-up/email"),
			Stream.runHead,
			Effect.forkChild({ startImmediately: true }),
		);
		const tokenResponseFiber = yield* page.eventStream("response").pipe(
			Stream.filter((response) => new URL(response.url()).pathname === "/api/auth/oauth2/token"),
			Stream.runHead,
			Effect.forkChild({ startImmediately: true }),
		);
		yield* page.getByRole("button", { name: "Create account", exact: true }).click();

		const request = Option.getOrThrow(yield* Fiber.join(signupRequestFiber));
		const oauthResponse = Option.getOrThrow(yield* Fiber.join(tokenResponseFiber));
		const body: unknown = Option.getOrThrow(yield* request.postDataJSON);
		const oauthQuery = body && typeof body === "object" ? Reflect.get(body, "oauth_query") : null;
		expect(typeof oauthQuery).toBe("string");
		expect(oauthResponse.ok()).toBe(true);
		yield* page.getByTestId("authenticated-shell").waitFor({ state: "visible" });
		expect(new URL(page.url()).pathname).not.toMatch(/^\/auth(?:\/|$)/);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);
