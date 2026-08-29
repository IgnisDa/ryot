import { Data, Effect } from "effect";
import {
	chromium,
	type Browser,
	type BrowserContext,
	type BrowserContextOptions,
	type Page,
} from "playwright";

import { getFrontendUrl } from "~/support/frontend";

export type BrowserSession = {
	readonly browser: Browser;
	readonly context: BrowserContext;
	readonly page: Page;
};

type BrowserContextSession = Omit<BrowserSession, "page">;

type BrowserSignInOptions = {
	readonly captureHistory?: boolean;
	readonly entryPath?: string;
};

class BrowserStepError extends Data.TaggedError("BrowserStepError")<{
	readonly cause: unknown;
	readonly message: string;
}> {}

export const withBrowserContext = <A, E>(
	options: BrowserContextOptions | undefined,
	use: (session: BrowserContextSession) => Effect.Effect<A, E>,
) =>
	Effect.gen(function* () {
		const browser = yield* Effect.acquireRelease(
			Effect.promise(() => chromium.launch()),
			(br) => Effect.promise(() => br.close()),
		);
		const context = yield* Effect.acquireRelease(
			Effect.promise(() => browser.newContext(options)),
			(br) => Effect.promise(() => br.close()),
		);
		return yield* use({ browser, context });
	});

export const withBrowser = <A, E>(
	options: BrowserContextOptions | undefined,
	use: (session: BrowserSession) => Effect.Effect<A, E>,
) =>
	withBrowserContext(options, ({ browser, context }) =>
		Effect.gen(function* () {
			const page = yield* Effect.promise(() => context.newPage());
			return yield* use({ browser, context, page });
		}),
	);

export const browserStep = <A>(name: string, run: () => Promise<A>) =>
	Effect.tryPromise({
		try: run,
		catch: (cause) => new BrowserStepError({ cause, message: `Browser step failed: ${name}` }),
	});

export const signInThroughHostedOAuth = (
	page: Page,
	email: string,
	password: string,
	options: BrowserSignInOptions = {},
) =>
	browserStep("sign in through hosted OAuth", async () => {
		const frontendUrl = getFrontendUrl();
		await page.goto(`${frontendUrl}${options.entryPath ?? "/auth"}`);
		await page.waitForURL((url) => url.pathname === "/oauth/login");
		await page.getByLabel("Email address").fill(email);
		await page.getByLabel("Password").fill(password);
		const historyLengthBeforeSubmit = options.captureHistory
			? await page.evaluate(() => history.length)
			: undefined;
		await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
		await page.getByTestId("authenticated-shell").waitFor({ state: "visible" });
		const homePath = await page
			.getByRole("link", { name: "Home", exact: true })
			.getAttribute("href");
		return {
			homeUrl: new URL(homePath ?? "/", frontendUrl).toString(),
			historyLengthBeforeSubmit,
		};
	});
