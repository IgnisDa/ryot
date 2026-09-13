import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	createEventFixture,
	createTestUser,
	findBuiltinSchemaBySlug,
	listEventSchemas,
	makeSession,
	requireEventSchemaBySlug,
	type Client,
} from "~/fixtures/kernel";
import { insertLibraryMembership, seedGlobalMovieWithCollection } from "~/fixtures/plugins/media";
import { requirePresent } from "~/support/assertions";
import { browserLayer, signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getApiUrl, getFrontendUrl } from "~/support/harness-target";

const MOVIE_COVER = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="90"><rect width="60" height="90" fill="#2563eb"/></svg>`;

const SIBLING_COVER = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="60"><rect width="40" height="60" fill="#16a34a"/></svg>`;

const uploadPermanentAsset = (apiUrl: string, client: Client, body: string) =>
	Effect.gen(function* () {
		const intent = yield* client.call((c) =>
			c.uploads.createIntent({
				payload: { kind: "permanent", fileName: "movie-art.svg", contentType: "image/svg+xml" },
			}),
		);
		const upload = yield* Effect.promise(() =>
			fetch(new URL(intent.uploadUrl, `${apiUrl}/`), {
				body,
				method: intent.method,
				headers: intent.headers,
			}),
		);
		expect([200, 204]).toContain(upload.status);
		const asset = yield* client.call((c) =>
			c.uploads.completeIntent({ params: { intentId: intent.intentId } }),
		);
		if (!("key" in asset)) {
			throw new Error("Expected a permanent asset locator");
		}
		return asset;
	});

const movieEventSchemas = (client: Client) =>
	Effect.gen(function* () {
		const { schema } = yield* findBuiltinSchemaBySlug(client, "movie");
		const eventSchemas = yield* listEventSchemas(client, schema.id);
		return {
			progress: requireEventSchemaBySlug(eventSchemas, "progress").id,
			complete: requireEventSchemaBySlug(eventSchemas, "complete").id,
		};
	});

const sectionTitles = (media: Playwright.FrameLocator) =>
	media.locator("section > div > div > h2").allTextContents();

