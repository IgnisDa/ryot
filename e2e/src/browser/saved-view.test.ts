import { Effect, Fiber } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	buildSavedViewLayouts,
	createEntity,
	createSavedView,
	createTestUser,
	fakeProviderDetailsResult,
	fakeProviderSearchResult,
	fakeProviderTranslations,
	getEntity,
	installTestProvider,
	makeEntitySchemaSlug,
	makeSession,
	setUserLanguage,
	uninstallTestProvider,
	type InstalledTestProvider,
} from "~/fixtures/kernel";
import { getApiUrl } from "~/support/api";
import { browserLayer, signInThroughHostedOAuth } from "~/support/browser";
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

const activeElementAttribute = (page: Playwright.Page, attribute: string) =>
	page.evaluate((name) => document.activeElement?.getAttribute(name) ?? null, attribute);

const modalSearch = (page: Playwright.Page) => dialog(page).getByLabel("Search providers");
const dialog = (page: Playwright.Page) => page.getByRole("dialog", { name: MODAL_LABEL });
const fab = (page: Playwright.Page) => page.getByRole("button", { name: "Add to this view" });
const closeModal = (page: Playwright.Page) =>
	dialog(page).getByRole("button", { name: /^(Close|Cancel)$/ });
const headerAdd = (page: Playwright.Page) => page.getByRole("button", { name: "Add", exact: true });
const providerChip = (page: Playwright.Page) =>
	dialog(page).getByRole("radio", { name: PROVIDER_NAME });
const pageSearch = (page: Playwright.Page) =>
	page.getByRole("searchbox", { name: `Search ${VIEW_NAME}` });

const openSavedView = (
	page: Playwright.Page,
	urlForView: string,
	workspaceUrl: string,
	options: { compact?: boolean; coldLoad?: boolean } = {},
) =>
	Effect.gen(function* () {
		if (options.coldLoad) {
			yield* page.goto(workspaceUrl);
			yield* page.getByTestId("authenticated-shell").waitFor({ state: "visible" });
		}
		if (options.compact) {
			yield* page.getByRole("button", { name: "Open navigation" }).click();
			yield* page.getByTestId("mobile-drawer").waitFor({ state: "visible" });
		}
		const row = page.getByRole("link", { name: VIEW_NAME, exact: true });
		yield* row.waitFor({ state: "visible" });
		expect(yield* row.count).toBe(1);
		yield* row.click();
		yield* page.waitForURL((url) => url.pathname === new URL(urlForView).pathname);
		if (options.compact) {
			yield* page.getByTestId("mobile-drawer").waitFor({ state: "hidden" });
			yield* page.getByRole("heading", { level: 1, name: VIEW_NAME }).waitFor({ state: "visible" });
			return;
		}
		yield* pageSearch(page).waitFor({ state: "visible" });
	});

const waitForAddParam = (page: Playwright.Page, present: boolean) =>
	page.waitForURL((url) => url.searchParams.has("add") === present);

const waitForActiveElementAttribute = (
	page: Playwright.Page,
	attribute: string,
	value: string,
	matches = true,
	options?: Parameters<Playwright.Locator["waitForFunction"]>[2],
) =>
	page
		.locator("body")
		.waitForFunction(
			(
				_body,
				expected: { readonly attribute: string; readonly matches: boolean; readonly value: string },
			) =>
				expected.matches
					? document.activeElement?.getAttribute(expected.attribute) === expected.value
					: document.activeElement?.getAttribute(expected.attribute) !== expected.value,
			{ attribute, matches, value },
			options,
		);

const waitForInputValue = (
	locator: Playwright.Locator,
	value: string,
	options?: Parameters<Playwright.Locator["waitForFunction"]>[2],
) =>
	locator.waitForFunction(
		(element, expected: string) => Reflect.get(element, "value") === expected,
		value,
		options,
	);

const openedDialog = (page: Playwright.Page) =>
	Effect.gen(function* () {
		yield* dialog(page).waitFor({ state: "visible" });
		yield* waitForAddParam(page, true);
		expect(new URL(page.url()).searchParams.get("add")).toBe("true");
	});

