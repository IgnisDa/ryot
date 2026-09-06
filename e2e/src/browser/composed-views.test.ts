import { Effect, Option } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	buildEntityBrowserSavedViewPayload,
	createAuthenticatedClient,
	createEntity,
	createEntityBrowserSavedView,
	createEntitySchema,
	createEventFixture,
	createEventSchema,
	createPluginSavedView,
	createResultsTableSavedView,
	findPluginIdBySlug,
	getBuiltinEntitySchemaSlug,
	findSavedViewById,
	installFixtureClientPlugin,
	listEntitySchemas,
	listEventSchemas,
	FIXTURE_CLIENT_PLUGIN_SLUG,
	prepareClientPage,
	requireEventSchemaBySlug,
} from "~/fixtures/kernel";
import {
	createWorkoutEntityFixture,
	createExerciseEntityFixture,
	findWorkoutSetEventSchema,
	waitForSessionEventCount,
} from "~/fixtures/plugins/fitness";
import { seedGlobalShowEpisodeTree } from "~/fixtures/plugins/media";
import { requirePresent } from "~/support/assertions";
import { browserLayer, signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getApiUrl, getFrontendUrl } from "~/support/harness-target";

const expectVisibleText = (locator: Playwright.Locator, text: string) =>
	Effect.gen(function* () {
		const match = locator.getByText(text, { exact: true }).filter({ visible: true });
		yield* match.waitFor({ state: "visible" });
		expect(yield* match.isVisible()).toBe(true);
	});

const activeClientFrame = (page: Playwright.Page) =>
	page.locator('main > div:not([aria-hidden="true"]) iframe');

const clientImportUrl = (frame: Playwright.Locator, specifier: string) =>
	Effect.gen(function* () {
		const text = yield* frame.contentFrame().locator("#ryot-client-importmap").textContent();
		const map: unknown = JSON.parse(requirePresent(text, "Client import map is missing"));
		if (typeof map !== "object" || map === null || !("imports" in map)) {
			throw new Error("Client import map has no imports");
		}
		const imports = map.imports;
		if (typeof imports !== "object" || imports === null || !(specifier in imports)) {
			throw new Error(`Client import map has no ${specifier} entry`);
		}
		const url: unknown = Object.entries(imports).find(([name]) => name === specifier)?.[1];
		if (typeof url !== "string") {
			throw new Error(`Client import URL for ${specifier} is invalid`);
		}
		return url;
	});

