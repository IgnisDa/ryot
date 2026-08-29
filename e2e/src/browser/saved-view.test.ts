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
const COMPACT_ID = SUITE_ID.replaceAll("-", "");

const VIEW_NAME = `Browser View ${SUITE_ID}`;
const NO_MATCH_QUERY = `nomatch${COMPACT_ID}`;
const PROVIDER_NAME = "Saved View Fake Provider";
const PLUGIN_SLUG = `saved-view-add-${SUITE_ID}`;
const IMPORTED_NAME = `Saved View Imported ${SUITE_ID}`;
const FIRST_EXTERNAL_ID = `saved-view-add-first-${SUITE_ID}`;
const FIRST_RESULT_TITLE = `Saved View Result One ${SUITE_ID}`;
const ENTITY_SCHEMA_SLUG = `saved-view-add-record-${SUITE_ID}`;
const SECOND_EXTERNAL_ID = `saved-view-add-second-${SUITE_ID}`;
const SECOND_RESULT_TITLE = `Saved View Result Two ${SUITE_ID}`;

const GUARD_TIMEOUT = 2_000;
const IMPORT_TIMEOUT = 150_000;
const MODAL_LABEL = "Add from a provider";
const PROVIDER_SLUG = `${ENTITY_SCHEMA_SLUG}.saved-view-add`;

let page: Page;
let viewUrl: string;
let workspaceUrl: string;
let browser: Browser;
let context: BrowserContext;
let provider: InstalledTestProvider;

const activeElementAttribute = (attribute: string) =>
	page.evaluate((name) => document.activeElement?.getAttribute(name) ?? null, attribute);

const modalSearch = () => dialog().getByLabel("Search providers");
const dialog = () => page.getByRole("dialog", { name: MODAL_LABEL });
const fab = () => page.getByRole("button", { name: "Add to this view" });
const closeModal = () => dialog().getByRole("button", { name: /^(Close|Cancel)$/ });
const headerAdd = () => page.getByRole("button", { name: "Add", exact: true });
const providerChip = () => dialog().getByRole("radio", { name: PROVIDER_NAME });
const pageSearch = () => page.getByRole("searchbox", { name: `Search ${VIEW_NAME}` });

const openSavedView = async (options: { compact?: boolean; coldLoad?: boolean } = {}) => {
	if (options.coldLoad) {
		await page.goto(workspaceUrl);
		await page.getByTestId("authenticated-shell").waitFor({ state: "visible" });
	}
	if (options.compact) {
		await page.getByRole("button", { name: "Open navigation" }).click();
		await page.getByTestId("mobile-drawer").waitFor({ state: "visible" });
	}
	const row = page.getByRole("link", { name: VIEW_NAME, exact: true });
	await row.waitFor({ state: "visible" });
	expect(await row.count()).toBe(1);
	await row.click();
	await page.waitForURL((url) => url.pathname === new URL(viewUrl).pathname);
	if (options.compact) {
		await page.getByTestId("mobile-drawer").waitFor({ state: "hidden" });
	}
};

const waitForAddParam = (present: boolean) =>
	page.waitForURL((url) => url.searchParams.has("add") === present);

const openedDialog = async () => {
	await dialog().waitFor({ state: "visible" });
	await waitForAddParam(true);
	expect(new URL(page.url()).searchParams.get("add")).toBe("true");
};

const closedDialog = async () => {
	await closeModal().click();
	await dialog().waitFor({ state: "hidden" });
	await waitForAddParam(false);
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
				details: fakeProviderDetailsResult({
					name: IMPORTED_NAME,
					properties: { description: "Imported by the saved-view browser fixture." },
				}),
				search: fakeProviderSearchResult([
					{ externalId: FIRST_EXTERNAL_ID, title: FIRST_RESULT_TITLE },
					{ externalId: SECOND_EXTERNAL_ID, title: SECOND_RESULT_TITLE },
				]),
				entitySchemas: [
					{
						icon: "file",
						eventSchemas: [],
						slug: ENTITY_SCHEMA_SLUG,
						name: "Saved View Add Record",
						propertiesSchema: {
							fields: {
								description: {
									type: "string",
									label: "Description",
									description: "Saved view add record description",
								},
							},
						},
					},
				],
			});
			const view = yield* createSavedView(client, {
				name: VIEW_NAME,
				entitySchemaSlug: makeEntitySchemaSlug(ENTITY_SCHEMA_SLUG),
				layouts: buildSavedViewLayouts({}, [ENTITY_SCHEMA_SLUG]),
			});
			return { email, password, viewSlug: view.slug };
		}),
	);

	const frontendUrl = getFrontendUrl();
	viewUrl = `${frontendUrl}/v/${credentials.viewSlug}`;
	browser = await chromium.launch();
	context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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

