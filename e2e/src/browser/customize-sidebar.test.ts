import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	buildSavedViewLayouts,
	createSavedView,
	createTestUser,
	fakeProviderDetailsResult,
	fakeProviderSearchResult,
	installTestProvider,
	makeEntitySchemaSlug,
	makeSession,
	uninstallTestProvider,
	type InstalledTestProvider,
} from "~/fixtures/kernel";
import { getApiUrl } from "~/support/api";
import { browserLayer, signInThroughHostedOAuth } from "~/support/browser";
import { afterAll, beforeAll, expect, it } from "~/support/effect-test";

const SUITE_ID = crypto.randomUUID();

const BETA = `Customize Beta ${SUITE_ID}`;
const ALPHA = `Customize Alpha ${SUITE_ID}`;
const GAMMA = `Customize Gamma ${SUITE_ID}`;
const PLUGIN_SLUG = `customize-sidebar-${SUITE_ID}`;
const PROVIDER_NAME = "Customize Sidebar Fake Provider";
const ENTITY_SCHEMA_SLUG = `customize-sidebar-record-${SUITE_ID}`;
const PROVIDER_SLUG = `${ENTITY_SCHEMA_SLUG}.customize-sidebar`;

let email: string;
let password: string;
let provider: InstalledTestProvider;

const sidebar = (page: Playwright.Page) => page.getByTestId("desktop-sidebar");

const savedViewSection = (page: Playwright.Page) =>
	sidebar(page).locator("section").filter({ hasText: "Saved Views" });

// A fresh account already owns the builtin "All Collections" saved view, so every assertion is
// scoped to this suite's own views rather than to the whole section.
const sidebarSavedViews = (page: Playwright.Page) =>
	Effect.gen(function* () {
		const innerTexts = yield* savedViewSection(page).getByRole("link").allInnerTexts();
		return innerTexts.filter((name) => name.includes(SUITE_ID));
	});

const openPanel = (page: Playwright.Page) =>
	Effect.gen(function* () {
		yield* page.getByRole("button", { name: /workspace,/ }).click();
		yield* page.getByRole("menuitem", { name: "Customize sidebar" }).click();
		yield* page.getByRole("heading", { name: "Customize sidebar" }).waitFor({ state: "visible" });
	});

const waitForSidebarSavedViews = (page: Playwright.Page, names: ReadonlyArray<string>) =>
	savedViewSection(page).waitForFunction(
		(section, expected: { readonly names: ReadonlyArray<string>; readonly suiteId: string }) => {
			const actual = Array.from(section.querySelectorAll("a"))
				.map((link) => (link as HTMLElement).innerText)
				.filter((name) => name.includes(expected.suiteId));
			return JSON.stringify(actual) === JSON.stringify(expected.names);
		},
		{ names, suiteId: SUITE_ID },
	);

beforeAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const user = yield* createTestUser();
			email = user.email;
			password = user.password;
			const client = makeSession(getApiUrl(), { Authorization: `Bearer ${user.token}` });
			provider = yield* installTestProvider({
				client,
				name: PROVIDER_NAME,
				slug: PROVIDER_SLUG,
				pluginSlug: PLUGIN_SLUG,
				rootEntitySchemaSlug: ENTITY_SCHEMA_SLUG,
				search: fakeProviderSearchResult([]),
				details: fakeProviderDetailsResult({ name: "Customize sidebar record" }),
				entitySchemas: [
					{
						icon: "file",
						eventSchemas: [],
						slug: ENTITY_SCHEMA_SLUG,
						name: "Customize Sidebar Record",
						propertiesSchema: { fields: {} },
					},
				],
			});
			for (const name of [ALPHA, BETA, GAMMA]) {
				yield* createSavedView(client, {
					name,
					entitySchemaSlug: makeEntitySchemaSlug(ENTITY_SCHEMA_SLUG),
					layouts: buildSavedViewLayouts({}, [ENTITY_SCHEMA_SLUG]),
				});
			}
		}),
	);
});

afterAll(async () => {
	await Effect.runPromise(uninstallTestProvider(provider));
});

it.live("reorders and hides saved views, and keeps both across a reload", () =>
	Effect.gen(function* () {
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		const { homeUrl } = yield* signInThroughHostedOAuth(page, email, password);
		expect(yield* sidebarSavedViews(page)).toEqual([ALPHA, BETA, GAMMA]);

		yield* openPanel(page);
		yield* page.getByRole("button", { name: `Reorder ${ALPHA}` }).waitFor({ state: "visible" });

		yield* page.getByRole("button", { name: `Reorder ${ALPHA}` }).focus();
		yield* page.keyboard.press("End");
		yield* page.getByRole("switch", { name: `Show ${BETA} in sidebar` }).click();
		yield* page.getByRole("button", { name: "Save sidebar changes" }).click();

		yield* page.waitForURL((url) => url.pathname === new URL(homeUrl).pathname);
		yield* waitForSidebarSavedViews(page, [GAMMA, ALPHA]);

		yield* page.reload;
		yield* page.getByTestId("authenticated-shell").waitFor({ state: "visible" });
		expect(yield* sidebarSavedViews(page)).toEqual([GAMMA, ALPHA]);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("restores a hidden view from the panel", () =>
	Effect.gen(function* () {
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		const { homeUrl } = yield* signInThroughHostedOAuth(page, email, password);
		yield* openPanel(page);
		yield* page.getByRole("switch", { name: `Show ${BETA} in sidebar` }).click();
		yield* page.getByRole("button", { name: "Save sidebar changes" }).click();

		yield* page.waitForURL((url) => url.pathname === new URL(homeUrl).pathname);
		yield* waitForSidebarSavedViews(page, [BETA, GAMMA, ALPHA]);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("leaves the draft untouched when the customization is cancelled", () =>
	Effect.gen(function* () {
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		const { homeUrl } = yield* signInThroughHostedOAuth(page, email, password);
		yield* openPanel(page);
		yield* page.getByRole("switch", { name: `Show ${GAMMA} in sidebar` }).click();
		yield* page.getByRole("button", { name: "Cancel sidebar customization" }).click();

		yield* page.getByRole("button", { name: "Discard", exact: true }).click();
		yield* page.waitForURL((url) => url.pathname === new URL(homeUrl).pathname);
		yield* waitForSidebarSavedViews(page, [BETA, GAMMA, ALPHA]);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);
