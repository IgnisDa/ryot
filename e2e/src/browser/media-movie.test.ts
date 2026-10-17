import { savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import { mediaPlugin } from "@ryot-app/media-plugin";
import { Effect, Option } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	type Client,
	createAuthenticatedClient,
	createEventFixture,
	listEventSchemas,
	requireEventSchemaBySlug,
	waitForEventWithSchema,
} from "~/fixtures/kernel";
import { listPluginUserSettings } from "~/fixtures/kernel/plugin-user-settings";
import {
	findMediaEntitySchema,
	insertLibraryMembership,
	seedGlobalMovieWithCollection,
} from "~/fixtures/plugins/media";
import { mediaPluginFrame } from "~/fixtures/plugins/media/frame";
import { seedGlobalMediaGenres } from "~/fixtures/plugins/media/genres";
import { requirePresent } from "~/support/assertions";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const MOVIE_COVER = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="90"><rect width="60" height="90" fill="#2563eb"/></svg>`;

const SIBLING_COVER = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="60"><rect width="40" height="60" fill="#16a34a"/></svg>`;

const movieEventSchemas = (client: Client) =>
	Effect.gen(function* () {
		const { schema } = yield* findMediaEntitySchema(client, "movie");
		const eventSchemas = yield* listEventSchemas(client, schema.reference);
		return {
			progress: requireEventSchemaBySlug(eventSchemas, "progress").id,
			complete: requireEventSchemaBySlug(eventSchemas, "complete").id,
		};
	});

const box = (locator: Playwright.Locator) =>
	locator
		.boundingBox()
		.pipe(Effect.map((value) => Option.getOrThrowWith(value, () => new Error("Missing box"))));

const sectionTitles = (media: Playwright.FrameLocator) =>
	media.locator("section > div > div > h2").allTextContents();

