import { savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import { mediaPlugin } from "@ryot-app/media-plugin";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient } from "~/fixtures/kernel";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

it.live("creates a custom movie from the saved view's Create custom handoff", () =>
	Effect.gen(function* () {
		const { email, password } = yield* createAuthenticatedClient();
		const movieName = `Custom movie ${crypto.randomUUID()}`;
		const page = yield* (yield* Playwright.Browser).newPage({
			viewport: { width: 1280, height: 900 },
		});
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(
			`${getFrontendUrl()}${savedViewPath({ kind: "plugin", slug: "all-movies", packageId: mediaPlugin.metadata.packageId })}`,
		);
		yield* page
			.locator("iframe")
			.contentFrame()
			.getByRole("button", { name: "Add", exact: true })
			.click();
		const provider = page.getByRole("dialog", { exact: true, name: "Add from a provider" });
		yield* provider.getByLabel("Search providers").fill(movieName);
		yield* provider.getByRole("button", { exact: true, name: "Create custom" }).click();

		const editor = page.locator('iframe[title="Media plugin"]:visible').contentFrame();
		const form = editor.getByRole("form", { exact: true, name: "New Movie" });
		const name = form.getByLabel("Name", { exact: true });
		yield* name.waitFor({ state: "visible" });
		expect(yield* name.inputValue()).toBe(movieName);
		yield* form.getByRole("button", { exact: true, name: "Save" }).click();

		yield* page.waitForURL((url) => url.pathname.startsWith("/e/"));
		yield* page
			.locator('iframe[title="Media plugin"]:visible')
			.contentFrame()
			.getByRole("heading", { level: 1, exact: true, name: movieName })
			.waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);
