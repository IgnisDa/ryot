import {
	column,
	defineRecipe,
	eq,
	literal,
	selectedField,
	selectedOptionalRow,
	table,
} from "@ryot-app/ryotql";
import { Effect, Result, Schema } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	buildSavedViewDataSources,
	createAuthenticatedClient,
	createEntity,
	createEntityBrowserSavedView,
	createSavedView,
	executeRyotQLRecipe,
	fakeProviderDetailsResult,
	fakeProviderSearchResult,
	fakeProviderTranslations,
	findSavedViewById,
	getEntity,
	installTestProvider,
	makeEntitySchemaSlug,
	pollUntil,
	setUserLanguage,
	uninstallTestProvider,
	type InstalledTestProvider,
} from "~/fixtures/kernel";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { browserLayer, signInThroughHostedOAuth } from "~/support/browser";
import { afterAll, beforeAll, expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const SUITE_ID = crypto.randomUUID();
const VIEW_NAME = `Browser View ${SUITE_ID}`;
const PROVIDER_NAME = "Saved View Fake Provider";
const PLUGIN_SLUG = `saved-view-add-${SUITE_ID}`;
const IMPORTED_NAME = `Saved View Imported ${SUITE_ID}`;
const FIRST_EXTERNAL_ID = `saved-view-add-first-${SUITE_ID}`;
const FIRST_RESULT_TITLE = `Saved View Result One ${SUITE_ID}`;
const ENTITY_SCHEMA_SLUG = `saved-view-add-record-${SUITE_ID}`;
const SECOND_EXTERNAL_ID = `saved-view-add-second-${SUITE_ID}`;
const SECOND_RESULT_TITLE = `Saved View Result Two ${SUITE_ID}`;

const IMPORT_TIMEOUT = 150_000;
const MODAL_LABEL = "Add from a provider";
const PROVIDER_SLUG = `${ENTITY_SCHEMA_SLUG}.saved-view-add`;
const plugin = table("plugin", "savedViewPlugin");
const pluginIdRecipe = (slug: string) =>
	defineRecipe(() => ({
		map: ({ plugin: row }) => Result.succeed(row?.id ?? null),
		queries: {
			plugin: selectedOptionalRow(plugin, {
				where: eq(column(plugin, "slug"), literal(slug)),
				selection: { id: selectedField(column(plugin, "id"), Schema.String) },
			}),
		},
	}))();

let email: string;
let password: string;
let viewUrl: string;
let provider: InstalledTestProvider;

const modalSearch = (page: Playwright.Page) => dialog(page).getByLabel("Search providers");
const dialog = (page: Playwright.Page) => page.getByRole("dialog", { name: MODAL_LABEL });
const providerChip = (page: Playwright.Page) =>
	dialog(page).getByRole("radio", { name: PROVIDER_NAME });
const runtimeOf = (page: Playwright.Page) => page.locator("iframe").contentFrame();
const fab = (runtime: Playwright.FrameLocator) =>
	runtime.getByRole("button", { name: "Add to this view" });
const headerAdd = (runtime: Playwright.FrameLocator) =>
	runtime.getByRole("button", { name: "Add", exact: true });
const pageSearch = (runtime: Playwright.FrameLocator) =>
	runtime.getByRole("searchbox", { name: `Search ${VIEW_NAME}` });
const closeModal = (page: Playwright.Page) =>
	dialog(page).getByRole("button", { name: /^(Close|Cancel)$/ });

const isFocused = (locator: Playwright.Locator) =>
	locator.evaluate((element) => element === element.ownerDocument.activeElement);

const waitForFocus = (locator: Playwright.Locator, focused: boolean) =>
	locator.waitForFunction(
		(element, expected: boolean) => (element === element.ownerDocument.activeElement) === expected,
		focused,
	);

const waitForInputValue = (locator: Playwright.Locator, value: string) =>
	locator.waitForFunction(
		(element, expected: string) => Reflect.get(element, "value") === expected,
		value,
	);

const waitForAddParam = (page: Playwright.Page, present: boolean) =>
	page.waitForURL((url) => url.searchParams.has("add") === present);

const openedDialog = (page: Playwright.Page) =>
	Effect.gen(function* () {
		yield* dialog(page).waitFor({ state: "visible" });
		yield* waitForAddParam(page, true);
	});

const closedDialog = (page: Playwright.Page) =>
	Effect.gen(function* () {
		yield* closeModal(page).click();
		yield* dialog(page).waitFor({ state: "hidden" });
		yield* waitForAddParam(page, false);
	});

const openSavedView = (page: Playwright.Page) =>
	Effect.gen(function* () {
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(viewUrl);
		const runtime = runtimeOf(page);
		yield* runtime.getByRole("heading", { level: 1, name: VIEW_NAME }).waitFor();
		return runtime;
	});

beforeAll(async () => {
	const viewSlug = await Effect.runPromise(
		Effect.gen(function* () {
			const user = yield* createAuthenticatedClient();
			email = user.email;
			password = user.password;
			const client = user.client;
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
					{ title: FIRST_RESULT_TITLE, externalId: FIRST_EXTERNAL_ID },
					{ title: SECOND_RESULT_TITLE, externalId: SECOND_EXTERNAL_ID },
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
			const ownerPluginId = requirePresent(
				yield* executeRyotQLRecipe(client, pluginIdRecipe(provider.pluginSlug)),
				"Installed provider owner plugin ID was not found",
			);
			const settings = {
				pageSize: 10,
				sortChoices: [],
				tableColumns: null,
				sourceName: "entities",
				searchFields: ["name"],
				entityIdField: "entityId",
				defaultLayout: "grid" as const,
				layouts: ["grid", "list"] as const,
				ownerPluginIdField: "ownerPluginId",
				entitySchemaSlugField: "entitySchemaSlug",
				addAction: {
					ownerPluginId,
					type: "provider-search" as const,
					entitySchemaSlug: makeEntitySchemaSlug(ENTITY_SCHEMA_SLUG),
				},
			};
			const mismatch = yield* Effect.flip(
				createEntityBrowserSavedView(
					client,
					{
						name: `${VIEW_NAME} mismatched owner`,
						settings: {
							...settings,
							addAction: { ...settings.addAction, ownerPluginId: "wrong-plugin-id" },
						},
					},
					[],
					ENTITY_SCHEMA_SLUG,
					ownerPluginId,
				),
			);
			assertTaggedError(mismatch, "SavedViewBadRequest");
			expect(mismatch.reason).toMatchObject({ code: "settings-incompatible" });
			const view = yield* createEntityBrowserSavedView(
				client,
				{ settings, name: VIEW_NAME },
				[],
				ENTITY_SCHEMA_SLUG,
				ownerPluginId,
			);
			return (yield* findSavedViewById(client, view.id)).slug;
		}),
	);
	viewUrl = `${getFrontendUrl()}/v/${viewSlug}`;
});

afterAll(async () => {
	await Effect.runPromise(uninstallTestProvider(provider));
});

it.live("automatically populates and translates entities rendered by a saved view", () =>
	Effect.gen(function* () {
		const id = crypto.randomUUID();
		const schemaSlug = `browser-interest-${id}`;
		const translatedName = `Registro traducido ${id}`;
		const user = yield* createAuthenticatedClient();
		const client = user.client;
		yield* setUserLanguage(client, "es");
		const offlineProvider = yield* installTestProvider({
			client,
			rootEntitySchemaSlug: schemaSlug,
			information: { source: "e2e", canonicalLanguage: "en" },
			translations: fakeProviderTranslations({ es: { properties: {}, name: translatedName } }),
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
							publishYear: { label: "Year", type: "integer", description: "Publication year" },
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
			dataSources: buildSavedViewDataSources([schemaSlug]),
		});
		const viewRecord = yield* findSavedViewById(client, view.id);
		expect((yield* getEntity(client, entity.id)).populationStatus).toBe("pending");
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ locale: "en-US" });
		yield* signInThroughHostedOAuth(page, user.email, user.password);
		yield* page.goto(`${getFrontendUrl()}/v/${viewRecord.slug}`);
		const runtime = page.locator("iframe").contentFrame();
		yield* runtime.getByRole("heading", { level: 1, name: `Interest View ${id}` }).waitFor();
		yield* pollUntil(
			"saved-view entity population and translation",
			getEntity(client, entity.id).pipe(
				Effect.map((current) =>
					current.populationStatus === "ready" && current.translationStatus === "ready"
						? current
						: null,
				),
			),
		);
		yield* runtime
			.getByText(translatedName, { exact: true })
			.waitFor({ state: "visible", timeout: IMPORT_TIMEOUT });
		yield* runtime.getByRole("radio", { name: "Table view" }).click();
		yield* runtime
			.getByText(translatedName, { exact: true })
			.waitFor({ state: "visible", timeout: IMPORT_TIMEOUT });
		yield* runtime.getByText("2,042", { exact: true }).waitFor({ state: "visible" });
		expect((yield* getEntity(client, entity.id)).name).toBe(translatedName);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("keeps source data visible when saved-view translation is outstanding", () =>
	Effect.gen(function* () {
		const id = crypto.randomUUID();
		const user = yield* createAuthenticatedClient();
		const schemaSlug = `browser-translating-${id}`;
		const sourceName = `Untranslated record ${id}`;
		const client = user.client;
		yield* setUserLanguage(client, "es");
		const untranslatedProvider = yield* installTestProvider({
			client,
			rootEntitySchemaSlug: schemaSlug,
			information: { source: "e2e", canonicalLanguage: "en" },
			details: fakeProviderDetailsResult({ name: sourceName, properties: { publishYear: 2043 } }),
			entitySchemas: [
				{
					icon: "file",
					eventSchemas: [],
					slug: schemaSlug,
					name: "Browser Translating Record",
					propertiesSchema: {
						fields: {
							publishYear: { label: "Year", type: "integer", description: "Publication year" },
						},
					},
				},
			],
		});
		yield* Effect.addFinalizer(() => uninstallTestProvider(untranslatedProvider));
		const entity = yield* createEntity(client, {
			properties: {},
			externalId: id,
			name: sourceName,
			providerId: untranslatedProvider.providerId,
			entitySchemaSlug: makeEntitySchemaSlug(schemaSlug),
		});
		const view = yield* createSavedView(client, {
			name: `Translating View ${id}`,
			dataSources: buildSavedViewDataSources([schemaSlug]),
		});
		const viewRecord = yield* findSavedViewById(client, view.id);
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ locale: "en-US" });
		yield* signInThroughHostedOAuth(page, user.email, user.password);
		yield* page.goto(`${getFrontendUrl()}/v/${viewRecord.slug}`);
		const runtime = page.locator("iframe").contentFrame();
		yield* pollUntil(
			"saved-view entity population with pending translation",
			getEntity(client, entity.id).pipe(
				Effect.map((current) =>
					current.populationStatus === "ready" && current.translationStatus === "pending"
						? current
						: null,
				),
			),
		);
		yield* page.reload;
		yield* runtime
			.getByRole("heading", { level: 1, name: `Translating View ${id}` })
			.waitFor({ state: "visible" });
		yield* runtime.getByRole("radio", { name: "Table view" }).click();
		yield* runtime
			.getByText("2,043", { exact: true })
			.waitFor({ state: "visible", timeout: IMPORT_TIMEOUT });
		expect((yield* getEntity(client, entity.id)).translationStatus).toBe("pending");
		expect(yield* runtime.getByText(sourceName, { exact: true }).isVisible()).toBe(true);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("imports through the configured renderer provider search and refreshes membership", () =>
	Effect.gen(function* () {
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${viewUrl}?keep=1&layout=grid`);
		const frame = page.locator("iframe");
		const runtime = frame.contentFrame();
		yield* runtime.getByRole("heading", { level: 1, name: VIEW_NAME }).waitFor();
		yield* runtime.getByRole("button", { name: "Add", exact: true }).click();
		yield* dialog(page).waitFor({ state: "visible" });
		yield* page.waitForURL((url) => url.searchParams.get("add") === "true");
		expect(new URL(page.url()).searchParams.get("keep")).toBe("1");
		expect(new URL(page.url()).searchParams.get("layout")).toBe("grid");
		expect(yield* frame.getAttribute("inert")).not.toBeNull();
		yield* providerChip(page).waitForFunction(
			(element) => element.getAttribute("aria-checked") === "true",
			undefined,
			{ timeout: 15_000 },
		);

		yield* modalSearch(page).fill("result");
		const addFirst = dialog(page).getByRole("button", { name: `Add ${FIRST_RESULT_TITLE}` });
		yield* addFirst.waitFor({ state: "visible" });
		yield* addFirst.click();
		yield* dialog(page)
			.getByRole("link", { name: `Open ${FIRST_RESULT_TITLE} in media library` })
			.waitFor({ state: "visible", timeout: IMPORT_TIMEOUT });
		expect(yield* dialog(page).isVisible()).toBe(true);
		expect(new URL(page.url()).searchParams.get("add")).toBe("true");

		yield* closedDialog(page);
		expect(new URL(page.url()).searchParams.get("keep")).toBe("1");
		expect(new URL(page.url()).searchParams.get("layout")).toBe("grid");
		yield* runtime
			.getByText(IMPORTED_NAME, { exact: true })
			.waitFor({ state: "visible", timeout: IMPORT_TIMEOUT });
		expect(yield* runtime.getByText(IMPORTED_NAME, { exact: true }).count).toBe(1);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("focuses the view search on / and releases it so page shortcuts return", () =>
	Effect.gen(function* () {
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 800 } });
		const runtime = yield* openSavedView(page);
		yield* pageSearch(runtime).waitFor({ state: "visible" });

		yield* page.keyboard.press("/");
		yield* waitForFocus(pageSearch(runtime), true);
		yield* page.keyboard.type("dune");
		yield* waitForInputValue(pageSearch(runtime), "dune");
		yield* page.waitForURL((url) => url.searchParams.get("search") === "dune");
		expect(yield* isFocused(pageSearch(runtime))).toBe(true);

		yield* page.keyboard.press("Escape");
		yield* waitForInputValue(pageSearch(runtime), "");
		yield* page.waitForURL((url) => url.searchParams.get("search") === null);
		expect(yield* isFocused(pageSearch(runtime))).toBe(true);

		yield* page.keyboard.press("Escape");
		yield* waitForFocus(pageSearch(runtime), false);

		yield* page.keyboard.press("a");
		yield* openedDialog(page);
		yield* closedDialog(page);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("suppresses view shortcuts while the provider modal owns the screen", () =>
	Effect.gen(function* () {
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 800 } });
		const runtime = yield* openSavedView(page);

		yield* headerAdd(runtime).click();
		yield* openedDialog(page);
		expect(yield* page.locator("iframe").getAttribute("inert")).not.toBeNull();

		yield* page.keyboard.press("/");
		yield* page.keyboard.press("a");
		expect(yield* isFocused(pageSearch(runtime))).toBe(false);
		expect(yield* dialog(page).count).toBe(1);
		expect(new URL(page.url()).searchParams.get("add")).toBe("true");

		yield* closedDialog(page);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("swaps the desktop add button for the mobile add affordances", () =>
	Effect.gen(function* () {
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 480, height: 900 } });
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(viewUrl);
		const runtime = runtimeOf(page);
		yield* fab(runtime).waitFor({ state: "visible" });
		expect(yield* headerAdd(runtime).count).toBe(0);

		yield* runtime.getByRole("button", { name: "View options, 0 active filters" }).click();
		const sheet = runtime.getByRole("dialog", { name: "View options" });
		yield* sheet.waitFor({ state: "visible" });
		expect(yield* sheet.getByText("Filters are not available yet.").isVisible()).toBe(true);
		yield* runtime.getByRole("button", { name: "Close view options" }).click();
		yield* sheet.waitFor({ state: "hidden" });

		yield* runtime.getByRole("button", { name: "Search this view" }).click();
		yield* waitForFocus(pageSearch(runtime), true);
		yield* runtime.getByRole("button", { name: "Exit search" }).click();

		yield* fab(runtime).click();
		yield* openedDialog(page);
		yield* closedDialog(page);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);