it.live("renders a populated Movie detail with its collection rail", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const frontendUrl = getFrontendUrl();
		const suffix = crypto.randomUUID();
		const movieName = `Browser Tracer Movie ${suffix}`;
		const siblingName = `Browser Tracer Sequel ${suffix}`;
		const collectionName = `Browser Tracer Collection ${suffix}`;
		const { token, email, password } = yield* createTestUser(apiUrl);
		const client = makeSession(apiUrl, { Authorization: `Bearer ${token}` });
		const cover = yield* uploadPermanentAsset(apiUrl, client, MOVIE_COVER);
		const siblingCover = yield* uploadPermanentAsset(apiUrl, client, SIBLING_COVER);
		const seeded = yield* seedGlobalMovieWithCollection(client, {
			movieName,
			siblingName,
			collectionName,
			withCredits: true,
			siblingProperties: { images: [{ ...siblingCover, purpose: "cover" }] },
			movieProperties: {
				runtime: 169,
				publishYear: 1999,
				providerRating: 86.5,
				productionStatus: "Released",
				genres: ["Drama", "Thriller"],
				images: [{ ...cover, purpose: "cover" }],
				description: "A deterministic browser tracer movie.",
				watchProviders: [
					{
						country: "US",
						link: "https://www.themoviedb.org/movie/550/watch?locale=US",
						providers: [{ image: null, name: "Netflix", offers: ["stream"] }],
					},
				],
			},
		});
		yield* insertLibraryMembership(client, { mediaEntityId: seeded.movie.id });
		const events = yield* movieEventSchemas(client);
		yield* createEventFixture(client, {
			entityId: seeded.movie.id,
			eventSchemaSlug: events.complete,
			occurredAt: "2026-07-01T10:00:00.000Z",
			properties: { completionMode: "unknown" },
		});
		yield* createEventFixture(client, {
			entityId: seeded.movie.id,
			eventSchemaSlug: events.complete,
			occurredAt: "2026-07-08T10:00:00.000Z",
			properties: { completionMode: "unknown" },
		});

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({
			locale: "en-US",
			viewport: { width: 1280, height: 900 },
		});
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/e/${seeded.movie.id}`);
		const frame = page.locator('iframe[title="media plugin"]');
		yield* frame.waitFor({ state: "visible" });
		const media = frame.contentFrame();
		yield* media
			.getByRole("heading", { level: 1, exact: true, name: movieName })
			.waitFor({ state: "visible", timeout: 150_000 });

		const body = media.locator("body");
		yield* body.getByText("Movie • TMDB • 1999", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Drama", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("2h 49m", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Released", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("TMDB rating", { exact: true }).waitFor({ state: "visible" });
		expect(yield* body.getByText("Seasons", { exact: true }).count).toBe(0);
		expect(yield* body.getByText("Episodes", { exact: true }).count).toBe(0);

		yield* body.getByText("Your status", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Complete", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("In library", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Ownership", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Collections", { exact: true }).waitFor({ state: "visible" });

		expect(yield* media.getByRole("tab").allTextContents()).toEqual(["Overview", "Activity"]);

		const partOf = media.getByRole("heading", { level: 2, name: `Part of ${collectionName}` });
		yield* partOf.waitFor({ state: "visible" });
		yield* media
			.getByRole("heading", { level: 2, exact: true, name: "Where to watch" })
			.waitFor({ state: "visible" });
		yield* body
			.getByText("Availability in United States, from JustWatch.", { exact: true })
			.waitFor({ state: "visible" });
		expect(yield* sectionTitles(media)).toEqual([
			"Images",
			"Cast & crew",
			"Production companies",
			"More like this",
			`Part of ${collectionName}`,
			"Where to watch",
		]);

		const siblingLink = media.getByRole("link", { name: `Open ${siblingName}` });
		yield* siblingLink.waitFor({ state: "visible" });
		const siblingArt = siblingLink.locator("img");
		yield* siblingArt.waitFor({ state: "visible" });
		const siblingSrc = requirePresent(
			yield* siblingArt.getAttribute("src"),
			"Missing collection sibling artwork",
		);
		expect(siblingSrc).toContain(siblingCover.key);
		expect(new URL(siblingSrc).href).toMatch(/^https?:\/\//);
		expect(yield* media.getByRole("link", { name: `Open ${movieName}` }).count).toBe(0);

		yield* media.getByRole("tab", { name: "Activity" }).click();
		const record = media.getByRole("list", { name: "Watch record" });
		yield* record.waitFor({ state: "visible" });
		expect(yield* record.getByText("Finished the movie", { exact: true }).count).toBe(2);
		expect(yield* record.locator("p").filter({ hasText: /^Watch 2 · / }).count).toBe(1);
		expect(yield* record.locator("p").filter({ hasText: /^Watch 1 · / }).count).toBe(1);
		expect(yield* body.getByText("Coverage", { exact: true }).count).toBe(0);
		expect(yield* body.getByText("Watches", { exact: true }).count).toBe(1);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("keeps the collection rail for a Movie with no credits or recommendations", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const frontendUrl = getFrontendUrl();
		const suffix = crypto.randomUUID();
		const movieName = `Bare Tracer Movie ${suffix}`;
		const siblingName = `Bare Tracer Sequel ${suffix}`;
		const collectionName = `Bare Tracer Collection ${suffix}`;
		const { token, email, password } = yield* createTestUser(apiUrl);
		const client = makeSession(apiUrl, { Authorization: `Bearer ${token}` });
		const seeded = yield* seedGlobalMovieWithCollection(client, {
			movieName,
			siblingName,
			collectionName,
			movieProperties: { runtime: 92, publishYear: 2001 },
		});
		const events = yield* movieEventSchemas(client);
		yield* createEventFixture(client, {
			entityId: seeded.movie.id,
			eventSchemaSlug: events.progress,
			properties: { progressPercent: 35 },
			occurredAt: "2026-07-02T10:00:00.000Z",
		});

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/e/${seeded.movie.id}`);
		const frame = page.locator('iframe[title="media plugin"]');
		yield* frame.waitFor({ state: "visible" });
		const media = frame.contentFrame();
		yield* media
			.getByRole("heading", { level: 1, exact: true, name: movieName })
			.waitFor({ state: "visible", timeout: 150_000 });

		const body = media.locator("body");
		yield* body.getByText("In progress", { exact: true }).waitFor({ state: "visible" });
		yield* media
			.getByRole("heading", { level: 2, name: `Part of ${collectionName}` })
			.waitFor({ state: "visible" });
		expect(yield* sectionTitles(media)).toEqual([`Part of ${collectionName}`]);
		expect(yield* media.locator('div[style*="width: 35%"]').count).toBe(1);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("renders the Movie presentation facts in the canonical saved view", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const frontendUrl = getFrontendUrl();
		const suffix = crypto.randomUUID();
		const movieName = `Row Tracer Movie ${suffix}`;
		const { token, email, password } = yield* createTestUser(apiUrl);
		const client = makeSession(apiUrl, { Authorization: `Bearer ${token}` });
		const seeded = yield* seedGlobalMovieWithCollection(client, {
			movieName,
			siblingName: `Row Tracer Sequel ${suffix}`,
			collectionName: `Row Tracer Collection ${suffix}`,
			movieProperties: { runtime: 124, publishYear: 2014 },
		});
		const events = yield* movieEventSchemas(client);
		yield* createEventFixture(client, {
			entityId: seeded.movie.id,
			eventSchemaSlug: events.progress,
			properties: { progressPercent: 60 },
			occurredAt: "2026-07-03T10:00:00.000Z",
		});

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/v/all-movies`);
		const view = page.locator("iframe").contentFrame();
		const row = view.locator(`article[data-entity-id="${seeded.movie.id}"]`);
		yield* row.waitFor({ state: "visible" });

		yield* row.getByText("2014", { exact: true }).waitFor({ state: "visible" });
		yield* row.getByText("2h 4m", { exact: true }).waitFor({ state: "visible" });
		yield* row.getByText("In progress", { exact: true }).waitFor({ state: "visible" });
		yield* row.getByText("60% watched", { exact: true }).waitFor({ state: "visible" });

		yield* view.getByRole("link", { exact: true, name: movieName }).click();
		yield* page.waitForURL(`${frontendUrl}/e/${seeded.movie.id}`);
		yield* page
			.locator('iframe[title="media plugin"]')
			.contentFrame()
			.getByRole("heading", { level: 1, exact: true, name: movieName })
			.waitFor({ state: "visible", timeout: 150_000 });
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);