const closedDialog = (page: Playwright.Page) =>
	Effect.gen(function* () {
		yield* closeModal(page).click();
		yield* dialog(page).waitFor({ state: "hidden" });
		yield* waitForAddParam(page, false);
	});

const withSavedViewBrowser = <E, R>(
	run: (page: Playwright.Page, workspaceUrl: string) => Effect.Effect<void, E, R>,
	options = { viewport: { width: 1280, height: 800 } },
) =>
	Effect.gen(function* () {
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage(options);
		const { homeUrl } = yield* signInThroughHostedOAuth(page, email, password);
		yield* run(page, homeUrl);
	});

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

it.live("automatically populates and translates partial entities visible in a saved view", () =>
	Effect.gen(function* () {
		const id = crypto.randomUUID();
		const schemaSlug = `browser-interest-${id}`;
		const translatedName = `Registro traducido ${id}`;
		const user = yield* createTestUser();
		const client = makeSession(getApiUrl(), { Authorization: `Bearer ${user.token}` });
		yield* setUserLanguage(client, "es");
		const offlineProvider = yield* installTestProvider({
			client,
			rootEntitySchemaSlug: schemaSlug,
			information: { source: "e2e", canonicalLanguage: "en" },
			translations: fakeProviderTranslations({ es: { name: translatedName, properties: {} } }),
			details: fakeProviderDetailsResult({
				name: `Populated record ${id}`,
				properties: { publishYear: 2042 },
			}),
			entitySchemas: [
				{
					icon: "file",
					eventSchemas: [],
					slug: schemaSlug,
					name: "Browser Interest Record",
					propertiesSchema: {
						fields: {
							publishYear: { type: "integer", label: "Year", description: "Publication year" },
						},
					},
				},
			],
		});
		yield* Effect.addFinalizer(() => uninstallTestProvider(offlineProvider));
		const entity = yield* createEntity(client, {
			properties: {},
			externalId: id,
			name: `Partial record ${id}`,
			providerId: offlineProvider.providerId,
			entitySchemaSlug: makeEntitySchemaSlug(schemaSlug),
		});
		const view = yield* createSavedView(client, {
			name: `Interest View ${id}`,
			entitySchemaSlug: makeEntitySchemaSlug(schemaSlug),
			layouts: buildSavedViewLayouts({}, [schemaSlug]),
		});
		expect((yield* getEntity(client, entity.id)).populatedAt).toBeNull();
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ locale: "en-US" });
		yield* signInThroughHostedOAuth(page, user.email, user.password);
		yield* page.goto(`${getFrontendUrl()}/v/${view.slug}`);
		const card = page.getByRole("link", { name: `Open ${translatedName}`, exact: true });
		yield* card.waitFor({ state: "visible", timeout: IMPORT_TIMEOUT });
		yield* page.getByText("2,042", { exact: true }).waitFor({ state: "visible" });
		expect(yield* card.isVisible()).toBe(true);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("opens the provider add flow from every saved-view affordance", () =>
	withSavedViewBrowser((page, workspaceUrl) =>
		Effect.gen(function* () {
			yield* openSavedView(page, viewUrl, workspaceUrl);
			yield* headerAdd(page).waitFor({ state: "visible" });
			yield* fab(page).waitFor({ state: "hidden" });

			yield* headerAdd(page).click();
			yield* openedDialog(page);
			yield* providerChip(page).waitForFunction(
				(element) => element.getAttribute("aria-checked") === "true",
				undefined,
				{ timeout: 15_000 },
			);
			yield* closedDialog(page);

			yield* page.keyboard.press("a");
			yield* openedDialog(page);
			yield* closedDialog(page);

			const searchOnline = page.getByRole("button", { name: "Search online" });
			yield* searchOnline.click();
			yield* openedDialog(page);
			expect(yield* modalSearch(page).inputValue()).toBe("");
			yield* closedDialog(page);

			yield* page.keyboard.press("/");
			yield* waitForActiveElementAttribute(page, "type", "search");
			expect(yield* pageSearch(page).inputValue()).toBe("");
		}),
	).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("clears then releases the search field on Escape so page shortcuts return", () =>
	withSavedViewBrowser((page, workspaceUrl) =>
		Effect.gen(function* () {
			yield* openSavedView(page, viewUrl, workspaceUrl);

			yield* page.keyboard.press("/");
			yield* waitForActiveElementAttribute(page, "type", "search");
			yield* page.keyboard.type("dune");
			yield* waitForInputValue(pageSearch(page), "dune");

			yield* page.keyboard.press("Escape");
			yield* waitForInputValue(pageSearch(page), "");
			expect(yield* activeElementAttribute(page, "type")).toBe("search");

			yield* page.keyboard.press("Escape");
			yield* waitForActiveElementAttribute(page, "type", "search", false);

			yield* page.keyboard.press("a");
			yield* openedDialog(page);
			yield* closedDialog(page);
		}),
	).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("seeds the provider search from the no-matches action and guards page shortcuts", () =>
	withSavedViewBrowser((page, workspaceUrl) =>
		Effect.gen(function* () {
			yield* openSavedView(page, viewUrl, workspaceUrl, { coldLoad: true });
			yield* pageSearch(page).fill(NO_MATCH_QUERY);
			const noMatches = page.getByRole("button", {
				name: `Search online for “${NO_MATCH_QUERY}”`,
			});
			yield* noMatches.waitFor({ state: "visible" });
			yield* noMatches.click();
			yield* openedDialog(page);
			yield* page.waitForURL((url) => url.searchParams.get("q") === NO_MATCH_QUERY);
			yield* waitForInputValue(modalSearch(page), NO_MATCH_QUERY, { timeout: 15_000 });

			yield* providerChip(page).click();
			yield* waitForActiveElementAttribute(page, "aria-label", PROVIDER_NAME);

			const pageSearchFocused = yield* waitForActiveElementAttribute(page, "type", "search", true, {
				timeout: GUARD_TIMEOUT,
			}).pipe(
				Effect.as(true),
				Effect.orElseSucceed(() => false),
				Effect.forkChild({ startImmediately: true }),
			);
			yield* page.keyboard.press("/");
			expect(yield* Fiber.join(pageSearchFocused)).toBe(false);
			expect(yield* activeElementAttribute(page, "aria-label")).toBe(PROVIDER_NAME);

			const reopened = yield* page
				.waitForURL((url) => !url.searchParams.has("q"), { timeout: GUARD_TIMEOUT })
				.pipe(
					Effect.as(true),
					Effect.orElseSucceed(() => false),
					Effect.forkChild({ startImmediately: true }),
				);
			yield* page.keyboard.press("a");
			expect(yield* Fiber.join(reopened)).toBe(false);
			yield* dialog(page).waitFor({ state: "visible" });

			yield* page.goBack();
			yield* dialog(page).waitFor({ state: "hidden" });
			yield* waitForAddParam(page, false);
		}),
	).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("adds a provider result to the saved view and swaps the mobile affordance", () =>
	withSavedViewBrowser((page, workspaceUrl) =>
		Effect.gen(function* () {
			yield* page.setViewportSize({ width: 480, height: 900 });
			yield* openSavedView(page, viewUrl, workspaceUrl, { coldLoad: true, compact: true });
			yield* fab(page).waitFor({ state: "visible" });
			yield* headerAdd(page).waitFor({ state: "hidden" });

			yield* fab(page).click();
			yield* openedDialog(page);
			yield* modalSearch(page).fill("result");
			const addFirst = dialog(page).getByRole("button", { name: `Add ${FIRST_RESULT_TITLE}` });
			yield* addFirst.waitFor({ state: "visible" });
			yield* dialog(page)
				.getByRole("button", { name: `Add ${SECOND_RESULT_TITLE}` })
				.waitFor({ state: "visible" });

			yield* addFirst.click();
			yield* dialog(page)
				.getByRole("link", { name: `Open ${FIRST_RESULT_TITLE} in library` })
				.waitFor({ state: "visible", timeout: IMPORT_TIMEOUT });

			yield* closedDialog(page);
			yield* page.getByText(IMPORTED_NAME).waitFor({ state: "visible" });
			yield* page.setViewportSize({ width: 1280, height: 800 });
		}),
	).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);
