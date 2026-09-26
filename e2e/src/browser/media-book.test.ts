import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	createAuthenticatedClient,
	createEventFixture,
	findBuiltinSchemaBySlug,
	listEventSchemas,
	requireEventSchemaBySlug,
	type Client,
} from "~/fixtures/kernel";
import { insertLibraryMembership, seedGlobalBookWithSeries } from "~/fixtures/plugins/media";
import { requirePresent } from "~/support/assertions";
import { browserLayer, signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getApiUrl, getFrontendUrl } from "~/support/harness-target";

const BOOK_COVER = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="60"><rect width="40" height="60" fill="#0f766e"/></svg>`;

const SIBLING_COVER = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="60"><rect width="40" height="60" fill="#be123c"/></svg>`;

const uploadPermanentAsset = (apiUrl: string, client: Client, body: string) =>
	Effect.gen(function* () {
		const intent = yield* client.call((c) =>
			c.uploads.createIntent({
				payload: { kind: "permanent", fileName: "book-art.svg", contentType: "image/svg+xml" },
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

const bookEventSchemas = (client: Client) =>
	Effect.gen(function* () {
		const { schema } = yield* findBuiltinSchemaBySlug(client, "book");
		const eventSchemas = yield* listEventSchemas(client, schema.id);
		return {
			progress: requireEventSchemaBySlug(eventSchemas, "progress").id,
			complete: requireEventSchemaBySlug(eventSchemas, "complete").id,
		};
	});

const sectionTitles = (media: Playwright.FrameLocator) =>
	media.locator("section > div > div > h2").allTextContents();

it.live("renders a populated Book detail with its series rail and unlinked creators", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const frontendUrl = getFrontendUrl();
		const suffix = crypto.randomUUID();
		const bookName = `Browser Tracer Book ${suffix}`;
		const siblingName = `Browser Tracer Sequel ${suffix}`;
		const seriesName = `Browser Tracer Series ${suffix}`;
		const unlinkedAuthor = `Unlinked Author ${suffix}`;
		const unlinkedPublisher = `Unlinked Press ${suffix}`;
		const { email, client, password } = yield* createAuthenticatedClient(apiUrl);
		const cover = yield* uploadPermanentAsset(apiUrl, client, BOOK_COVER);
		const siblingCover = yield* uploadPermanentAsset(apiUrl, client, SIBLING_COVER);
		const seeded = yield* seedGlobalBookWithSeries(client, {
			bookName,
			seriesName,
			siblingName,
			withCredits: true,
			siblingProperties: { images: [{ ...siblingCover, purpose: "cover" }] },
			bookProperties: {
				pages: 320,
				publishYear: 1997,
				providerRating: 92.5,
				isCompilation: false,
				genres: ["Science Fiction"],
				productionStatus: "Released",
				images: [{ ...cover, purpose: "cover" }],
				description: "A deterministic browser tracer book.",
				unlinkedCreators: [
					{ role: "Author", name: unlinkedAuthor },
					{ role: "Publisher", name: unlinkedPublisher },
				],
			},
		});
		yield* insertLibraryMembership(client, { mediaEntityId: seeded.book.id });
		const events = yield* bookEventSchemas(client);
		yield* createEventFixture(client, {
			entityId: seeded.book.id,
			eventSchemaSlug: events.complete,
			occurredAt: "2026-07-01T10:00:00.000Z",
			properties: { completionMode: "unknown" },
		});
		yield* createEventFixture(client, {
			entityId: seeded.book.id,
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
		yield* page.goto(`${frontendUrl}/e/${seeded.book.id}`);
		const frame = page.locator('iframe[title="media plugin"]');
		yield* frame.waitFor({ state: "visible" });
		const media = frame.contentFrame();
		yield* media
			.getByRole("heading", { level: 1, exact: true, name: bookName })
			.waitFor({ state: "visible", timeout: 150_000 });

		const body = media.locator("body");
		yield* body.getByText("Book • Hardcover • 1997", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Science Fiction", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Pages", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("320", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Compilation", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("No", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Production status", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Released", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Hardcover rating", { exact: true }).waitFor({ state: "visible" });
		expect(yield* body.getByText("Runtime", { exact: true }).count).toBe(0);
		expect(yield* body.getByText("Length", { exact: true }).count).toBe(0);
		expect(yield* body.getByText("Seasons", { exact: true }).count).toBe(0);

		yield* body.getByText("Your status", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Complete", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("In media library", { exact: true }).waitFor({ state: "visible" });

		expect(yield* media.getByRole("tab").allTextContents()).toEqual(["Overview", "Activity"]);

		yield* media
			.getByRole("heading", { level: 2, name: `Part of ${seriesName}` })
			.waitFor({ state: "visible" });
		expect(yield* sectionTitles(media)).toEqual([
			"Images",
			"Authors & contributors",
			"Publishers",
			"More like this",
			`Part of ${seriesName}`,
		]);
		expect(yield* body.getByText("Where to watch", { exact: true }).count).toBe(0);

		yield* body.getByText(unlinkedAuthor, { exact: true }).waitFor({ state: "visible" });
		expect(yield* media.getByRole("link", { name: `Open ${unlinkedAuthor}` }).count).toBe(0);
		yield* body.getByText(unlinkedPublisher, { exact: true }).waitFor({ state: "visible" });
		expect(yield* media.getByRole("link", { name: `Open ${unlinkedPublisher}` }).count).toBe(0);

		const siblingLink = media.getByRole("link", { name: `Open ${siblingName}` });
		yield* siblingLink.waitFor({ state: "visible" });
		const siblingArt = siblingLink.locator("img");
		yield* siblingArt.waitFor({ state: "visible" });
		const siblingSrc = requirePresent(
			yield* siblingArt.getAttribute("src"),
			"Missing series sibling artwork",
		);
		expect(siblingSrc).toContain(siblingCover.key);
		expect(yield* media.getByRole("link", { name: `Open ${bookName}` }).count).toBe(0);
		yield* media
			.getByRole("link", { exact: true, name: "View series" })
			.waitFor({ state: "visible" });

		yield* media.getByRole("tab", { name: "Activity" }).click();
		const record = media.getByRole("list", { name: "Reading record" });
		yield* record.waitFor({ state: "visible" });
		expect(yield* record.getByText("Finished the book", { exact: true }).count).toBe(2);
		expect(yield* body.getByText("Reads", { exact: true }).count).toBe(1);
		yield* body.getByText("640", { exact: true }).waitFor({ state: "visible" });
		expect(yield* body.getByText("Watches", { exact: true }).count).toBe(0);
		expect(yield* body.getByText("Listens", { exact: true }).count).toBe(0);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("renders the Book presentation facts in the canonical saved view", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const frontendUrl = getFrontendUrl();
		const suffix = crypto.randomUUID();
		const bookName = `Row Tracer Book ${suffix}`;
		const { email, client, password } = yield* createAuthenticatedClient(apiUrl);
		const seeded = yield* seedGlobalBookWithSeries(client, {
			bookName,
			seriesName: `Row Tracer Series ${suffix}`,
			siblingName: `Row Tracer Sequel ${suffix}`,
			bookProperties: { pages: 320, publishYear: 2014 },
		});
		const events = yield* bookEventSchemas(client);
		yield* createEventFixture(client, {
			entityId: seeded.book.id,
			eventSchemaSlug: events.progress,
			properties: { progressPercent: 60 },
			occurredAt: "2026-07-03T10:00:00.000Z",
		});

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/v/all-books`);
		const view = page.locator("iframe").contentFrame();
		const row = view.locator(`article[data-entity-id="${seeded.book.id}"]`);
		yield* row.waitFor({ state: "visible" });

		yield* row.getByText("2014", { exact: true }).waitFor({ state: "visible" });
		yield* row.getByText("320 pages", { exact: true }).waitFor({ state: "visible" });
		yield* row.getByText("In progress", { exact: true }).waitFor({ state: "visible" });
		yield* row.getByText("60% read", { exact: true }).waitFor({ state: "visible" });

		yield* view.getByRole("link", { exact: true, name: bookName }).click();
		yield* page.waitForURL(`${frontendUrl}/e/${seeded.book.id}`);
		yield* page
			.locator('iframe[title="media plugin"]')
			.contentFrame()
			.getByRole("heading", { level: 1, exact: true, name: bookName })
			.waitFor({ state: "visible", timeout: 150_000 });
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);
