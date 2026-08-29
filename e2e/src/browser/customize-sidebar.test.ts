import { Effect } from "effect";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

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
import { afterAll, beforeAll, expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/frontend";

const SUITE_ID = crypto.randomUUID();

const BETA = `Customize Beta ${SUITE_ID}`;
const ALPHA = `Customize Alpha ${SUITE_ID}`;
const GAMMA = `Customize Gamma ${SUITE_ID}`;
const PLUGIN_SLUG = `customize-sidebar-${SUITE_ID}`;
const PROVIDER_NAME = "Customize Sidebar Fake Provider";
const ENTITY_SCHEMA_SLUG = `customize-sidebar-record-${SUITE_ID}`;
const PROVIDER_SLUG = `${ENTITY_SCHEMA_SLUG}.customize-sidebar`;

let page: Page;
let browser: Browser;
let workspaceUrl: string;
let context: BrowserContext;
let provider: InstalledTestProvider;

const sidebar = () => page.getByTestId("desktop-sidebar");

const savedViewSection = () =>
	sidebar()
		.locator("section")
		.filter({ has: page.getByRole("heading", { name: "Saved Views", exact: true }) });

// A fresh account already owns the builtin "All Collections" saved view, so every assertion is
// scoped to this suite's own views rather than to the whole section.
const sidebarSavedViews = async () => {
	const innerTexts = await savedViewSection().getByRole("link").allInnerTexts();
	return innerTexts.filter((name) => name.includes(SUITE_ID));
};

const openPanel = async () => {
	await page.getByRole("button", { name: /workspace,/ }).click();
	await page.getByRole("menuitem", { name: "Customize sidebar" }).click();
	await page.getByRole("heading", { name: "Customize sidebar" }).waitFor({ state: "visible" });
};

beforeAll(async () => {
	const credentials = await Effect.runPromise(
		Effect.gen(function* () {
			const { email, token, password } = yield* createTestUser();
			const client = makeSession(getApiUrl(), { Authorization: `Bearer ${token}` });
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
			return { email, password };
		}),
	);

	const frontendUrl = getFrontendUrl();
	browser = await chromium.launch();
	context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	page = await context.newPage();
	await page.goto(`${frontendUrl}/auth`);
	await page.waitForURL((url) => url.pathname === "/oauth/login");
	await page.getByLabel("Email address").fill(credentials.email);
	await page.getByLabel("Password").fill(credentials.password);
	await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
	await page.getByTestId("authenticated-shell").waitFor({ state: "visible" });
	const homePath = await page.getByRole("link", { name: "Home", exact: true }).getAttribute("href");
	workspaceUrl = new URL(homePath ?? "/", frontendUrl).toString();
});

afterAll(async () => {
	await context.close();
	await browser.close();
	await Effect.runPromise(uninstallTestProvider(provider));
});

it.live("reorders and hides saved views, and keeps both across a reload", () =>
	Effect.promise(async () => {
		await page.goto(workspaceUrl);
		await page.getByTestId("authenticated-shell").waitFor({ state: "visible" });
		expect(await sidebarSavedViews()).toEqual([ALPHA, BETA, GAMMA]);

		await openPanel();
		await page.getByRole("button", { name: `Reorder ${ALPHA}` }).waitFor({ state: "visible" });

		await page.getByRole("button", { name: `Reorder ${ALPHA}` }).focus();
		await page.keyboard.press("End");
		await page.getByRole("switch", { name: `Show ${BETA} in sidebar` }).click();
		await page.getByRole("button", { name: "Save sidebar changes" }).click();

		await page.waitForURL((url) => url.pathname === new URL(workspaceUrl).pathname);
		await expect.poll(() => sidebarSavedViews()).toEqual([GAMMA, ALPHA]);

		await page.reload();
		await page.getByTestId("authenticated-shell").waitFor({ state: "visible" });
		expect(await sidebarSavedViews()).toEqual([GAMMA, ALPHA]);
	}),
);

it.live("restores a hidden view from the panel", () =>
	Effect.promise(async () => {
		await openPanel();
		await page.getByRole("switch", { name: `Show ${BETA} in sidebar` }).click();
		await page.getByRole("button", { name: "Save sidebar changes" }).click();

		await page.waitForURL((url) => url.pathname === new URL(workspaceUrl).pathname);
		await expect.poll(() => sidebarSavedViews()).toEqual([BETA, GAMMA, ALPHA]);
	}),
);

it.live("leaves the draft untouched when the customization is cancelled", () =>
	Effect.promise(async () => {
		await openPanel();
		await page.getByRole("switch", { name: `Show ${GAMMA} in sidebar` }).click();
		await page.getByRole("button", { name: "Cancel sidebar customization" }).click();

		await page.getByRole("button", { name: "Discard", exact: true }).click();
		await page.waitForURL((url) => url.pathname === new URL(workspaceUrl).pathname);
		await expect.poll(() => sidebarSavedViews()).toEqual([BETA, GAMMA, ALPHA]);
	}),
);