it.live("renders a populated Movie detail with its collection rail", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const suffix = crypto.randomUUID();
		const movieName = `Browser Tracer Movie ${suffix}`;
		const siblingName = `Browser Tracer Sequel ${suffix}`;
		const collectionName = `Browser Tracer Collection ${suffix}`;
		const { email, client, password } = yield* createAuthenticatedClient();
		const cover = { type: "remote" as const, url: "https://images.test/movie-cover.svg" };
		const siblingCover = { type: "remote" as const, url: "https://images.test/movie-sibling.svg" };
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
		yield* seedGlobalMediaGenres({
			entityId: seeded.movie.id,
			entitySchemaSlug: "movie",
			names: ["Drama", "Thriller"],
		});
		yield* insertLibraryMembership(client, { mediaEntityId: seeded.movie.id });
		const events = yield* movieEventSchemas(client);
		yield* createEventFixture(client, {
			entityId: seeded.movie.id,
			eventSchemaSlug: events.complete,
			properties: { dateUnknown: true },
			occurredAt: "2026-07-01T10:00:00.000Z",
		});
		yield* createEventFixture(client, {
			entityId: seeded.movie.id,
			eventSchemaSlug: events.complete,
			properties: { dateUnknown: true },
			occurredAt: "2026-07-08T10:00:00.000Z",
		});

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({
			locale: "en-US",
			viewport: { width: 1280, height: 900 },
		});
		yield* page.use((native) =>
			native
				.context()
				.route(cover.url, (route) =>
					route.fulfill({ body: MOVIE_COVER, contentType: "image/svg+xml" }),
				),
		);
		yield* page.use((native) =>
			native
				.context()
				.route(siblingCover.url, (route) =>
					route.fulfill({ body: SIBLING_COVER, contentType: "image/svg+xml" }),
				),
		);
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/e/${seeded.movie.id}`);
		const frame = mediaPluginFrame(page);
		yield* frame.waitFor({ state: "visible" });
		const media = frame.contentFrame();
		yield* media
			.getByRole("heading", { level: 1, exact: true, name: movieName })
			.waitFor({ state: "visible", timeout: 150_000 });

		const body = media.locator("body");
		yield* body.getByText("1999·2h 49m·TMDB", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Drama", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("2h 49m", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Released", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("TMDB rating", { exact: true }).waitFor({ state: "visible" });
		expect(yield* body.getByText("Seasons", { exact: true }).count).toBe(0);
		expect(yield* body.getByText("Episodes", { exact: true }).count).toBe(0);

		yield* body.getByText("Your status", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Complete", { exact: true }).first().waitFor({ state: "visible" });
		yield* body.getByText("In media library", { exact: true }).waitFor({ state: "visible" });
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
		expect(siblingSrc).toBe(siblingCover.url);
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
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("keeps the collection rail for a Movie with no credits or recommendations", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const suffix = crypto.randomUUID();
		const movieName = `Bare Tracer Movie ${suffix}`;
		const siblingName = `Bare Tracer Sequel ${suffix}`;
		const collectionName = `Bare Tracer Collection ${suffix}`;
		const { email, client, password } = yield* createAuthenticatedClient();
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
		const frame = mediaPluginFrame(page);
		yield* frame.waitFor({ state: "visible" });
		const media = frame.contentFrame();
		yield* media
			.getByRole("heading", { level: 1, exact: true, name: movieName })
			.waitFor({ state: "visible", timeout: 150_000 });

		const body = media.locator("body");
		yield* body
			.getByText("Your status", { exact: true })
			.locator("../..")
			.getByText("In progress", { exact: true })
			.waitFor({ state: "visible" });
		yield* media
			.getByRole("heading", { level: 2, name: `Part of ${collectionName}` })
			.waitFor({ state: "visible" });
		expect(yield* sectionTitles(media)).toEqual([`Part of ${collectionName}`]);
		expect(yield* media.locator('div[style*="width: 35%"]').count).toBe(1);
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("renders the Movie presentation facts in the canonical saved view", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const suffix = crypto.randomUUID();
		const movieName = `Row Tracer Movie ${suffix}`;
		const { email, client, password } = yield* createAuthenticatedClient();
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
		yield* page.goto(
			`${frontendUrl}${savedViewPath({ kind: "plugin", slug: "all-movies", packageId: mediaPlugin.metadata.packageId })}`,
		);
		const view = page.locator("iframe").contentFrame();
		const row = view.locator(`article[data-entity-id="${seeded.movie.id}"]`);
		yield* row.waitFor({ state: "visible" });

		yield* row.getByText("2014", { exact: true }).waitFor({ state: "visible" });
		yield* row.getByText("2h 4m", { exact: true }).waitFor({ state: "visible" });
		yield* row.getByText("In progress", { exact: true }).waitFor({ state: "visible" });
		yield* row.getByText("60% watched", { exact: true }).waitFor({ state: "visible" });

		yield* view.getByRole("link", { exact: true, name: movieName }).click();
		yield* page.waitForURL(`${frontendUrl}/e/${seeded.movie.id}`);
		yield* mediaPluginFrame(page)
			.contentFrame()
			.getByRole("heading", { level: 1, exact: true, name: movieName })
			.waitFor({ state: "visible", timeout: 150_000 });
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("logs a finished Movie from the Log activity sheet without a reload", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const suffix = crypto.randomUUID();
		const movieName = `Logger Tracer Movie ${suffix}`;
		const { email, client, password } = yield* createAuthenticatedClient();
		const seeded = yield* seedGlobalMovieWithCollection(client, {
			movieName,
			siblingName: `Logger Tracer Sequel ${suffix}`,
			collectionName: `Logger Tracer Collection ${suffix}`,
			movieProperties: { runtime: 101, publishYear: 2010 },
		});
		yield* insertLibraryMembership(client, { mediaEntityId: seeded.movie.id });
		const events = yield* movieEventSchemas(client);

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/e/${seeded.movie.id}`);
		const media = mediaPluginFrame(page).contentFrame();
		yield* media
			.getByRole("heading", { level: 1, exact: true, name: movieName })
			.waitFor({ state: "visible", timeout: 150_000 });

		yield* media.getByRole("button", { exact: true, name: "Log activity" }).click();
		const dialog = media.getByRole("dialog", { name: "Log activity" });
		yield* dialog.waitFor({ state: "visible" });
		yield* dialog
			.getByRole("radiogroup", { name: "What happened" })
			.getByRole("radio", { name: "Finished" })
			.waitFor({ state: "visible" });
		yield* dialog.getByRole("radio", { name: "Just now" }).waitFor({ state: "visible" });
		yield* dialog.getByRole("button", { exact: true, name: "Mark as watched" }).click();
		yield* dialog
			.getByText(`${movieName} marked as watched.`, { exact: true })
			.waitFor({ state: "visible" });
		yield* dialog.getByRole("button", { exact: true, name: "Done" }).click();
		yield* dialog.waitFor({ state: "hidden" });

		const body = media.locator("body");
		yield* body
			.getByText("Your status", { exact: true })
			.locator("../..")
			.getByText("Complete", { exact: true })
			.waitFor({ state: "visible" });
		yield* media.getByRole("tab", { name: "Activity" }).click();
		const record = media.getByRole("list", { name: "Watch record" });
		yield* record.getByText("Finished the movie", { exact: true }).waitFor({ state: "visible" });
		expect(yield* record.getByText("Finished the movie", { exact: true }).count).toBe(1);

		const complete = yield* waitForEventWithSchema(client, seeded.movie.id, events.complete);
		expect(complete.eventSchemaSlug).toBe(events.complete);
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("suggests the user's Where you consume list in the Log activity sheet and grows it", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const suffix = crypto.randomUUID();
		const movieName = `Source Tracer Movie ${suffix}`;
		const source = `Source ${suffix.slice(0, 8)}`;
		const { email, client, password } = yield* createAuthenticatedClient();
		const seeded = yield* seedGlobalMovieWithCollection(client, {
			movieName,
			siblingName: `Source Tracer Sequel ${suffix}`,
			collectionName: `Source Tracer Collection ${suffix}`,
			movieProperties: { runtime: 101, publishYear: 2010 },
		});
		yield* insertLibraryMembership(client, { mediaEntityId: seeded.movie.id });

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/e/${seeded.movie.id}`);
		const media = mediaPluginFrame(page).contentFrame();
		yield* media
			.getByRole("heading", { level: 1, exact: true, name: movieName })
			.waitFor({ state: "visible", timeout: 150_000 });

		const dialog = media.getByRole("dialog", { name: "Log activity" });
		yield* media.getByRole("button", { exact: true, name: "Log activity" }).click();
		yield* dialog
			.getByRole("button", { exact: true, name: "Cinema" })
			.waitFor({ state: "visible" });
		yield* dialog
			.getByRole("button", { exact: true, name: "Netflix" })
			.waitFor({ state: "visible" });
		expect(yield* dialog.getByRole("button", { exact: true, name: source }).count).toBe(0);
		yield* dialog.getByLabel("Where did you watch it?").fill(source);
		yield* dialog.getByRole("button", { exact: true, name: "Mark as watched" }).click();
		yield* dialog
			.getByText(`${movieName} marked as watched.`, { exact: true })
			.waitFor({ state: "visible" });
		yield* dialog.getByRole("button", { exact: true, name: "Done" }).click();
		yield* dialog.waitFor({ state: "hidden" });

		const mediaSettings = requirePresent(
			(yield* listPluginUserSettings(client)).find(({ name }) => name === "Media"),
			"Media settings not found",
		);
		expect(mediaSettings.settings.consumedOnMovie).toEqual([
			"Netflix",
			"Amazon Prime",
			"Disney+",
			"HBO Max",
			"Apple TV",
			"Peacock",
			"Hulu",
			"Crunchyroll",
			"Cinema",
			source,
		]);

		yield* media.getByRole("button", { exact: true, name: "Log activity" }).click();
		yield* dialog.getByRole("button", { exact: true, name: source }).waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("fits an untracked Movie detail and its Log activity sheet to a phone width", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const suffix = crypto.randomUUID();
		const movieName = `Phone Tracer Movie ${suffix}`;
		const { email, client, password } = yield* createAuthenticatedClient();
		const seeded = yield* seedGlobalMovieWithCollection(client, {
			movieName,
			withCredits: true,
			siblingName: `Phone Tracer Sequel ${suffix}`,
			collectionName: `Phone Tracer Collection ${suffix}`,
			movieProperties: {
				runtime: 104,
				publishYear: 2006,
				providerRating: 65.63,
				productionStatus: "Released",
				images: [1, 2, 3, 4].map((index) => ({
					type: "remote",
					purpose: "backdrop",
					url: `https://images.test/phone-${index}.svg`,
				})),
				description:
					"In order to avoid a jail sentence, a teenager heads to a new city to live with a relative and gets caught up in an underground racing scene that tests everything he thought he knew.",
				watchProviders: [
					{
						country: "US",
						link: "https://www.themoviedb.org/movie/9615/watch?locale=US",
						providers: [
							"Amazon Prime Video",
							"Amazon Prime Video with Ads",
							"Netflix Standard with Ads",
							"Apple TV Store",
							"Google Play Movies",
							"Fandango At Home",
						].map((name) => ({ name, image: null, offers: ["stream", "rent"] })),
					},
				],
			},
		});
		yield* seedGlobalMediaGenres({
			entityId: seeded.movie.id,
			entitySchemaSlug: "movie",
			names: ["Action", "Crime", "Thriller"],
		});

		const page = yield* (yield* Playwright.Browser).newPage();
		yield* page.setViewportSize({ width: 390, height: 844 });
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/e/${seeded.movie.id}`);
		const media = mediaPluginFrame(page).contentFrame();
		yield* media
			.getByRole("heading", { level: 1, exact: true, name: movieName })
			.waitFor({ state: "visible", timeout: 150_000 });
		yield* media.getByText("TMDB rating", { exact: true }).waitFor({ state: "visible" });

		const overflowing = yield* media.locator("html").evaluate((root) =>
			[...root.querySelectorAll("main *")]
				.filter((element) => {
					for (
						let node = element.parentElement;
						node !== null && node.tagName !== "MAIN";
						node = node.parentElement
					) {
						if (getComputedStyle(node).overflowX === "auto") {
							return false;
						}
					}
					return element.getBoundingClientRect().right > root.clientWidth + 1;
				})
				.map((element) => element.tagName),
		);
		expect(overflowing).toEqual([]);

		yield* media.getByRole("button", { exact: true, name: "Log activity" }).click();
		const dialog = media.getByRole("dialog", { name: "Log activity" });
		yield* dialog.waitFor({ state: "visible" });
		yield* dialog
			.getByRole("radiogroup", { name: "What happened" })
			.getByRole("radio", { name: "Progress" })
			.click();
		yield* dialog.getByRole("button", { exact: true, name: "Add an amount" }).click();
		const sheet = yield* box(dialog);
		const amount = yield* box(dialog.getByLabel("How far along?"));
		expect(amount.x).toBeGreaterThanOrEqual(sheet.x);
		expect(amount.x + amount.width).toBeLessThanOrEqual(sheet.x + sheet.width);
		const unit = yield* box(dialog.getByRole("radiogroup", { name: "Unit" }));
		expect(unit.x + unit.width).toBeLessThanOrEqual(sheet.x + sheet.width);

		const cancel = yield* box(dialog.getByRole("button", { exact: true, name: "Cancel" }));
		const save = yield* box(dialog.getByRole("button", { exact: true, name: "Save progress" }));
		expect(Math.abs(cancel.width - save.width)).toBeLessThanOrEqual(1);
		expect(cancel.width + save.width).toBeGreaterThan(sheet.width * 0.8);
	}).pipe(PlaywrightSpawner.withBrowser),
);
