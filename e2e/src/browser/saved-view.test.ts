import { Effect } from "effect";
import type { Page } from "playwright";

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
import { signInThroughHostedOAuth, withBrowser } from "~/support/browser";
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

let email: string;
let password: string;
let viewUrl: string;
let provider: InstalledTestProvider;

const activeElementAttribute = (page: Page, attribute: string) =>
	page.evaluate((name) => document.activeElement?.getAttribute(name) ?? null, attribute);

const modalSearch = (page: Page) => dialog(page).getByLabel("Search providers");
const dialog = (page: Page) => page.getByRole("dialog", { name: MODAL_LABEL });
const fab = (page: Page) => page.getByRole("button", { name: "Add to this view" });
const closeModal = (page: Page) => dialog(page).getByRole("button", { name: /^(Close|Cancel)$/ });
const headerAdd = (page: Page) => page.getByRole("button", { name: "Add", exact: true });
const providerChip = (page: Page) => dialog(page).getByRole("radio", { name: PROVIDER_NAME });
const pageSearch = (page: Page) => page.getByRole("searchbox", { name: `Search ${VIEW_NAME}` });

const openSavedView = async (
	page: Page,
	viewUrl: string,
	workspaceUrl: string,
	options: { compact?: boolean; coldLoad?: boolean } = {},
) => {
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
	await pageSearch(page).waitFor({ state: "visible" });
};

const waitForAddParam = (page: Page, present: boolean) =>
	page.waitForURL((url) => url.searchParams.has("add") === present);

const openedDialog = async (page: Page) => {
	await dialog(page).waitFor({ state: "visible" });
	await waitForAddParam(page, true);
	expect(new URL(page.url()).searchParams.get("add")).toBe("true");
};

const closedDialog = async (page: Page) => {
	await closeModal(page).click();
	await dialog(page).waitFor({ state: "hidden" });
	await waitForAddParam(page, false);
};

const withSavedViewBrowser = (
	run: (page: Page, workspaceUrl: string) => Effect.Effect<void>,
	options = { viewport: { width: 1280, height: 800 } },
) =>
	withBrowser(options, ({ page }) =>
		Effect.gen(function* () {
			const { homeUrl } = yield* signInThroughHostedOAuth(page, email, password);
			yield* run(page, homeUrl);
		}),
	);

beforeAll(async () => {
	const viewSlug = await Effect.runPromise(
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
			return view.slug;
		}),
	);
	viewUrl = `${getFrontendUrl()}/v/${viewSlug}`;
});

afterAll(async () => {
	await Effect.runPromise(uninstallTestProvider(provider));
});

it.live("opens the provider add flow from every saved-view affordance", () =>
	Effect.gen(function* () {
		yield* withSavedViewBrowser((page, workspaceUrl) =>
			Effect.promise(async () => {
				await openSavedView(page, viewUrl, workspaceUrl);
				await headerAdd(page).waitFor({ state: "visible" });
				await fab(page).waitFor({ state: "hidden" });

				await headerAdd(page).click();
				await openedDialog(page);
				await expect
					.poll(() => providerChip(page).getAttribute("aria-checked"), { timeout: 15_000 })
					.toBe("true");
				await closedDialog(page);

				await page.keyboard.press("a");
				await openedDialog(page);
				await closedDialog(page);

				const searchOnline = page.getByRole("button", { name: "Search online" });
				await searchOnline.click();
				await openedDialog(page);
				expect(await modalSearch(page).inputValue()).toBe("");
				await closedDialog(page);

				await page.keyboard.press("/");
				await expect.poll(() => activeElementAttribute(page, "type")).toBe("search");
				expect(await pageSearch(page).inputValue()).toBe("");
			}),
		);
	}),
);

it.live("clears then releases the search field on Escape so page shortcuts return", () =>
	Effect.gen(function* () {
		yield* withSavedViewBrowser((page, workspaceUrl) =>
			Effect.promise(async () => {
				await openSavedView(page, viewUrl, workspaceUrl);

				await page.keyboard.press("/");
				await expect.poll(() => activeElementAttribute(page, "type")).toBe("search");
				await page.keyboard.type("dune");
				await expect.poll(() => pageSearch(page).inputValue()).toBe("dune");

				await page.keyboard.press("Escape");
				await expect.poll(() => pageSearch(page).inputValue()).toBe("");
				expect(await activeElementAttribute(page, "type")).toBe("search");

				await page.keyboard.press("Escape");
				await expect.poll(() => activeElementAttribute(page, "type")).not.toBe("search");

				await page.keyboard.press("a");
				await openedDialog(page);
				await closedDialog(page);
			}),
		);
	}),
);

it.live("seeds the provider search from the no-matches action and guards page shortcuts", () =>
	Effect.gen(function* () {
		yield* withSavedViewBrowser((page, workspaceUrl) =>
			Effect.promise(async () => {
				await openSavedView(page, viewUrl, workspaceUrl, { coldLoad: true });
				await pageSearch(page).fill(NO_MATCH_QUERY);
				const noMatches = page.getByRole("button", {
					name: `Search online for “${NO_MATCH_QUERY}”`,
				});
				await noMatches.waitFor({ state: "visible" });
				await noMatches.click();
				await openedDialog(page);
				await page.waitForURL((url) => url.searchParams.get("q") === NO_MATCH_QUERY);
				await expect
					.poll(() => modalSearch(page).inputValue(), { timeout: 15_000 })
					.toBe(NO_MATCH_QUERY);

				await providerChip(page).click();
				await expect.poll(() => activeElementAttribute(page, "aria-label")).toBe(PROVIDER_NAME);

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
				expect(await activeElementAttribute(page, "aria-label")).toBe(PROVIDER_NAME);

				const reopened = page
					.waitForURL((url) => !url.searchParams.has("q"), { timeout: GUARD_TIMEOUT })
					.then(
						() => true,
						() => false,
					);
				await page.keyboard.press("a");
				expect(await reopened).toBe(false);
				await dialog(page).waitFor({ state: "visible" });

				await page.goBack();
				await dialog(page).waitFor({ state: "hidden" });
				await waitForAddParam(page, false);
			}),
		);
	}),
);

it.live("adds a provider result to the saved view and swaps the mobile affordance", () =>
	Effect.gen(function* () {
		yield* withSavedViewBrowser((page, workspaceUrl) =>
			Effect.promise(async () => {
				await page.setViewportSize({ width: 480, height: 900 });
				await openSavedView(page, viewUrl, workspaceUrl, { coldLoad: true, compact: true });
				await fab(page).waitFor({ state: "visible" });
				await headerAdd(page).waitFor({ state: "hidden" });

				await fab(page).click();
				await openedDialog(page);
				await modalSearch(page).fill("result");
				const addFirst = dialog(page).getByRole("button", { name: `Add ${FIRST_RESULT_TITLE}` });
				await addFirst.waitFor({ state: "visible" });
				await dialog(page)
					.getByRole("button", { name: `Add ${SECOND_RESULT_TITLE}` })
					.waitFor({ state: "visible" });

				await addFirst.click();
				await dialog(page)
					.getByRole("link", { name: `Open ${FIRST_RESULT_TITLE} in library` })
					.waitFor({ state: "visible", timeout: IMPORT_TIMEOUT });

				await closedDialog(page);
				await page.getByText(IMPORTED_NAME).waitFor({ state: "visible" });
				await page.setViewportSize({ width: 1280, height: 800 });
			}),
		);
	}),
);
