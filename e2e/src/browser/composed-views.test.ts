import { DateTime, Effect, Option } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	buildComposedClientRendererDefinition,
	buildCollectionWorkflowRendererDefinition,
	buildEntityBrowserSavedViewPayload,
	buildNamedDataSources,
	buildNamedDataSourcesRendererDefinition,
	createClientRenderer,
	createCollection,
	createEntity,
	createEntityBrowserSavedView,
	createEntitySchema,
	createEventFixture,
	createEventSchema,
	createRendererSavedView,
	createResultsTableSavedView,
	createTestUser,
	encodeClientRendererSource,
	fakeProviderDetailsResult,
	getBuiltinEntitySchemaSlug,
	getEntity,
	installFixtureClientPlugin,
	installTestProvider,
	listEntitySchemas,
	listEventSchemas,
	FIXTURE_CLIENT_PLUGIN_SLUG,
	makeSession,
	publishClientRenderer,
	replaceClientRendererDraft,
	requireEventSchemaBySlug,
} from "~/fixtures/kernel";
import {
	createWorkoutEntityFixture,
	findWorkoutSetEventSchema,
	waitForSeededExerciseId,
	waitForSessionEventCount,
} from "~/fixtures/plugins/fitness";
import { seedGlobalShowEpisodeTree } from "~/fixtures/plugins/media";
import { getApiUrl } from "~/support/api";
import { requirePresent } from "~/support/assertions";
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

