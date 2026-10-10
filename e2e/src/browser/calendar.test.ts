import { savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	createAuthenticatedClient,
	createEntity,
	installFixtureClientPlugin,
	listEntitySchemas,
} from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";
import { pluginFrame, signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getApiUrl, getFrontendUrl } from "~/support/harness-target";

const calendarPath = savedViewPath({ kind: "kernel", slug: "calendar" });

const monthParam = (page: Playwright.Page) =>
	page.evaluate(() => new URLSearchParams(window.location.search).get("month"));

const waitForMonthParam = (page: Playwright.Page, previous: string | null) =>
	page.locator("body").waitForFunction((body, before) => {
		const month = new URLSearchParams(body.ownerDocument.location.search).get("month");
		return month !== null && month !== before;
	}, previous);

it.live("shows a new fixture entity today, navigates months, and keeps hidden state", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const { email, client, password } = yield* createAuthenticatedClient(apiUrl);
		const installation = yield* installFixtureClientPlugin(client, "A", "", apiUrl);
		const pokemonSchema = requirePresent(
			(yield* listEntitySchemas(client, {
				slugs: ["pokemon"],
				pluginId: installation.pluginId,
			}))[0],
			"Fixture Pokemon schema was not registered",
		);
		const name = `Calendar Pokemon ${crypto.randomUUID()}`;
		yield* createEntity(client, {
			name,
			entitySchema: pokemonSchema.reference,
			properties: { sourceUrl: "https://pokeapi.example/calendar" },
		});

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}${calendarPath}`);
		const frame = pluginFrame(page);
		yield* frame.getByRole("heading", { level: 1, name: "Calendar" }).waitFor();

		const row = frame.getByRole("link").filter({ hasText: name });
		yield* row.waitFor({ state: "visible" });
		expect(yield* row.textContent()).toContain("https://pokeapi.example/calendar");
		const day = frame.locator("section[data-day]").filter({ hasText: name });
		yield* day.getByText("Today", { exact: true }).waitFor({ state: "visible" });

		const current = yield* monthParam(page);
		yield* frame.getByRole("button", { name: "Next month" }).click();
		yield* waitForMonthParam(page, current);
		const next = yield* monthParam(page);
		yield* row.waitFor({ state: "detached" });
		yield* frame.getByRole("button", { name: "Previous month" }).click();
		yield* waitForMonthParam(page, next);
		yield* row.waitFor({ state: "visible" });

		const chip = frame.getByRole("button", { name: /Pokemon added/ });
		expect(yield* chip.getAttribute("aria-pressed")).toBe("true");
		yield* chip.click();
		yield* frame
			.getByRole("button", { pressed: false, name: /Pokemon added/ })
			.waitFor({ state: "visible" });
		yield* row.waitFor({ state: "detached" });

		yield* page.reload;
		const reloaded = pluginFrame(page);
		yield* reloaded
			.getByRole("button", { pressed: false, name: /Pokemon added/ })
			.waitFor({ state: "visible" });
		expect(yield* reloaded.getByRole("link").filter({ hasText: name }).count).toBe(0);
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("hides the Calendar view from the sidebar and keeps it hidden after a reload", () =>
	Effect.gen(function* () {
		const { email, password } = yield* createAuthenticatedClient(getApiUrl());
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		yield* signInThroughHostedOAuth(page, email, password);
		const sidebar = page.getByTestId("desktop-sidebar");
		const link = sidebar.getByRole("link", { exact: true, name: "Calendar" });
		yield* link.waitFor({ state: "visible" });

		yield* page.getByRole("button", { name: /workspace,/ }).click();
		yield* page.getByRole("menuitem", { name: "Customize sidebar" }).click();
		yield* page.getByRole("switch", { name: "Show Calendar in sidebar" }).click();
		yield* page.getByRole("button", { name: "Save sidebar changes" }).click();
		yield* page.waitForURL((url) => url.pathname !== "/customize-sidebar");
		yield* link.waitFor({ state: "detached" });

		yield* page.reload;
		yield* page.getByTestId("authenticated-shell").waitFor({ state: "visible" });
		yield* page.getByRole("button", { name: /workspace,/ }).click();
		yield* page.getByRole("menuitem", { name: "Customize sidebar" }).click();
		const restored = page.getByRole("switch", { name: "Show Calendar in sidebar" });
		yield* restored.waitFor({ state: "visible" });
		expect(yield* restored.getAttribute("aria-checked")).toBe("false");
		expect(yield* link.count).toBe(0);
	}).pipe(PlaywrightSpawner.withBrowser),
);