it.live("opens the provider add flow from every saved-view affordance", () =>
	Effect.promise(async () => {
		await openSavedView();
		await headerAdd().waitFor({ state: "visible" });
		await fab().waitFor({ state: "hidden" });

		await headerAdd().click();
		await openedDialog();
		await expect
			.poll(() => providerChip().getAttribute("aria-checked"), { timeout: 15_000 })
			.toBe("true");
		await closedDialog();

		await page.keyboard.press("a");
		await openedDialog();
		await closedDialog();

		const searchOnline = page.getByRole("button", { name: "Search online" });
		await searchOnline.click();
		await openedDialog();
		expect(await modalSearch().inputValue()).toBe("");
		await closedDialog();

		await page.keyboard.press("/");
		await expect.poll(() => activeElementAttribute("type")).toBe("search");
		expect(await pageSearch().inputValue()).toBe("");
	}),
);

it.live("seeds the provider search from the no-matches action and guards page shortcuts", () =>
	Effect.promise(async () => {
		await openSavedView({ coldLoad: true });
		await pageSearch().fill(NO_MATCH_QUERY);
		const noMatches = page.getByRole("button", {
			name: `Search online for “${NO_MATCH_QUERY}”`,
		});
		await noMatches.waitFor({ state: "visible" });
		await noMatches.click();
		await openedDialog();
		await page.waitForURL((url) => url.searchParams.get("q") === NO_MATCH_QUERY);
		await expect.poll(() => modalSearch().inputValue(), { timeout: 15_000 }).toBe(NO_MATCH_QUERY);

		await providerChip().click();
		await expect.poll(() => activeElementAttribute("aria-label")).toBe(PROVIDER_NAME);

		const pageSearchFocused = page
			.waitForFunction(() => document.activeElement?.getAttribute("type") === "search", null, {
				timeout: GUARD_TIMEOUT,
			})
			.then(
				() => true,
				() => false,
			);
		await page.keyboard.press("/");
		expect(await pageSearchFocused).toBe(false);
		expect(await activeElementAttribute("aria-label")).toBe(PROVIDER_NAME);

		const reopened = page
			.waitForURL((url) => !url.searchParams.has("q"), { timeout: GUARD_TIMEOUT })
			.then(
				() => true,
				() => false,
			);
		await page.keyboard.press("a");
		expect(await reopened).toBe(false);
		await dialog().waitFor({ state: "visible" });

		await page.goBack();
		await dialog().waitFor({ state: "hidden" });
		await waitForAddParam(false);
	}),
);

it.live("adds a provider result to the saved view and swaps the mobile affordance", () =>
	Effect.promise(async () => {
		await page.setViewportSize({ width: 480, height: 900 });
		await openSavedView({ coldLoad: true, compact: true });
		await fab().waitFor({ state: "visible" });
		await headerAdd().waitFor({ state: "hidden" });

		await fab().click();
		await openedDialog();
		await modalSearch().fill("result");
		const addFirst = dialog().getByRole("button", { name: `Add ${FIRST_RESULT_TITLE}` });
		await addFirst.waitFor({ state: "visible" });
		await dialog()
			.getByRole("button", { name: `Add ${SECOND_RESULT_TITLE}` })
			.waitFor({ state: "visible" });

		await addFirst.click();
		await dialog()
			.getByRole("link", { name: `Open ${FIRST_RESULT_TITLE} in library` })
			.waitFor({ state: "visible", timeout: IMPORT_TIMEOUT });

		await closedDialog();
		await page.getByText(IMPORTED_NAME).waitFor({ state: "visible" });
		await page.setViewportSize({ width: 1280, height: 800 });
	}),
);