it.live("renders system and private public components in one shared page runtime", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const { token, email, password } = yield* createTestUser(apiUrl);
		const client = makeSession(apiUrl, { Authorization: `Bearer ${token}` });
		yield* installFixtureClientPlugin(client, "A", "", apiUrl);
		const renderer = yield* createClientRenderer(client, {
			draftDefinition: buildComposedClientRendererDefinition(),
		});
		yield* publishClientRenderer(client, renderer.id, renderer.draftRevision);
		const view = yield* createRendererSavedView(client, renderer.id, {
			label: "Task 02 browser setting",
		});

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/v/${view.slug}`);

		const frames = page.locator("iframe");
		yield* frames.waitFor({ state: "visible" });
		expect(yield* frames.count).toBe(1);
		const runtime = frames.first().contentFrame();
		yield* runtime
			.getByRole("heading", { level: 1, name: "Task 02 composed page", exact: true })
			.waitFor({ state: "visible" });
		const application = runtime.locator("#app");
		expect(yield* application.count).toBe(1);
		yield* expectVisibleText(application, "3 episodes watched, 5 episodes remaining");
		yield* application
			.getByRole("heading", { level: 3, name: "E2E deterministic Pokemon types", exact: true })
			.waitFor({ state: "visible" });
		yield* expectVisibleText(application, "grass");
		yield* expectVisibleText(application, "poison");
		yield* expectVisibleText(application, "Renderer setting: Task 02 browser setting");
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("adds an outside Pokemon through the published collection workflow and persists it", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const { token, email, password } = yield* createTestUser(apiUrl);
		const client = makeSession(apiUrl, { Authorization: `Bearer ${token}` });
		yield* installFixtureClientPlugin(client, "A", "", apiUrl);
		const pokemonSchema = requirePresent(
			(yield* listEntitySchemas(client, {
				slugs: ["pokemon"],
				pluginSlug: FIXTURE_CLIENT_PLUGIN_SLUG,
			}))[0],
			"Fixture Pokemon schema was not registered",
		);
		const { showId } = yield* seedGlobalShowEpisodeTree(client, {
			showName: "01 Task 07 Show",
		});
		const { workoutId } = yield* createWorkoutEntityFixture(client, {
			name: "02 Task 07 Workout",
		});
		const [pokemonA, pokemonB] = yield* Effect.all([
			createEntity(client, {
				name: "03 Task 07 Pokemon A",
				properties: { types: ["Grass"] },
				entitySchemaSlug: pokemonSchema.id,
			}),
			createEntity(client, {
				name: "04 Task 07 Pokemon B",
				properties: { types: ["Fire"] },
				entitySchemaSlug: pokemonSchema.id,
			}),
		]);
		const collection = yield* createCollection(client, { name: "Task 07 collection" });
		yield* Effect.forEach([showId, workoutId, pokemonA.id], (entityId) =>
			client.call((contract) =>
				contract.collections.createMembership({
					payload: { entityId, collectionId: collection.id },
				}),
			),
		);
		const renderer = yield* createClientRenderer(client, {
			draftDefinition: buildCollectionWorkflowRendererDefinition(),
		});
		yield* publishClientRenderer(client, renderer.id, renderer.draftRevision);
		const view = yield* createRendererSavedView(
			client,
			renderer.id,
			{ collectionId: collection.id, pageSize: 2 },
			{ name: "Task 07 collection workflow" },
		);

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/v/${view.slug}?keep=preserved`);
		let runtime = page.locator("iframe").contentFrame();
		yield* runtime
			.getByRole("heading", { level: 1, name: "Task 07 collection workflow" })
			.waitFor();
		yield* expectVisibleText(runtime.locator("body"), "3 total");
		yield* expectVisibleText(runtime.locator("body"), "1 Pokemon");
		yield* runtime.getByRole("button", { name: "Invoke fixture greeting" }).click();
		yield* expectVisibleText(runtime.locator("body"), "Hello, Media collection page");
		yield* runtime.getByRole("button", { name: "Load next page" }).click();
		yield* runtime
			.getByRole("link", { name: "03 Task 07 Pokemon A", exact: true })
			.waitFor({ state: "visible" });

		const addPokemon = runtime.getByRole("button", {
			name: "Add 04 Task 07 Pokemon B to collection",
		});
		yield* addPokemon.click();
		yield* page.waitForURL(
			(url) =>
				url.searchParams.get("dialog") === "add-to-collection" &&
				url.searchParams.get("entityId") === pokemonB.id,
		);
		runtime = page.locator("iframe").contentFrame();
		const firstDialog = runtime.getByRole("dialog", { name: "Choose a collection" });
		yield* firstDialog.waitFor();
		expect(yield* firstDialog.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(
			true,
		);
		expect(yield* runtime.locator("body").evaluate((body) => body.style.overflow)).toBe("hidden");
		expect(yield* runtime.locator("#app").getAttribute("inert")).toBe("");
		yield* page.goBack();
		yield* page.waitForURL((url) => url.searchParams.get("dialog") === null);
		runtime = page.locator("iframe").contentFrame();
		expect(new URL(page.url()).searchParams.get("keep")).toBe("preserved");
		expect(yield* runtime.getByRole("dialog").count).toBe(0);
		yield* expectVisibleText(runtime.locator("body"), "3 total");

		yield* runtime.getByRole("button", { name: "Add 04 Task 07 Pokemon B to collection" }).click();
		runtime = page.locator("iframe").contentFrame();
		yield* runtime.getByRole("radio", { name: collection.name }).click();
		yield* runtime.getByRole("button", { name: "Review" }).click();
		yield* runtime.getByRole("heading", { name: "Review collection change" }).waitFor();
		yield* runtime.getByRole("button", { name: "Confirm" }).click();
		yield* page.waitForURL((url) => url.searchParams.get("dialog") === null);
		runtime = page.locator("iframe").contentFrame();
		yield* expectVisibleText(runtime.locator("body"), "4 total");
		yield* expectVisibleText(runtime.locator("body"), "2 Pokemon");
		yield* runtime
			.getByRole("link", { name: "04 Task 07 Pokemon B", exact: true })
			.waitFor({ state: "visible" });

		yield* page.reload;
		runtime = page.locator("iframe").contentFrame();
		yield* expectVisibleText(runtime.locator("body"), "4 total");
		yield* expectVisibleText(runtime.locator("body"), "2 Pokemon");
		yield* runtime.getByRole("button", { name: "Load next page" }).click();
		yield* runtime
			.getByRole("link", { name: "04 Task 07 Pokemon B", exact: true })
			.waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("preserves expanded and dialog state when provider population completes", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const { token, email, password } = yield* createTestUser(apiUrl);
		const client = makeSession(apiUrl, { Authorization: `Bearer ${token}` });
		yield* installFixtureClientPlugin(client, "A", "", apiUrl);
		const pokemonSchema = requirePresent(
			(yield* listEntitySchemas(client, {
				slugs: ["pokemon"],
				pluginSlug: FIXTURE_CLIENT_PLUGIN_SLUG,
			}))[0],
			"Fixture Pokemon schema was not registered",
		);
		const provider = yield* installTestProvider({
			client,
			detailsDelayMs: 20_000,
			rootEntitySchemaSlug: pokemonSchema.id,
			details: fakeProviderDetailsResult({
				name: "Task 08 Populated Pokemon",
				properties: {
					height: 7,
					weight: 69,
					types: ["Grass", "Poison"],
					abilities: ["Overgrow", "Chlorophyll"],
				},
			}),
		});
		const outsidePokemon = yield* createEntity(client, {
			name: "Task 08 Outside Pokemon",
			properties: { types: ["Fire"] },
			entitySchemaSlug: pokemonSchema.id,
		});
		const collection = yield* createCollection(client, { name: "Task 08 collection" });
		const renderer = yield* createClientRenderer(client, {
			draftDefinition: buildCollectionWorkflowRendererDefinition(),
		});
		yield* publishClientRenderer(client, renderer.id, renderer.draftRevision);
		const view = yield* createRendererSavedView(
			client,
			renderer.id,
			{ collectionId: collection.id, pageSize: 10 },
			{ name: "Task 08 state preservation" },
		);

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		yield* signInThroughHostedOAuth(page, email, password);
		const partialPokemon = yield* createEntity(client, {
			properties: {},
			name: "Task 08 Partial Pokemon",
			providerId: provider.providerId,
			entitySchemaSlug: pokemonSchema.id,
			externalId: `task-08-${crypto.randomUUID()}`,
		});
		yield* client.call((contract) =>
			contract.collections.createMembership({
				payload: { entityId: partialPokemon.id, collectionId: collection.id },
			}),
		);
		expect((yield* getEntity(client, partialPokemon.id)).populationStatus).toBe("pending");
		yield* page.goto(`${getFrontendUrl()}/v/${view.slug}`);
		const frames = page.locator("iframe");
		yield* frames.waitFor({ state: "visible" });
		const iframe = Option.getOrThrow(yield* frames.first().elementHandle());
		let runtime = frames.contentFrame();
		yield* runtime
			.getByRole("heading", { level: 1, name: "Task 07 collection workflow" })
			.waitFor();
		const application = runtime.locator("#app");
		const app = Option.getOrThrow(yield* application.elementHandle());
		const pokemon = runtime
			.locator(`[data-entity-id="${partialPokemon.id}"][data-layout="row"]`)
			.filter({ visible: true });
		yield* pokemon.scrollIntoViewIfNeeded();
		yield* expectVisibleText(pokemon, "Task 08 Partial Pokemon");
		yield* expectVisibleText(runtime.locator("body"), "1 syncing");
		yield* pokemon.getByRole("button", { name: "Show details" }).click();

		yield* runtime
			.getByRole("button", { name: "Add Task 08 Outside Pokemon to collection" })
			.click();
		yield* page.waitForURL(
			(url) =>
				url.searchParams.get("dialog") === "add-to-collection" &&
				url.searchParams.get("entityId") === outsidePokemon.id,
		);
		runtime = frames.contentFrame();
		const chooseDialog = runtime.getByRole("dialog", { name: "Choose a collection" });
		yield* chooseDialog.getByRole("radio", { name: collection.name }).click();
		yield* chooseDialog.getByRole("button", { name: "Review" }).click();
		const reviewDialog = runtime.getByRole("dialog", { name: "Review collection change" });
		const dialogElement = Option.getOrThrow(yield* reviewDialog.elementHandle());
		yield* expectVisibleText(reviewDialog, "Add Task 08 Outside Pokemon to Task 08 collection?");
		const activePokemon = runtime
			.locator(`[data-entity-id="${partialPokemon.id}"][data-layout="row"]`)
			.filter({ visible: true });
		yield* activePokemon.scrollIntoViewIfNeeded();
		yield* activePokemon.getByText("Task 08 Populated Pokemon", { exact: true }).waitFor({
			state: "visible",
			timeout: 150_000,
		});
		yield* expectVisibleText(runtime.locator("body"), "0 syncing");
		yield* expectVisibleText(activePokemon, "Grass");
		yield* expectVisibleText(activePokemon, "Poison");
		expect(yield* frames.first().evaluate((current, initial) => current === initial, iframe)).toBe(
			true,
		);
		expect(yield* application.evaluate((current, initial) => current === initial, app)).toBe(true);
		expect(
			yield* reviewDialog.evaluate((current, initial) => current === initial, dialogElement),
		).toBe(true);

		yield* page.goBack();
		yield* page.waitForURL((url) => url.searchParams.get("dialog") === null);
		runtime = frames.contentFrame();
		const retainedPokemon = runtime
			.locator(`[data-entity-id="${partialPokemon.id}"][data-layout="row"]`)
			.filter({ visible: true });
		yield* retainedPokemon.getByText("Task 08 Populated Pokemon", { exact: true }).waitFor();
		expect(yield* retainedPokemon.getByRole("button", { name: "Hide details" }).isVisible()).toBe(
			true,
		);
		yield* expectVisibleText(retainedPokemon, "Overgrow, Chlorophyll");
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("preserves collection review state when a renderer update is published", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const { token, email, password } = yield* createTestUser(apiUrl);
		const client = makeSession(apiUrl, { Authorization: `Bearer ${token}` });
		yield* installFixtureClientPlugin(client, "A", "", apiUrl);
		const pokemonSchema = requirePresent(
			(yield* listEntitySchemas(client, {
				slugs: ["pokemon"],
				pluginSlug: FIXTURE_CLIENT_PLUGIN_SLUG,
			}))[0],
			"Fixture Pokemon schema was not registered",
		);
		yield* createEntity(client, {
			name: "Task 09 Outside Pokemon",
			properties: { types: ["Fire"] },
			entitySchemaSlug: pokemonSchema.id,
		});
		const collection = yield* createCollection(client, { name: "Task 09 collection" });
		const initialDefinition = buildCollectionWorkflowRendererDefinition();
		const renderer = yield* createClientRenderer(client, { draftDefinition: initialDefinition });
		yield* publishClientRenderer(client, renderer.id, renderer.draftRevision);
		const view = yield* createRendererSavedView(
			client,
			renderer.id,
			{ collectionId: collection.id, pageSize: 10 },
			{ name: "Task 09 renderer update" },
		);

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/v/${view.slug}?keep=preserved`);
		const frame = page.locator("iframe").first();
		yield* frame.waitFor({ state: "visible" });
		const iframe = Option.getOrThrow(yield* frame.elementHandle());
		const runtime = frame.contentFrame();
		yield* runtime
			.getByRole("button", { name: "Add Task 09 Outside Pokemon to collection" })
			.click();
		const chooseDialog = runtime.getByRole("dialog", { name: "Choose a collection" });
		yield* chooseDialog.getByRole("radio", { name: collection.name }).click();
		yield* chooseDialog.getByRole("button", { name: "Review" }).click();
		const reviewDialog = runtime.getByRole("dialog", { name: "Review collection change" });
		const dialogElement = Option.getOrThrow(yield* reviewDialog.elementHandle());
		yield* expectVisibleText(reviewDialog, "Add Task 09 Outside Pokemon to Task 09 collection?");
		const outerUrl = page.url();

		const changedDefinition = {
			...initialDefinition,
			files: [
				...initialDefinition.files,
				{
					path: "shared/task-09-revision.ts",
					content: encodeClientRendererSource('export const revision = "task-09";'),
				},
			],
		};
		yield* replaceClientRendererDraft(client, renderer.id, {
			draftDefinition: changedDefinition,
			expectedDraftRevision: renderer.draftRevision,
		});
		yield* publishClientRenderer(client, renderer.id, renderer.draftRevision + 1);

		yield* expectVisibleText(
			page.locator("body"),
			"An update is available. Reloading will discard unsaved local state.",
		);
		expect(yield* frame.evaluate((current, initial) => current === initial, iframe)).toBe(true);
		expect(
			yield* reviewDialog.evaluate((current, initial) => current === initial, dialogElement),
		).toBe(true);
		yield* expectVisibleText(reviewDialog, "Add Task 09 Outside Pokemon to Task 09 collection?");
		expect(page.url()).toBe(outerUrl);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("keeps configured entity-browser controls within their declared source", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const { token, email, password } = yield* createTestUser(apiUrl);
		const client = makeSession(apiUrl, { Authorization: `Bearer ${token}` });
		const schema = yield* createEntitySchema(client, {
			name: "Browser controls",
			pluginSlug: `browser-controls-${crypto.randomUUID()}`,
		});
		const [alpha, zulu, excluded] = yield* Effect.all([
			createEntity(client, {
				name: "01 Alpha member",
				properties: { title: "Alpha" },
				entitySchemaSlug: schema.schemaId,
			}),
			createEntity(client, {
				name: "02 Zulu member",
				properties: { title: "Zulu" },
				entitySchemaSlug: schema.schemaId,
			}),
			createEntity(client, {
				name: "00 Alpha excluded",
				properties: { title: "Alpha" },
				entitySchemaSlug: schema.schemaId,
			}),
		]);
		const base = buildEntityBrowserSavedViewPayload({}, [alpha.id, zulu.id]);
		const view = yield* createEntityBrowserSavedView(client, {
			dataSources: base.dataSources,
			name: "Configured entity browser",
			settings: {
				pageSize: 10,
				addAction: null,
				defaultLayout: "grid",
				sourceName: "entities",
				searchFields: ["name"],
				entityIdField: "entityId",
				layouts: ["grid", "list", "table"],
				ownerPluginIdField: "ownerPluginId",
				entitySchemaSlugField: "entitySchemaSlug",
				tableColumns: [
					{ field: "entitySchemaSlug", label: "Schema", displayKind: "text" },
					{ field: "name", label: "Name", displayKind: "text" },
				],
				sortChoices: [
					{
						name: "name-desc",
						label: "Name descending",
						orderBy: [{ field: "name", direction: "desc" }],
					},
				],
			},
		});

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/v/${view.slug}?keep=1&layout=table`);
		const runtime = page.locator("iframe").contentFrame();
		yield* runtime.getByRole("heading", { level: 1, name: "Entity browser" }).waitFor();
		expect(yield* runtime.getByRole("button", { name: "Add", exact: true }).count).toBe(0);
		expect(yield* runtime.getByRole("columnheader").allInnerTexts()).toEqual(["Schema", "Name"]);
		expect(yield* runtime.locator("tbody tr").allInnerTexts()).toEqual([
			expect.stringContaining("01 Alpha member"),
			expect.stringContaining("02 Zulu member"),
		]);
		expect(yield* runtime.getByText(excluded.name, { exact: true }).count).toBe(0);

		yield* runtime.getByRole("searchbox", { name: "Search this view" }).fill("Alpha");
		yield* page.waitForURL((url) => url.searchParams.get("search") === "Alpha");
		expect(new URL(page.url()).searchParams.get("keep")).toBe("1");
		yield* runtime.getByText("02 Zulu member", { exact: true }).waitFor({ state: "hidden" });
		yield* runtime.getByRole("searchbox", { name: "Search this view" }).fill("");

		yield* runtime.getByRole("button", { name: "Sort results: Default order" }).click();
		yield* runtime.getByRole("radio", { name: "Name descending" }).click();
		yield* page.waitForURL((url) => url.searchParams.get("sort") === "name-desc");
		expect(new URL(page.url()).searchParams.get("keep")).toBe("1");
		expect(yield* runtime.locator("tbody tr").allInnerTexts()).toEqual([
			expect.stringContaining("02 Zulu member"),
			expect.stringContaining("01 Alpha member"),
		]);

		yield* runtime.getByRole("radio", { name: "List view" }).click();
		yield* page.waitForURL((url) => url.searchParams.get("layout") === "list");
		const params = new URL(page.url()).searchParams;
		expect(params.get("keep")).toBe("1");
		expect(params.get("sort")).toBe("name-desc");
		expect(yield* runtime.getByText(excluded.name, { exact: true }).count).toBe(0);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live(
	"renders composite-key results-table rows with ordered nullable cells and entity links",
	() =>
		Effect.gen(function* () {
			const apiUrl = getApiUrl();
			const { token, email, password } = yield* createTestUser(apiUrl);
			const client = makeSession(apiUrl, { Authorization: `Bearer ${token}` });
			const schema = yield* createEntitySchema(client, {
				name: "Results table entity",
				pluginSlug: `results-table-${crypto.randomUUID()}`,
			});
			const eventSchema = yield* createEventSchema(client, {
				name: "Results table event",
				entitySchemaSlug: schema.slug,
				slug: `results-table-event-${crypto.randomUUID()}`,
			});
			const entity = yield* createEntity(client, {
				name: "Shared results entity",
				properties: { title: "Shared" },
				entitySchemaSlug: schema.schemaId,
			});
			for (const [occurredAt, note] of [
				["2026-09-07T08:00:00.000Z", "First row"],
				["2026-09-07T09:00:00.000Z", "Second row"],
			] as const) {
				yield* createEventFixture(client, {
					occurredAt,
					entityId: entity.id,
					properties: { note },
					eventSchemaSlug: eventSchema.slug,
				});
			}
			const view = yield* createResultsTableSavedView(client, {
				entityId: entity.id,
				eventSchemaSlug: eventSchema.slug,
			});

			const browser = yield* Playwright.Browser;
			const page = yield* browser.newPage();
			yield* signInThroughHostedOAuth(page, email, password);
			yield* page.goto(`${getFrontendUrl()}/v/${view.slug}`);
			const runtime = page.locator("iframe").contentFrame();
			yield* runtime.getByRole("heading", { level: 1, name: "Results table" }).waitFor();
			expect(yield* runtime.getByRole("columnheader").allInnerTexts()).toEqual([
				"Note",
				"Occurred",
				"Missing",
			]);
			const rows = runtime.locator("tbody tr");
			yield* rows.nth(1).waitFor();
			expect(yield* rows.count).toBe(2);
			expect(yield* rows.allInnerTexts()).toEqual([
				expect.stringContaining("First row"),
				expect.stringContaining("Second row"),
			]);
			expect(yield* rows.locator("td:last-child").allInnerTexts()).toEqual(["", ""]);
			expect(yield* rows.getByRole("link").count).toBe(2);
			expect(yield* rows.getByRole("link").first().getAttribute("href")).toContain(entity.id);
			expect((yield* rows.allInnerTexts()).every((row) => !row.includes("2026-09-07T"))).toBe(true);

			yield* createEventFixture(client, {
				entityId: entity.id,
				properties: { note: "Third row" },
				eventSchemaSlug: eventSchema.slug,
				occurredAt: "2026-09-07T10:00:00.000Z",
			});
			yield* runtime.getByRole("button", { name: "Refresh", exact: true }).click();
			yield* rows.getByText("Third row", { exact: true }).waitFor({ state: "visible" });
			expect(yield* rows.count).toBe(3);
		}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("decodes native, grouped, and time-series named data sources in a published page", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const { token, email, password } = yield* createTestUser(apiUrl);
		const client = makeSession(apiUrl, { Authorization: `Bearer ${token}` });
		const schema = yield* createEntitySchema(client, {
			name: "Named sources",
			pluginSlug: `named-sources-${crypto.randomUUID()}`,
		});
		const entities = yield* Effect.all([
			createEntity(client, {
				name: "Named Alpha",
				properties: { title: "Alpha" },
				entitySchemaSlug: schema.schemaId,
			}),
			createEntity(client, {
				name: "Named Beta",
				properties: { title: "Beta" },
				entitySchemaSlug: schema.schemaId,
			}),
		]);
		const start = DateTime.startOf(yield* DateTime.now, "day");
		const end = DateTime.add(start, { days: 1 });
		const renderer = yield* createClientRenderer(client, {
			draftDefinition: buildNamedDataSourcesRendererDefinition(),
		});
		yield* publishClientRenderer(client, renderer.id, renderer.draftRevision);
		const view = yield* createRendererSavedView(
			client,
			renderer.id,
			{ label: "Named sources" },
			{
				dataSources: buildNamedDataSources(
					entities.map(({ id }) => id),
					{ startAt: DateTime.formatIso(start), endAt: DateTime.formatIso(end) },
				),
			},
		);

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/v/${view.slug}`);
		const runtime = page.locator("iframe").contentFrame();
		yield* runtime.getByRole("heading", { level: 1, name: "Named data sources" }).waitFor();
		yield* expectVisibleText(runtime.locator("body"), "Native rows: Named Alpha | Named Beta");
		yield* expectVisibleText(runtime.locator("body"), `Grouped aggregate: ${schema.slug}=2`);
		yield* expectVisibleText(runtime.locator("body"), "Time series: 2");
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("keeps one rich mixed entity browser runtime across pagination and layouts", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const { token, email, password } = yield* createTestUser(apiUrl);
		const client = makeSession(apiUrl, { Authorization: `Bearer ${token}` });
		yield* installFixtureClientPlugin(client, "A", "", apiUrl);
		const uploadArtwork = (fileName: string, source: string) =>
			Effect.gen(function* () {
				const intent = yield* client.call((c) =>
					c.uploads.createIntent({
						payload: { kind: "permanent", fileName, contentType: "image/svg+xml" },
					}),
				);
				const upload = yield* Effect.promise(() =>
					fetch(new URL(intent.uploadUrl, `${apiUrl}/`), {
						body: source,
						method: intent.method,
						headers: intent.headers,
					}),
				);
				expect([200, 204]).toContain(upload.status);
				const artwork = yield* client.call((c) =>
					c.uploads.completeIntent({ params: { intentId: intent.intentId } }),
				);
				if (!("key" in artwork)) {
					throw new Error(`Expected permanent artwork for ${fileName}`);
				}
				return artwork;
			});
		const [showArtwork, pokemonArtwork] = yield* Effect.all([
			uploadArtwork(
				"composed-show.svg",
				'<svg xmlns="http://www.w3.org/2000/svg" width="60" height="90"><rect width="60" height="90" fill="#7c3aed"/></svg>',
			),
			uploadArtwork(
				"composed-pokemon.svg",
				'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="40" fill="#16a34a"/></svg>',
			),
		]);
		const fallbackSchema = yield* createEntitySchema(client, {
			name: "Mixed fallback",
			pluginSlug: `mixed-fallback-${crypto.randomUUID()}`,
		});
		const fallbackEntities = yield* Effect.forEach(
			["01 Alpha fallback", "02 Beta fallback"],
			(name) =>
				createEntity(client, {
					name,
					properties: { title: name },
					entitySchemaSlug: fallbackSchema.schemaId,
				}),
		);
		const { showId, episodeId } = yield* seedGlobalShowEpisodeTree(client, {
			showName: "03 Composed Tracer Show",
			showProperties: {
				publishYear: 2025,
				productionStatus: "Returning Series",
				images: [{ ...showArtwork, purpose: "cover" }],
			},
		});
		const episodeSchemaSlug = yield* getBuiltinEntitySchemaSlug("show-episode");
		const episodeProgressSchema = requireEventSchemaBySlug(
			yield* listEventSchemas(client, episodeSchemaSlug),
			"progress",
		);
		yield* client.call((c) =>
			c.events.create({
				payload: [
					{
						entityId: episodeId,
						properties: { progressPercent: 50 },
						occurredAt: "2026-09-07T08:30:00.000Z",
						eventSchemaSlug: episodeProgressSchema.id,
					},
				],
			}),
		);
		const { workoutId } = yield* createWorkoutEntityFixture(client, {
			endedAt: "2026-09-07T09:30:00.000Z",
			name: "04 Composed Strength Workout",
			startedAt: "2026-09-07T08:00:00.000Z",
		});
		const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);
		const exerciseId = yield* waitForSeededExerciseId(client);
		const exercise = yield* getEntity(client, exerciseId);
		yield* client.call((c) =>
			c.events.create({
				payload: [
					{
						entityId: exerciseId,
						sessionEntityId: workoutId,
						eventSchemaSlug: workoutSetEventSchema.id,
						properties: {
							reps: 8,
							weight: 60,
							setOrder: 0,
							setLot: "normal",
							exerciseOrder: 0,
							unitSystem: "metric",
						},
					},
				],
			}),
		);
		yield* waitForSessionEventCount(client, workoutId, 1);
		const pokemonSchema = requirePresent(
			(yield* listEntitySchemas(client, {
				slugs: ["pokemon"],
				pluginSlug: FIXTURE_CLIENT_PLUGIN_SLUG,
			}))[0],
			"Fixture Pokemon schema was not registered",
		);
		const pokemon = yield* createEntity(client, {
			name: "05 Composed Bulbasaur",
			entitySchemaSlug: pokemonSchema.id,
			properties: {
				height: 7,
				weight: 69,
				pokedexNumber: 1,
				images: [pokemonArtwork],
				types: ["Grass", "Poison"],
				abilities: ["Overgrow", "Chlorophyll"],
				sourceUrl: "https://example.invalid/pokemon/bulbasaur",
			},
		});
		const view = yield* createEntityBrowserSavedView(client, { name: "Mixed entity browser" }, [
			...fallbackEntities.map(({ id }) => id),
			showId,
			workoutId,
			pokemon.id,
		]);

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/v/${view.slug}`);

		const frames = page.locator("iframe");
		yield* frames.waitFor({ state: "visible" });
		expect(yield* frames.count).toBe(1);
		const iframe = Option.getOrThrow(yield* frames.first().elementHandle());
		const runtime = frames.first().contentFrame();
		yield* runtime.getByRole("heading", { level: 1, name: "Entity browser" }).waitFor({
			state: "visible",
		});
		yield* expectVisibleText(runtime.locator("body"), "01 Alpha fallback");
		yield* expectVisibleText(runtime.locator("body"), "02 Beta fallback");
		expect(yield* runtime.locator("article").count).toBe(2);
		yield* runtime.locator("body").evaluate((body) => body.setAttribute("data-e2e-page", "stable"));

		yield* runtime.getByRole("button", { name: "Count all" }).click();
		yield* expectVisibleText(runtime.locator("body"), "5 total");
		yield* runtime.getByRole("button", { name: "Load more" }).click();
		yield* runtime
			.getByRole("link", { name: "04 Composed Strength Workout", exact: true })
			.waitFor({ state: "visible" });
		expect(yield* runtime.locator("article").count).toBe(4);
		yield* runtime.getByRole("button", { name: "Load more" }).click();
		yield* runtime
			.getByRole("link", { name: "05 Composed Bulbasaur", exact: true })
			.waitFor({ state: "visible" });
		expect(yield* runtime.locator("article").count).toBe(5);
		const gridRows = yield* runtime.locator("article").allInnerTexts();
		expect(gridRows[0]).toContain("01 Alpha fallback");
		expect(gridRows[1]).toContain("02 Beta fallback");
		expect(gridRows[2]).toContain("03 Composed Tracer Show");
		expect(gridRows[3]).toContain("04 Composed Strength Workout");
		expect(gridRows[4]).toContain("05 Composed Bulbasaur");

		const expectRichEntities = (
			show: Playwright.Locator,
			workout: Playwright.Locator,
			pokemonItem: Playwright.Locator,
		) =>
			Effect.gen(function* () {
				yield* expectVisibleText(show, "03 Composed Tracer Show");
				yield* expectVisibleText(show, "2025");
				yield* expectVisibleText(show, "Returning Series");
				yield* expectVisibleText(
					show,
					"1 stored season · 1 stored episode · 1 episode in progress",
				);
				const showImage = show.locator("img");
				yield* showImage.waitFor({ state: "visible" });
				expect(
					yield* showImage.evaluate((image) =>
						image instanceof HTMLImageElement ? image.naturalWidth : -1,
					),
				).toBe(60);

				yield* expectVisibleText(workout, "04 Composed Strength Workout");
				yield* expectVisibleText(workout, "Sep 7, 2026");
				yield* expectVisibleText(workout, "1h 30m");
				expect(yield* workout.locator("img, [aria-hidden=true]").count).toBe(0);
				const workoutDetails = workout.locator("details");
				yield* expectVisibleText(workoutDetails, "1 exercise · 1 set");
				yield* workoutDetails.locator("summary").click();
				yield* expectVisibleText(workoutDetails, exercise.name);
				yield* expectVisibleText(workoutDetails, "8 reps · 60 kg");

				yield* expectVisibleText(pokemonItem, "05 Composed Bulbasaur");
				yield* expectVisibleText(pokemonItem, "Grass");
				yield* expectVisibleText(pokemonItem, "Poison");
				const pokemonImage = pokemonItem.locator("img");
				yield* pokemonImage.waitFor({ state: "visible" });
				expect(
					yield* pokemonImage.evaluate((image) =>
						image instanceof HTMLImageElement ? image.naturalWidth : -1,
					),
				).toBe(80);
				yield* pokemonItem.getByRole("button", { name: "Show details" }).click();
				yield* expectVisibleText(pokemonItem, "Overgrow, Chlorophyll");
				yield* expectVisibleText(pokemonItem, "7 dm");
				yield* expectVisibleText(pokemonItem, "69 hg");
			});

		const showGrid = runtime.locator(`[data-entity-id="${showId}"][data-layout="grid"]`);
		const workoutGrid = runtime.locator(`[data-entity-id="${workoutId}"][data-layout="grid"]`);
		const pokemonGrid = runtime.locator(`[data-entity-id="${pokemon.id}"][data-layout="card"]`);
		yield* expectRichEntities(showGrid, workoutGrid, pokemonGrid);
		expect(yield* pokemonGrid.getAttribute("data-view-context")).toBe(
			JSON.stringify({ savedViewId: view.id }),
		);

		yield* runtime.getByRole("radio", { name: "List view" }).click();
		const showList = runtime.locator(`[data-entity-id="${showId}"][data-layout="list"]`);
		const workoutList = runtime.locator(`[data-entity-id="${workoutId}"][data-layout="list"]`);
		const pokemonList = runtime.locator(`[data-entity-id="${pokemon.id}"][data-layout="row"]`);
		yield* pokemonList.waitFor({ state: "visible" });
		expect(yield* runtime.locator("article").count).toBe(5);
		yield* expectRichEntities(showList, workoutList, pokemonList);
		expect(yield* pokemonList.getAttribute("data-view-context")).toBe(
			JSON.stringify({ savedViewId: view.id }),
		);
		expect(yield* runtime.locator("body").getAttribute("data-e2e-page")).toBe("stable");
		expect(yield* frames.first().evaluate((current, initial) => current === initial, iframe)).toBe(
			true,
		);
		expect(yield* frames.count).toBe(1);
		expect(yield* runtime.locator("#app").count).toBe(1);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);
