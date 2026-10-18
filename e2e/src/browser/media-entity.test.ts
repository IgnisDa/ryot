import { savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import { mediaPlugin } from "@ryot-app/media-plugin";
import { Effect, Option } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	createAuthenticatedClient,
	createEntity,
	fakeProviderDetailsResult,
	fakeProviderTranslations,
	getEntity,
	markEntityPopulated,
	pollUntil,
	setUserLanguage,
	shippedPluginTestProviders,
} from "~/fixtures/kernel";
import {
	findMediaEntitySchema,
	insertLibraryMembership,
	seedGlobalShowEpisodeTree,
	seedMediaEntity,
} from "~/fixtures/plugins/media";
import { mediaPluginFrame } from "~/fixtures/plugins/media/frame";
import { seedGlobalMediaGenres } from "~/fixtures/plugins/media/genres";
import { signInThroughHostedOAuth } from "~/support/browser";
import { afterAll, beforeAll, expect, it, runPromise } from "~/support/effect-test";
import { startIsolatedHarness } from "~/support/isolated-harness";

const SHOW_NAME = "Media Entity Tracer Show";
const SHOW_COVER = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="90"><rect width="60" height="90" fill="#8b5cf6"/></svg>`;

let harness: undefined | Effect.Success<ReturnType<typeof startIsolatedHarness>>;
let target: Effect.Success<ReturnType<typeof startIsolatedHarness>>["target"];
let mediaProviders: Effect.Success<ReturnType<typeof shippedPluginTestProviders>>;

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			harness = yield* startIsolatedHarness("Browser Media Entity");
			target = harness.target;
			mediaProviders = yield* shippedPluginTestProviders(mediaPlugin.metadata.packageId, target);
		}),
	),
);

afterAll(() => runPromise(harness?.stop ?? Effect.void));

const expectVisibleText = (locator: Playwright.Locator, text: string) =>
	Effect.gen(function* () {
		const match = locator.getByText(text, { exact: true }).filter({ visible: true });
		yield* match.waitFor({ state: "visible" });
		expect(yield* match.isVisible()).toBe(true);
	});

it.live("automatically populates and translates a partial Show in the compiled Media detail", () =>
	Effect.gen(function* () {
		const id = crypto.randomUUID();
		const translatedName = `Serie traducida ${id}`;
		const translatedDescription = `Resumen de la serie ${id}.`;
		const { email, client, password } = yield* createAuthenticatedClient(target);
		yield* setUserLanguage(client, "es");
		const { schema } = yield* findMediaEntitySchema(client, "show");
		const provider = yield* mediaProviders.attachProvider({
			rootEntitySchemaSlug: schema.id,
			information: { source: "e2e", canonicalLanguage: "en" },
			translations: fakeProviderTranslations({
				es: { name: translatedName, properties: { description: translatedDescription } },
			}),
			details: fakeProviderDetailsResult({
				name: `Populated Show ${id}`,
				properties: {
					totalSeasons: 3,
					totalEpisodes: 24,
					description: "Canonical offline show overview.",
				},
			}),
		});
		const show = yield* seedMediaEntity({
			target,
			userId: null,
			properties: {},
			externalId: id,
			name: `Partial Show ${id}`,
			entitySchemaSlug: schema.id,
			providerId: provider.providerId,
		});
		expect((yield* getEntity(client, show.id)).populatedAt).toBeNull();
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password, { frontendUrl: target.frontendUrl });
		yield* page.goto(`${target.frontendUrl}/e/${show.id}`);
		const frame = mediaPluginFrame(page);
		yield* frame.waitFor({ state: "visible" });
		const media = frame.contentFrame();
		yield* media
			.getByRole("heading", { level: 1, exact: true, name: translatedName })
			.waitFor({ state: "visible", timeout: 150_000 });
		yield* expectVisibleText(media.locator("body"), translatedDescription);
		yield* expectVisibleText(media.locator("body"), "3 seasons");
		yield* expectVisibleText(media.locator("body"), "24 episodes");
		expect((yield* getEntity(client, show.id)).populatedAt).not.toBeNull();
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("shows a failed Media population and repopulates it after Try again", () =>
	Effect.gen(function* () {
		const id = crypto.randomUUID();
		const providerName = `Failing Provider ${id}`;
		const populatedName = `Recovered Show ${id}`;
		const { email, client, password } = yield* createAuthenticatedClient(target);
		const { schema } = yield* findMediaEntitySchema(client, "show");
		const provider = yield* mediaProviders.attachProvider({
			name: providerName,
			rootEntitySchemaSlug: schema.id,
			detailsFailure: "E2E media details failure",
			details: fakeProviderDetailsResult({ name: populatedName }),
		});
		const show = yield* seedMediaEntity({
			target,
			userId: null,
			properties: {},
			externalId: id,
			name: `Failing Show ${id}`,
			entitySchemaSlug: schema.id,
			providerId: provider.providerId,
		});
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password, { frontendUrl: target.frontendUrl });
		yield* page.goto(`${target.frontendUrl}/e/${show.id}`);
		const frame = mediaPluginFrame(page);
		yield* frame.waitFor({ state: "visible" });
		const media = frame.contentFrame();
		const failure = media
			.getByRole("alert")
			.filter({ hasText: `Couldn't load details from ${providerName}.` });
		yield* failure.waitFor({ state: "visible", timeout: 150_000 });
		expect((yield* getEntity(client, show.id)).populationStatus).toEqual({
			state: "failed",
			availability: "missing",
		});

		yield* mediaProviders.update(provider.providerSlug, { detailsFailure: undefined });
		yield* page.getByRole("button", { name: "Reload updated page" }).click();
		yield* failure.waitFor({ state: "visible" });
		yield* failure.locator("xpath=..").getByRole("button", { name: "Try again" }).click();
		yield* media
			.getByRole("heading", { level: 1, exact: true, name: populatedName })
			.waitFor({ state: "visible", timeout: 150_000 });
		expect(yield* media.getByRole("alert").count).toBe(0);
		const populated = yield* pollUntil(
			`show '${show.id}' population settled`,
			getEntity(client, show.id).pipe(
				Effect.map((entity) => (entity.populationStatus.state === "running" ? null : entity)),
			),
		);
		expect(populated.populationStatus).toEqual({ state: "succeeded", availability: "complete" });
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("opens a base-populated Media Movie and shows its credits once they arrive", () =>
	Effect.gen(function* () {
		const id = crypto.randomUUID();
		const personName = `Credited Person ${id}`;
		const { email, client, password } = yield* createAuthenticatedClient(target);
		const { schema: movieSchema } = yield* findMediaEntitySchema(client, "movie");
		const { schema: personSchema } = yield* findMediaEntitySchema(client, "person");
		const personProvider = yield* mediaProviders.attachProvider({
			rootEntitySchemaSlug: personSchema.id,
			details: fakeProviderDetailsResult({ name: personName }),
		});
		const movieProvider = yield* mediaProviders.attachProvider({
			rootEntitySchemaSlug: movieSchema.id,
			details: fakeProviderDetailsResult({
				name: `Base Movie ${id}`,
				relatedEntityGroups: [
					{
						direction: "incoming",
						synchronization: "additive",
						relationshipSchemaSlug: "person-to-movie",
						entities: [
							{
								name: personName,
								externalId: `person-${id}`,
								providerSlug: personProvider.providerSlug,
								relationshipProperties: { roles: ["Actor"] },
							},
						],
					},
				],
			}),
		});
		const movie = yield* seedMediaEntity({
			target,
			userId: null,
			externalId: id,
			properties: {},
			name: `Base Movie ${id}`,
			entitySchemaSlug: movieSchema.id,
			providerId: movieProvider.providerId,
		});
		yield* markEntityPopulated(movie.id, "base", target);
		expect((yield* getEntity(client, movie.id)).relatedPopulationStatus).toEqual({
			state: "idle",
			availability: "missing",
		});

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password, { frontendUrl: target.frontendUrl });
		yield* page.goto(`${target.frontendUrl}/e/${movie.id}`);
		const frame = mediaPluginFrame(page);
		yield* frame.waitFor({ state: "visible" });
		const media = frame.contentFrame();
		yield* media
			.getByRole("link", { name: `Open ${personName}` })
			.waitFor({ state: "visible", timeout: 150_000 });
		expect((yield* getEntity(client, movie.id)).relatedPopulationStatus).toEqual({
			state: "succeeded",
			availability: "complete",
		});
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("opens a Media Show entity from the canonical saved-view route", () =>
	Effect.gen(function* () {
		const frontendUrl = target.frontendUrl;
		const { email, client, password } = yield* createAuthenticatedClient(target);
		const coverUrl = "https://images.test/show-cover.svg";
		const { showId } = yield* seedGlobalShowEpisodeTree(client, {
			showName: SHOW_NAME,
			showProperties: {
				totalSeasons: 2,
				totalEpisodes: 12,
				publishYear: 2025,
				productionStatus: "Returning Series",
				description: "A deterministic browser tracer show.",
				images: [{ url: coverUrl, type: "remote", purpose: "cover" }],
			},
		});
		yield* seedGlobalMediaGenres({
			target,
			entityId: showId,
			entitySchemaSlug: "show",
			names: ["Drama", "Mystery"],
		});
		yield* insertLibraryMembership(client, { mediaEntityId: showId });
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		yield* page.use((native) =>
			native
				.context()
				.route(coverUrl, (route) =>
					route.fulfill({ body: SHOW_COVER, contentType: "image/svg+xml" }),
				),
		);
		yield* signInThroughHostedOAuth(page, email, password, { frontendUrl: target.frontendUrl });
		yield* page.goto(
			`${frontendUrl}${savedViewPath({ kind: "plugin", slug: "all-shows", packageId: mediaPlugin.metadata.packageId })}`,
		);
		yield* page
			.locator("iframe")
			.contentFrame()
			.getByRole("link", { exact: true, name: SHOW_NAME })
			.click();
		yield* page.waitForURL(`${frontendUrl}/e/${showId}`);
		expect(new URL(page.url()).pathname).toBe(`/e/${showId}`);
		expect(page.url()).not.toContain("/media");

		const frame = mediaPluginFrame(page);
		yield* frame.waitFor({ state: "visible" });
		const media = frame.contentFrame();
		yield* media.getByRole("heading", { level: 1, name: SHOW_NAME }).waitFor({ state: "visible" });
		yield* expectVisibleText(media.locator("body"), "2 seasons");
		yield* expectVisibleText(media.locator("body"), "12 episodes");
		yield* expectVisibleText(media.locator("body"), "Returning Series");
		yield* expectVisibleText(media.locator("body"), "A deterministic browser tracer show.");
		const coverImage = media.locator('img[alt=""]').first();
		yield* coverImage.waitFor({ state: "visible" });
		expect(yield* coverImage.getAttribute("alt")).toBe("");
		expect(yield* coverImage.getAttribute("src")).toBe(coverUrl);
		expect(
			yield* coverImage.evaluate((image) =>
				image instanceof HTMLImageElement ? image.naturalWidth : -1,
			),
		).toBe(60);
		yield* page
			.locator("html")
			.waitForFunction((_html, title: string) => document.title === title, `${SHOW_NAME} — Ryot`);
		expect(yield* page.title).toBe(`${SHOW_NAME} — Ryot`);
		const iframe = Option.getOrThrow(yield* frame.elementHandle());
		const body = media.locator("body");
		yield* body.click();
		expect(yield* body.evaluate(() => document.hasFocus())).toBe(true);

		const primaryModifier = yield* page.evaluate(() =>
			/Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control",
		);
		const commandCenter = page.getByRole("dialog", { name: "Command center" });
		yield* page.keyboard.press(`${primaryModifier}+K`);
		yield* commandCenter.waitFor({ state: "visible" });
		expect(yield* commandCenter.isVisible()).toBe(true);
		yield* commandCenter.waitForFunction((dialog) => dialog.contains(document.activeElement));
		yield* page.keyboard.press("Escape");
		yield* commandCenter.waitFor({ state: "hidden" });

		yield* body.click();
		yield* page.keyboard.press(`${primaryModifier}+Shift+Space`);
		const sidebar = page.getByTestId("desktop-sidebar");
		const workspaces = sidebar.getByRole("menu", { name: "Workspaces" });
		yield* workspaces.waitFor({ state: "visible" });
		const currentWorkspace = workspaces.getByRole("menuitemradio", { checked: true });
		expect(yield* currentWorkspace.evaluate((element) => document.activeElement === element)).toBe(
			true,
		);
		yield* page.keyboard.press("Escape");
		yield* workspaces.waitFor({ state: "hidden" });
		expect(yield* frame.evaluate((element, initial) => element === initial, iframe)).toBe(true);

		yield* page.goBack();
		yield* page.waitForURL(
			`${frontendUrl}${savedViewPath({ kind: "plugin", slug: "all-shows", packageId: mediaPlugin.metadata.packageId })}`,
		);
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("shows a kernel notice for a Media schema with no detail renderer", () =>
	Effect.gen(function* () {
		const frontendUrl = target.frontendUrl;
		const { email, client, password } = yield* createAuthenticatedClient(target);
		const { schema } = yield* findMediaEntitySchema(client, "media-library");
		const library = yield* createEntity(client, {
			properties: {},
			entitySchema: schema.reference,
			name: "Unsupported Media Library",
		});
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password, { frontendUrl: target.frontendUrl });
		yield* page.goto(`${frontendUrl}/e/${library.id}`);
		yield* page.waitForURL(`${frontendUrl}/e/${library.id}`);

		yield* page
			.getByRole("heading", { level: 1, exact: true, name: "Entity page not registered" })
			.waitFor({ state: "visible" });
		expect(yield* mediaPluginFrame(page).count).toBe(0);
	}).pipe(PlaywrightSpawner.withBrowser),
);
