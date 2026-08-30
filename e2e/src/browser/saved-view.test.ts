import { pluginClientCatalogRecipe } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	buildSavedViewLayouts,
	createEntity,
	createEntityBrowserSavedView,
	createSavedView,
	createTestUser,
	executeRyotQLRecipe,
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
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { browserLayer, signInThroughHostedOAuth } from "~/support/browser";
import { afterAll, beforeAll, expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/frontend";

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

let email: string;
let password: string;
let viewUrl: string;
let provider: InstalledTestProvider;

const modalSearch = (page: Playwright.Page) => dialog(page).getByLabel("Search providers");
const dialog = (page: Playwright.Page) => page.getByRole("dialog", { name: MODAL_LABEL });
const providerChip = (page: Playwright.Page) =>
	dialog(page).getByRole("radio", { name: PROVIDER_NAME });

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
			const ownerPluginId = requirePresent(
				(yield* executeRyotQLRecipe(client, pluginClientCatalogRecipe())).items.find(
					({ slug }) => slug === provider.pluginSlug,
				)?.pluginId,
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
		expect((yield* getEntity(client, entity.id)).populationStatus).toBe("pending");
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ locale: "en-US" });
		yield* signInThroughHostedOAuth(page, user.email, user.password);
		yield* page.goto(`${getFrontendUrl()}/v/${view.slug}`);
		yield* page
			.getByText("1 populating", { exact: true })
			.waitFor({ state: "visible", timeout: IMPORT_TIMEOUT });
		const card = page.getByRole("link", { name: `Open ${translatedName}`, exact: true });
		yield* card.waitFor({ state: "visible", timeout: IMPORT_TIMEOUT });
		yield* page.getByText("2,042", { exact: true }).waitFor({ state: "visible" });
		yield* page.getByText("populating", { exact: false }).waitFor({ state: "hidden" });
		yield* page.getByText("translating", { exact: false }).waitFor({ state: "hidden" });
		expect(yield* card.isVisible()).toBe(true);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("marks a saved-view row whose translation is still outstanding", () =>
	Effect.gen(function* () {
		const id = crypto.randomUUID();
		const user = yield* createTestUser();
		const schemaSlug = `browser-translating-${id}`;
		const sourceName = `Untranslated record ${id}`;
		const client = makeSession(getApiUrl(), { Authorization: `Bearer ${user.token}` });
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
							publishYear: { type: "integer", label: "Year", description: "Publication year" },
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
			entitySchemaSlug: makeEntitySchemaSlug(schemaSlug),
			layouts: buildSavedViewLayouts({}, [schemaSlug]),
		});
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ locale: "en-US" });
		yield* signInThroughHostedOAuth(page, user.email, user.password);
		yield* page.goto(`${getFrontendUrl()}/v/${view.slug}`);
		yield* page
			.getByText("2,043", { exact: true })
			.waitFor({ state: "visible", timeout: IMPORT_TIMEOUT });
		yield* page
			.getByText("1 translating", { exact: true })
			.waitFor({ state: "visible", timeout: IMPORT_TIMEOUT });
		yield* page.getByText("populating", { exact: false }).waitFor({ state: "hidden" });
		expect((yield* getEntity(client, entity.id)).translationStatus).toBe("pending");
		expect(
			yield* page.getByRole("link", { name: `Open ${sourceName}`, exact: true }).isVisible(),
		).toBe(true);
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
		yield* runtime.getByRole("heading", { level: 1, name: "Entity browser" }).waitFor();
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
		yield* dialog(page).waitFor({ state: "hidden", timeout: IMPORT_TIMEOUT });
		yield* page.waitForURL((url) => !url.searchParams.has("add"));
		expect(new URL(page.url()).searchParams.get("keep")).toBe("1");
		expect(new URL(page.url()).searchParams.get("layout")).toBe("grid");
		yield* runtime.getByText(IMPORTED_NAME, { exact: true }).waitFor({
			state: "visible",
			timeout: IMPORT_TIMEOUT,
		});
		expect(yield* runtime.getByText(IMPORTED_NAME, { exact: true }).count).toBe(1);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);