it.live("retains the document and bridge across same-composition saved views", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient(getApiUrl());
		const first = yield* createEntityBrowserSavedView(client, { name: "Composition first view" });
		const second = yield* createEntityBrowserSavedView(client, { name: "Composition second view" });
		const firstPage = yield* prepareClientPage(client, first.slug);
		const secondPage = yield* prepareClientPage(client, second.slug);
		expect(firstPage.composition.hash).toBe(secondPage.composition.hash);

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		const requests: string[] = [];
		yield* page.use((nativePage) => {
			nativePage.on("request", (request) => requests.push(new URL(request.url()).pathname));
			return Promise.resolve();
		});
		yield* page.goto(`${getFrontendUrl()}/v/${first.slug}`);
		const frame = activeClientFrame(page);
		yield* frame
			.contentFrame()
			.getByRole("heading", { level: 1, name: "Composition first view" })
			.waitFor();
		const iframe = Option.getOrThrow(yield* frame.elementHandle());
		const src = yield* frame.getAttribute("src");
		const runtimeUrl = yield* clientImportUrl(frame, "@ryot-app/client-sdk/plugin");
		expect(runtimeUrl).toMatch(/^\/api\/client-assets\/[a-f0-9]{64}\/public\//);
		yield* frame
			.contentFrame()
			.locator("body")
			.evaluate((body) => body.setAttribute("data-e2e-runtime", "retained"));
		const before = requests.length;
		// The second saved view is a router navigation, not a full top-level page load.
		yield* page
			.getByTestId("desktop-sidebar")
			.getByRole("link", { exact: true, name: "Composition second view" })
			.click();
		yield* page.waitForURL(`${getFrontendUrl()}/v/${second.slug}`);
		yield* frame
			.contentFrame()
			.getByRole("heading", { level: 1, name: "Composition second view" })
			.waitFor();
		expect(yield* frame.evaluate((current, original) => current === original, iframe)).toBe(true);
		expect(yield* frame.getAttribute("src")).toBe(src);
		expect(yield* frame.contentFrame().locator("body").getAttribute("data-e2e-runtime")).toBe(
			"retained",
		);
		expect(yield* clientImportUrl(frame, "@ryot-app/client-sdk/plugin")).toBe(runtimeUrl);
		expect(
			requests.slice(before).filter((path) => path.startsWith("/api/client-pages/documents/")),
		).toEqual([]);
		expect(requests.slice(before).filter((path) => path.startsWith("/api/client-assets/"))).toEqual(
			[],
		);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("renders a saved view from an installed client plugin page", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const { email, client, password } = yield* createAuthenticatedClient(apiUrl);
		yield* installFixtureClientPlugin(client, "A", "", apiUrl);
		const pluginId = requirePresent(
			yield* findPluginIdBySlug(client, FIXTURE_CLIENT_PLUGIN_SLUG),
			"Installed fixture plugin was not found",
		);
		const view = yield* createPluginSavedView(
			client,
			{ pluginId, kind: "plugin", exportName: "fixture-home" },
			{},
			{ name: "Fixture plugin saved view", workspacePluginSlug: FIXTURE_CLIENT_PLUGIN_SLUG },
		);
		const viewRecord = yield* findSavedViewById(client, view.id);

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/v/${viewRecord.slug}`);

		const frame = activeClientFrame(page);
		yield* frame.waitFor({ state: "visible" });
		expect(yield* page.locator("iframe").count).toBe(1);
		yield* frame
			.contentFrame()
			.getByRole("heading", { level: 1, exact: true, name: "Fixture plugin revision A" })
			.waitFor({ state: "visible" });
		const privateModule = yield* clientImportUrl(frame, "@ryot-app/plugins/fixture/fixture-home");
		expect(privateModule).toMatch(
			/^\/api\/client-assets\/[a-f0-9]{64}\/[A-Za-z0-9_-]{43}\/module\.js$/,
		);
		const runtimeUrl = yield* clientImportUrl(frame, "@ryot-app/client-sdk/plugin");
		expect(runtimeUrl).toMatch(/^\/api\/client-assets\/[a-f0-9]{64}\/public\//);
		const runtimeCache = yield* page.use(async (nativePage) => {
			const response = await nativePage.context().request.get(new URL(runtimeUrl, apiUrl).href);
			const cache = response.headers()["cache-control"];
			const status = response.status();
			await response.dispose();
			return { cache, status };
		});
		expect(runtimeCache.status).toBe(200);
		expect(runtimeCache.cache).toBe("public, max-age=31536000, immutable");

		yield* page
			.getByTestId("desktop-sidebar")
			.getByRole("button", { name: /workspace/ })
			.click();
		yield* page.getByRole("menuitemradio", { name: "Switch to Media workspace" }).click();
		yield* page
			.getByTestId("desktop-sidebar")
			.getByRole("link", { exact: true, name: "All Music" })
			.click();
		yield* page.waitForURL(`${getFrontendUrl()}/v/all-music`);
		const mediaFrame = activeClientFrame(page);
		yield* mediaFrame
			.contentFrame()
			.getByRole("heading", { level: 1, name: "All Music" })
			.waitFor();
		expect(yield* clientImportUrl(mediaFrame, "@ryot-app/client-sdk/plugin")).toBe(runtimeUrl);
		const shippedModule = yield* clientImportUrl(mediaFrame, "@ryot-app/plugins/media/media-card");
		expect(shippedModule).toMatch(/^\/api\/client-assets\/[a-f0-9]{64}\/public\/module\.js$/);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("keeps configured entity-browser controls within their declared source", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const { email, client, password } = yield* createAuthenticatedClient(apiUrl);
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
				sortChoices: [
					{
						name: "name-desc",
						label: "Name descending",
						orderBy: [{ field: "name", direction: "desc" }],
					},
				],
				tableColumns: [
					{ label: "Schema", displayKind: "text", field: "entitySchemaSlug" },
					{ field: "name", label: "Name", displayKind: "text" },
				],
			},
		});
		const viewRecord = yield* findSavedViewById(client, view.id);

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/v/${viewRecord.slug}?keep=1&layout=table`);
		const runtime = activeClientFrame(page).contentFrame();
		yield* runtime.getByRole("heading", { level: 1, name: "Configured entity browser" }).waitFor();
		yield* runtime.getByText(alpha.name, { exact: true }).waitFor({ state: "visible" });
		expect(yield* runtime.getByRole("button", { name: "Add", exact: true }).count).toBe(0);
		expect(yield* runtime.getByRole("columnheader").allInnerTexts()).toEqual(["Schema", "Name"]);
		expect(yield* runtime.locator("tbody tr").allInnerTexts()).toEqual([
			expect.stringContaining("01 Alpha member"),
			expect.stringContaining("02 Zulu member"),
		]);
		expect(yield* runtime.getByText(excluded.name, { exact: true }).count).toBe(0);

		yield* runtime
			.getByRole("searchbox", { name: "Search Configured entity browser" })
			.fill("Alpha");
		yield* page.waitForURL((url) => url.searchParams.get("search") === "Alpha");
		expect(new URL(page.url()).searchParams.get("keep")).toBe("1");
		yield* runtime.getByText("02 Zulu member", { exact: true }).waitFor({ state: "hidden" });
		yield* runtime.getByRole("searchbox", { name: "Search Configured entity browser" }).fill("");
		yield* page.waitForURL((url) => url.searchParams.get("search") === null);

		yield* runtime.getByRole("button", { name: /Filters/ }).click();
		yield* runtime.getByRole("button", { name: "Sort results: Default order" }).click();
		yield* runtime.getByRole("radio", { name: "Name descending" }).click();
		yield* page.waitForURL((url) => url.searchParams.get("sort") === "name-desc");
		yield* page.keyboard.press("Escape");
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

it.live("warms private Pokemon presentation files without evaluating them until pagination", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const { email, client, password } = yield* createAuthenticatedClient(apiUrl);
		yield* installFixtureClientPlugin(client, "A", "", apiUrl, true);
		const fallbackSchema = yield* createEntitySchema(client, {
			name: "Lazy presentation fallback",
			pluginSlug: `lazy-fallback-${crypto.randomUUID()}`,
		});
		const fallback = yield* Effect.forEach(["01 Fallback", "02 Fallback"], (name) =>
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
			name: "03 Lazy Bulbasaur",
			entitySchemaSlug: pokemonSchema.id,
			properties: {
				height: 7,
				weight: 69,
				pokedexNumber: 1,
				abilities: ["Overgrow"],
				types: ["Grass", "Poison"],
			},
		});
		const view = yield* createEntityBrowserSavedView(
			client,
			{ name: "Private lazy presentation" },
			[...fallback.map(({ id }) => id), pokemon.id],
		);
		const viewRecord = yield* findSavedViewById(client, view.id);

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		const requested: string[] = [];
		const finished: string[] = [];
		const responseStatuses = new Map<string, number>();
		yield* page.use((nativePage) => {
			nativePage.on("request", (request) => requested.push(new URL(request.url()).pathname));
			nativePage.on("response", (response) =>
				responseStatuses.set(new URL(response.url()).pathname, response.status()),
			);
			nativePage.on("requestfinished", (request) => finished.push(new URL(request.url()).pathname));
			return Promise.resolve();
		});
		yield* page.goto(`${getFrontendUrl()}/v/${viewRecord.slug}`);
		const frame = activeClientFrame(page);
		const runtime = frame.contentFrame();
		yield* runtime.getByRole("heading", { level: 1, name: viewRecord.name }).waitFor();
		yield* expectVisibleText(runtime.locator("body"), "01 Fallback");
		yield* expectVisibleText(runtime.locator("body"), "02 Fallback");
		expect(yield* runtime.locator("article").count).toBe(2);
		const privateModule = yield* clientImportUrl(frame, "@ryot-app/plugins/fixture/pokemon-card");
		expect(privateModule).toMatch(
			/^\/api\/client-assets\/[a-f0-9]{64}\/[A-Za-z0-9_-]{43}\/module\.js$/,
		);
		const privateBase = privateModule.slice(0, privateModule.lastIndexOf("/") + 1);
		const warmedFiles = yield* runtime.locator("link").evaluateAll(
			(links, base) =>
				links.flatMap((link) => {
					const href = link.getAttribute("href");
					return href?.startsWith(base) ? [href] : [];
				}),
			privateBase,
		);
		expect(warmedFiles).toContain(privateModule);
		expect(warmedFiles).toContain(`${privateBase}module.css`);
		expect(
			warmedFiles.some((path) => path.startsWith(`${privateBase}asset-`) && path.endsWith(".png")),
		).toBe(true);
		yield* page.use(async (nativePage) => {
			await Promise.all(
				warmedFiles.map((path) =>
					finished.includes(path)
						? Promise.resolve()
						: nativePage.waitForEvent("requestfinished", {
								predicate: (request) => new URL(request.url()).pathname === path,
							}),
				),
			);
		});
		expect(warmedFiles.every((path) => requested.includes(path))).toBe(true);
		for (const path of warmedFiles) {
			expect(responseStatuses.get(path)).toBe(200);
		}
		expect(
			yield* runtime.locator("html").getAttribute("data-e2e-pokemon-presentation-evaluated"),
		).toBeNull();

		const blocked: string[] = [];
		yield* page.use((nativePage) =>
			nativePage.route(`**${privateBase}*`, async (route) => {
				blocked.push(new URL(route.request().url()).pathname);
				await route.abort();
			}),
		);
		yield* runtime.getByRole("button", { name: "Load more" }).click();
		const pokemonCard = runtime.locator(`[data-entity-id="${pokemon.id}"][data-layout="card"]`);
		yield* expectVisibleText(pokemonCard, pokemon.name);
		yield* expectVisibleText(pokemonCard, "Grass");
		expect(
			yield* runtime.locator("html").getAttribute("data-e2e-pokemon-presentation-evaluated"),
		).toBe("true");
		expect(blocked).toEqual([]);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live(
	"renders composite-key results-table rows with ordered nullable cells and entity links",
	() =>
		Effect.gen(function* () {
			const apiUrl = getApiUrl();
			const { email, client, password } = yield* createAuthenticatedClient(apiUrl);
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
			const viewRecord = yield* findSavedViewById(client, view.id);

			const browser = yield* Playwright.Browser;
			const page = yield* browser.newPage();
			yield* signInThroughHostedOAuth(page, email, password);
			yield* page.goto(`${getFrontendUrl()}/v/${viewRecord.slug}`);
			const runtime = activeClientFrame(page).contentFrame();
			yield* runtime.getByRole("heading", { level: 1, name: viewRecord.name }).waitFor();
			const rows = runtime.locator("tbody tr");
			yield* rows.nth(1).waitFor();
			expect(yield* runtime.getByRole("columnheader").allInnerTexts()).toEqual([
				"Note",
				"Occurred",
				"Missing",
			]);
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
			yield* page.reload;
			yield* runtime.getByRole("heading", { level: 1, name: viewRecord.name }).waitFor();
			yield* rows.getByText("Third row", { exact: true }).waitFor({ state: "visible" });
			expect(yield* rows.count).toBe(3);
		}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("keeps one rich mixed entity browser runtime across pagination and layouts", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const { email, client, password } = yield* createAuthenticatedClient(apiUrl);
		yield* installFixtureClientPlugin(client, "A", "", apiUrl);
		const uploadArtwork = (fileName: string, source: string) =>
			Effect.gen(function* () {
				const intent = yield* client.call((c) =>
					c.uploads.createIntent({
						payload: { fileName, kind: "permanent", contentType: "image/svg+xml" },
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
		const episodeSchemaSlug = yield* getBuiltinEntitySchemaSlug(client, "show-episode");
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
		const { exercise, exerciseId } = yield* createExerciseEntityFixture(client, {
			kind: "reps_and_weight",
			name: "Composed Strength Exercise",
		});
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
		const viewRecord = yield* findSavedViewById(client, view.id);

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		const assetRequests: string[] = [];
		yield* page.use((nativePage) => {
			nativePage.on("request", (request) => {
				const path = new URL(request.url()).pathname;
				if (path.startsWith("/api/client-assets/")) {
					assetRequests.push(path);
				}
			});
			return Promise.resolve();
		});
		yield* page.goto(`${getFrontendUrl()}/v/${viewRecord.slug}`);

		const frame = activeClientFrame(page);
		yield* frame.waitFor({ state: "visible" });
		const iframe = Option.getOrThrow(yield* frame.elementHandle());
		const runtime = frame.contentFrame();
		yield* runtime
			.getByRole("heading", { level: 1, name: "Mixed entity browser" })
			.waitFor({ state: "visible" });
		const fitnessModule = yield* clientImportUrl(frame, "@ryot-app/plugins/fitness/workout-card");
		expect(fitnessModule).toMatch(/^\/api\/client-assets\/[a-f0-9]{64}\/public\/module\.js$/);
		const fitnessCss = fitnessModule.replace(/module\.js$/, "module.css");
		yield* expectVisibleText(runtime.locator("body"), "01 Alpha fallback");
		yield* expectVisibleText(runtime.locator("body"), "02 Beta fallback");
		expect(yield* runtime.locator("article").count).toBe(2);
		expect(assetRequests).not.toContain(fitnessModule);
		expect(assetRequests).not.toContain(fitnessCss);
		yield* runtime.locator("body").evaluate((body) => body.setAttribute("data-e2e-page", "stable"));

		yield* runtime.getByRole("button", { name: "Count all" }).click();
		yield* expectVisibleText(runtime.locator("body"), "2 of 5 results");
		yield* runtime.getByRole("button", { name: "Load more" }).click();
		yield* runtime
			.getByRole("link", { exact: true, name: "04 Composed Strength Workout" })
			.waitFor({ state: "visible" });
		expect(assetRequests).toContain(fitnessModule);
		expect(assetRequests).toContain(fitnessCss);
		yield* runtime.locator("article").nth(3).waitFor({ state: "visible" });
		expect(yield* runtime.locator("article").count).toBe(4);
		yield* runtime.getByRole("button", { name: "Load more" }).click();
		yield* runtime
			.getByRole("link", { exact: true, name: "05 Composed Bulbasaur" })
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
				yield* expectVisibleText(show, "1 stored season · 1 aired episode · 1 episode in progress");
				const showImage = show.locator("img");
				yield* showImage.waitFor({ state: "visible" });
				yield* showImage.waitForFunction(
					(image) => image instanceof HTMLImageElement && image.naturalWidth === 60,
				);
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
				yield* pokemonImage.waitForFunction(
					(image) => image instanceof HTMLImageElement && image.naturalWidth === 80,
				);
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
			JSON.stringify({ savedViewId: viewRecord.slug }),
		);

		yield* runtime.getByRole("radio", { name: "List view" }).click();
		const showList = runtime.locator(`[data-entity-id="${showId}"][data-layout="list"]`);
		const workoutList = runtime.locator(`[data-entity-id="${workoutId}"][data-layout="list"]`);
		const pokemonList = runtime.locator(`[data-entity-id="${pokemon.id}"][data-layout="row"]`);
		yield* pokemonList.waitFor({ state: "visible" });
		yield* expectRichEntities(showList, workoutList, pokemonList);
		expect(yield* runtime.locator("article").count).toBe(5);
		expect(yield* pokemonList.getAttribute("data-view-context")).toBe(
			JSON.stringify({ savedViewId: viewRecord.slug }),
		);
		expect(yield* runtime.locator("body").getAttribute("data-e2e-page")).toBe("stable");
		expect(yield* frame.evaluate((current, initial) => current === initial, iframe)).toBe(true);
		expect(yield* frame.count).toBe(1);
		expect(yield* runtime.locator("#app").count).toBe(1);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);
