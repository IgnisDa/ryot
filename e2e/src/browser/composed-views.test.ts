import { Effect, Option } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	buildComposedClientRendererDefinition,
	createEntity,
	createEntityBrowserSavedView,
	createEntitySchema,
	createClientRenderer,
	createRendererSavedView,
	createTestUser,
	installFixtureClientPlugin,
	listEntitySchemas,
	FIXTURE_CLIENT_PLUGIN_SLUG,
	makeSession,
	publishClientRenderer,
} from "~/fixtures/kernel";
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

it.live("keeps one mixed entity browser runtime while a later Pokemon page loads", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const { token, email, password } = yield* createTestUser(apiUrl);
		const client = makeSession(apiUrl, { Authorization: `Bearer ${token}` });
		yield* installFixtureClientPlugin(client, "A", "", apiUrl);
		const fallbackSchema = yield* createEntitySchema(client, {
			pluginSlug: `mixed-fallback-${crypto.randomUUID()}`,
			name: "Mixed fallback",
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
		const pokemonSchema = requirePresent(
			(yield* listEntitySchemas(client, {
				slugs: ["pokemon"],
				pluginSlug: FIXTURE_CLIENT_PLUGIN_SLUG,
			}))[0],
			"Fixture Pokemon schema was not registered",
		);
		const pokemon = yield* createEntity(client, {
			name: "03 Fixture Bulbasaur",
			entitySchemaSlug: pokemonSchema.id,
			properties: { types: ["grass", "poison"] },
		});
		const view = yield* createEntityBrowserSavedView(client, { name: "Mixed entity browser" }, [
			...fallbackEntities.map(({ id }) => id),
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
		yield* expectVisibleText(runtime.locator("body"), "3 total");
		yield* runtime.getByRole("button", { name: "Load more" }).click();
		yield* runtime
			.getByRole("link", { name: "03 Fixture Bulbasaur", exact: true })
			.waitFor({ state: "visible" });
		expect(yield* runtime.locator("article").count).toBe(3);
		const gridRows = yield* runtime.locator("article").allInnerTexts();
		expect(gridRows[0]).toContain("01 Alpha fallback");
		expect(gridRows[1]).toContain("02 Beta fallback");
		expect(gridRows[2]).toContain("03 Fixture Bulbasaur");
		expect(
			yield* runtime.locator(`[data-entity-id="${pokemon.id}"][data-layout="grid"]`).count,
		).toBe(1);
		expect(
			yield* runtime
				.locator(`[data-entity-id="${pokemon.id}"][data-layout="grid"]`)
				.getAttribute("data-view-context"),
		).toBe(JSON.stringify({ savedViewId: view.id }));

		yield* runtime.getByRole("radio", { name: "List view" }).click();
		yield* runtime.locator(`[data-entity-id="${pokemon.id}"][data-layout="list"]`).waitFor({
			state: "visible",
		});
		expect(yield* runtime.locator("article").count).toBe(3);
		expect(yield* runtime.locator("body").getAttribute("data-e2e-page")).toBe("stable");
		expect(yield* frames.first().evaluate((current, initial) => current === initial, iframe)).toBe(
			true,
		);
		expect(yield* frames.count).toBe(1);
		expect(yield* runtime.locator("#app").count).toBe(1);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);
