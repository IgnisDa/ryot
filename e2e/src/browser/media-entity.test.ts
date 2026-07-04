import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createTestUser, findBuiltinSchemaBySlug, makeSession } from "~/fixtures/kernel";
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
const SHOW_COVER = "https://images.example.test/media-entity-cover.jpg";

const expectVisibleText = (locator: Playwright.Locator, text: string) =>
	Effect.gen(function* () {
		const match = locator.getByText(text, { exact: true }).filter({ visible: true });
		yield* match.waitFor({ state: "visible" });
		expect(yield* match.isVisible()).toBe(true);
	});

it.live("opens a Media Show entity from the canonical saved-view route", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const frontendUrl = getFrontendUrl();
		const { token, email, password } = yield* createTestUser(apiUrl);
		const client = makeSession(apiUrl, { Authorization: `Bearer ${token}` });
		const { showId } = yield* seedGlobalShowEpisodeTree(client, {
			showName: SHOW_NAME,
			showProperties: {
				totalSeasons: 2,
				totalEpisodes: 12,
				publishYear: 2025,
				genres: ["Drama", "Mystery"],
				productionStatus: "Returning Series",
				description: "A deterministic browser tracer show.",
				images: [{ type: "remote", url: SHOW_COVER, purpose: "cover" }],
			},
		});
		yield* insertLibraryMembership(client, { mediaEntityId: showId });
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/v/all-shows`);
		yield* page.getByRole("link", { name: `Open ${SHOW_NAME}` }).click();
		yield* page.waitForURL(`${frontendUrl}/e/${showId}`);
		expect(new URL(page.url()).pathname).toBe(`/e/${showId}`);
		expect(page.url()).not.toContain("/media");

		const frame = page.locator('iframe[title="media plugin"]');
		yield* frame.waitFor({ state: "visible" });
		const media = frame.contentFrame();
		yield* media.getByRole("heading", { level: 2, name: SHOW_NAME }).waitFor({ state: "visible" });
		yield* expectVisibleText(media.locator("body"), "TV Show · TMDB · 2025");
		yield* expectVisibleText(media.locator("body"), "Returning Series");
		yield* expectVisibleText(media.locator("body"), "2 seasons");
		yield* expectVisibleText(media.locator("body"), "12 episodes");
		yield* expectVisibleText(media.locator("body"), "A deterministic browser tracer show.");
		expect(yield* media.locator(`img[src="${SHOW_COVER}"]`).getAttribute("alt")).toBe("");
		yield* page
			.locator("html")
			.waitForFunction((_html, title: string) => document.title === title, `${SHOW_NAME} — Ryot`);
		expect(yield* page.title).toBe(`${SHOW_NAME} — Ryot`);

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
