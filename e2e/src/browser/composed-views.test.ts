import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	createClientRenderer,
	createRendererSavedView,
	createTestUser,
	makeSession,
	publishClientRenderer,
} from "~/fixtures/kernel";
import { getApiUrl } from "~/support/api";
import { browserLayer, signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/frontend";

const expectVisibleText = (locator: Playwright.Locator, text: string) =>
	Effect.gen(function* () {
		const match = locator.getByText(text, { exact: true }).filter({ visible: true });
		yield* match.waitFor({ state: "visible" });
		expect(yield* match.isVisible()).toBe(true);
	});

it.live("opens a published saved-view renderer in one sandboxed iframe", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const { token, email, password } = yield* createTestUser(apiUrl);
		const client = makeSession(apiUrl, { Authorization: `Bearer ${token}` });
		const renderer = yield* createClientRenderer(client);
		yield* publishClientRenderer(client, renderer.id, renderer.draftRevision);
		const view = yield* createRendererSavedView(client, renderer.id, {
			label: "Task 01 browser setting",
		});
		const secondView = yield* createRendererSavedView(client, renderer.id, {
			label: "Task 01 second setting",
		});

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/v/${view.slug}`);

		const frames = page.locator("iframe");
		yield* frames.waitFor({ state: "visible" });
		expect(yield* frames.count).toBe(1);
		expect(yield* frames.first().getAttribute("sandbox")).toBe("allow-scripts");
		expect(yield* frames.first().getAttribute("referrerpolicy")).toBe("no-referrer");

		const renderedPage = frames.first().contentFrame();
		yield* renderedPage
			.getByRole("heading", { level: 1, name: "Task 01 composed page", exact: true })
			.waitFor({ state: "visible" });
		yield* expectVisibleText(renderedPage.locator("body"), "Task 01 composed page");
		yield* expectVisibleText(
			renderedPage.locator("body"),
			"Renderer setting: Task 01 browser setting",
		);

		yield* page.locator(`a[href="/v/${secondView.slug}"]`).first().click();
		yield* page.waitForURL(`**/v/${secondView.slug}`);
		yield* expectVisibleText(
			page.locator("iframe").contentFrame().locator("body"),
			"Renderer setting: Task 01 second setting",
		);
		expect(yield* page.locator("iframe").count).toBe(1);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);
