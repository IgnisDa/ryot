import { Effect, Option } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	createEntity,
	createTestUser,
	fakeProviderDetailsResult,
	fakeProviderTranslations,
	findBuiltinSchemaBySlug,
	getEntity,
	installTestProvider,
	makeSession,
	setUserLanguage,
	uninstallTestProvider,
} from "~/fixtures/kernel";
import {
	insertLibraryMembership,
	seedGlobalShowEpisodeTree,
	seedMediaEntity,
} from "~/fixtures/plugins/media";
import { getApiUrl } from "~/support/api";
import { requirePresent } from "~/support/assertions";
import { browserLayer, signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/frontend";

const SHOW_NAME = "Media Entity Tracer Show";
const SHOW_COVER = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="90"><rect width="60" height="90" fill="#8b5cf6"/></svg>`;

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
		const { token, email, password } = yield* createTestUser();
		const client = makeSession(getApiUrl(), { Authorization: `Bearer ${token}` });
		yield* setUserLanguage(client, "es");
		const { schema } = yield* findBuiltinSchemaBySlug(client, "show");
		const provider = yield* installTestProvider({
			client,
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
		yield* Effect.addFinalizer(() => uninstallTestProvider(provider));
		const show = yield* createEntity(client, {
			properties: {},
			externalId: id,
			name: `Partial Show ${id}`,
			entitySchemaSlug: schema.id,
			providerId: provider.providerId,
		});
		expect((yield* getEntity(client, show.id)).populatedAt).toBeNull();
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/e/${show.id}`);
		const frame = page.locator('iframe[title="media plugin"]');
		yield* frame.waitFor({ state: "visible" });
		const media = frame.contentFrame();
		yield* media.getByRole("heading", { level: 1, name: translatedName, exact: true }).waitFor({
			state: "visible",
			timeout: 150_000,
		});
		yield* expectVisibleText(media.locator("body"), translatedDescription);
		yield* expectVisibleText(
			media
				.locator("p")
				.filter({ hasText: /^Seasons$/ })
				.locator(".."),
			"3",
		);
		yield* expectVisibleText(
			media
				.locator("p")
				.filter({ hasText: /^Episodes$/ })
				.locator(".."),
			"24",
		);
		expect((yield* getEntity(client, show.id)).populatedAt).not.toBeNull();
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("opens a Media Show entity from the canonical saved-view route", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const frontendUrl = getFrontendUrl();
		const { token, email, password } = yield* createTestUser(apiUrl);
		const client = makeSession(apiUrl, { Authorization: `Bearer ${token}` });
		const intent = yield* client.call((c) =>
			c.uploads.createIntent({
				payload: { kind: "permanent", fileName: "show-cover.svg", contentType: "image/svg+xml" },
			}),
		);
		const upload = yield* Effect.promise(() =>
			fetch(new URL(intent.uploadUrl, `${apiUrl}/`), {
				body: SHOW_COVER,
				method: intent.method,
				headers: intent.headers,
			}),
		);
		expect([200, 204]).toContain(upload.status);
		const cover = yield* client.call((c) =>
			c.uploads.completeIntent({ params: { intentId: intent.intentId } }),
		);
		if (!("key" in cover)) {
			throw new Error("Expected a permanent Show cover");
		}
		const { showId } = yield* seedGlobalShowEpisodeTree(client, {
			showName: SHOW_NAME,
			showProperties: {
				totalSeasons: 2,
				totalEpisodes: 12,
				publishYear: 2025,
				genres: ["Drama", "Mystery"],
				productionStatus: "Returning Series",
				images: [{ ...cover, purpose: "cover" }],
				description: "A deterministic browser tracer show.",
			},
		});
		yield* insertLibraryMembership(client, { mediaEntityId: showId });
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/v/all-shows`);
		yield* page.getByRole("link", { name: `Open ${SHOW_NAME}` }).click();
		yield* page.waitForURL(`${frontendUrl}/e/${showId}`);
		expect(new URL(page.url()).pathname).toBe(`/e/${showId}`);
		expect(page.url()).not.toContain("/media");

		const frame = page.locator('iframe[title="media plugin"]');
		yield* frame.waitFor({ state: "visible" });
		const media = frame.contentFrame();
		yield* media.getByRole("heading", { level: 1, name: SHOW_NAME }).waitFor({ state: "visible" });
		yield* expectVisibleText(media.locator("body"), "TV Show · TMDB · 2025");
		yield* expectVisibleText(media.locator("body"), "Returning Series");
		yield* expectVisibleText(media.locator("body"), "2 seasons");
		yield* expectVisibleText(media.locator("body"), "12 episodes");
		yield* expectVisibleText(media.locator("body"), "A deterministic browser tracer show.");
		const coverImage = media.locator("article img");
		yield* coverImage.waitFor({ state: "visible" });
		expect(yield* coverImage.getAttribute("alt")).toBe("");
		const coverUrl = new URL(
			requirePresent(yield* coverImage.getAttribute("src"), "Missing cover URL"),
		);
		expect(coverUrl.href).toMatch(/^https?:\/\//);
		expect(coverUrl.searchParams.get("response-content-disposition")).toBe("attachment");
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
		yield* page.waitForURL(`${frontendUrl}/v/all-shows`);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("uses the SDK unavailable renderer for an unsupported Media schema", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const frontendUrl = getFrontendUrl();
		const { token, email, password } = yield* createTestUser(apiUrl);
		const client = makeSession(apiUrl, { Authorization: `Bearer ${token}` });
		const { schema } = yield* findBuiltinSchemaBySlug(client, "movie");
		const provider = requirePresent(
			schema.providers[0],
			"Missing provider for built-in movie schema",
		);
		const movie = yield* seedMediaEntity({
			properties: {},
			entitySchemaSlug: schema.id,
			name: "Unsupported Media Movie",
			providerId: provider.providerId,
			externalId: `media-movie-${crypto.randomUUID()}`,
		});
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/e/${movie.id}`);
		yield* page.waitForURL(`${frontendUrl}/e/${movie.id}`);

		const frame = page.locator('iframe[title="media plugin"]');
		yield* frame.waitFor({ state: "visible" });
		yield* expectVisibleText(frame.contentFrame().locator("body"), "Entity renderer unavailable");
		expect(yield* page.getByText("Kernel-owned entity unsupported", { exact: true }).count).toBe(0);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);
