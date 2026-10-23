import { savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import { mediaPlugin } from "@ryot-app/media-plugin";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	type Client,
	createAuthenticatedClient,
	createEventFixture,
	listEventSchemas,
	requireEventSchemaBySlug,
	waitForEventWithSchema,
} from "~/fixtures/kernel";
import {
	findMediaEntitySchema,
	insertLibraryMembership,
	seedGlobalBookWithSeries,
} from "~/fixtures/plugins/media";
import { mediaPluginFrame } from "~/fixtures/plugins/media/frame";
import { seedGlobalMediaGenres } from "~/fixtures/plugins/media/genres";
import { requirePresent } from "~/support/assertions";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getApiUrl, getFrontendUrl } from "~/support/harness-target";

const BOOK_COVER = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="60"><rect width="40" height="60" fill="#0f766e"/></svg>`;

const SIBLING_COVER = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="60"><rect width="40" height="60" fill="#be123c"/></svg>`;

const bookEventSchemas = (client: Client) =>
	Effect.gen(function* () {
		const { schema } = yield* findMediaEntitySchema(client, "book");
		const eventSchemas = yield* listEventSchemas(client, schema.reference);
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
		const cover = { type: "remote" as const, url: "https://images.test/book-cover.svg" };
		const siblingCover = { type: "remote" as const, url: "https://images.test/book-sibling.svg" };
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
				productionStatus: "Released",
				images: [{ ...cover, purpose: "cover" }],
				unlinkedCreators: [
					{ role: "Author", name: unlinkedAuthor },
					{ role: "Publisher", name: unlinkedPublisher },
				],
				description:
					"A **deterministic** browser tracer book.\n\nAn *expanded* second paragraph.\n\n:::spoiler\nHidden browser story detail.\n:::",
			},
		});
		yield* seedGlobalMediaGenres({
			entityId: seeded.book.id,
			entitySchemaSlug: "book",
			names: ["Science Fiction"],
		});
		yield* insertLibraryMembership(client, { mediaEntityId: seeded.book.id });
		const events = yield* bookEventSchemas(client);
		yield* createEventFixture(client, {
			entityId: seeded.book.id,
			eventSchemaSlug: events.complete,
			properties: { dateUnknown: true },
			occurredAt: "2026-07-01T10:00:00.000Z",
		});
		yield* createEventFixture(client, {
			entityId: seeded.book.id,
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
					route.fulfill({ body: BOOK_COVER, contentType: "image/svg+xml" }),
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
		yield* page.goto(`${frontendUrl}/e/${seeded.book.id}`);
		const frame = mediaPluginFrame(page);
		yield* frame.waitFor({ state: "visible" });
		const media = frame.contentFrame();
		yield* media
			.getByRole("heading", { level: 1, exact: true, name: bookName })
			.waitFor({ state: "visible", timeout: 150_000 });

		const body = media.locator("body");
		expect(yield* body.getByText("Hidden browser story detail.", { exact: true }).count).toBe(0);
		yield* body.getByRole("button", { exact: true, name: "More" }).click();
		expect(yield* body.locator("strong").getByText("deterministic", { exact: true }).count).toBe(1);
		expect(yield* body.locator("em").getByText("expanded", { exact: true }).count).toBe(1);
		const spoiler = body.getByText("Hidden browser story detail.", { exact: true });
		expect(yield* spoiler.count).toBe(1);
		yield* spoiler.waitFor({ state: "hidden" });
		yield* body.getByText("Show spoiler", { exact: true }).click();
		yield* spoiler.waitFor({ state: "visible" });
		yield* body.getByRole("button", { exact: true, name: "Less" }).click();
		expect(yield* body.getByText("Hidden browser story detail.", { exact: true }).count).toBe(0);
		yield* body
			.getByText("1997·320 pages·Hardcover", { exact: true })
			.waitFor({ state: "visible" });
		yield* body.getByText("Science Fiction", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Compilation", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("No", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Production status", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Released", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Hardcover rating", { exact: true }).waitFor({ state: "visible" });
		expect(yield* body.getByText("Runtime", { exact: true }).count).toBe(0);
		expect(yield* body.getByText("Length", { exact: true }).count).toBe(0);
		expect(yield* body.getByText("Seasons", { exact: true }).count).toBe(0);

		yield* body.getByText("Your status", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Complete", { exact: true }).first().waitFor({ state: "visible" });
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
		expect(siblingSrc).toBe(siblingCover.url);
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
	}).pipe(PlaywrightSpawner.withBrowser),
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
		yield* page.goto(
			`${frontendUrl}${savedViewPath({ kind: "plugin", slug: "all-books", packageId: mediaPlugin.metadata.packageId })}`,
		);
		const view = page.locator("iframe").contentFrame();
		const row = view.locator(`article[data-entity-id="${seeded.book.id}"]`);
		yield* row.waitFor({ state: "visible" });

		yield* row.getByText("2014", { exact: true }).waitFor({ state: "visible" });
		yield* row.getByText("320 pages", { exact: true }).waitFor({ state: "visible" });
		yield* row.getByText("In progress", { exact: true }).waitFor({ state: "visible" });
		yield* row.getByText("60% read", { exact: true }).waitFor({ state: "visible" });

		yield* view.getByRole("link", { exact: true, name: bookName }).click();
		yield* page.waitForURL(`${frontendUrl}/e/${seeded.book.id}`);
		yield* mediaPluginFrame(page)
			.contentFrame()
			.getByRole("heading", { level: 1, exact: true, name: bookName })
			.waitFor({ state: "visible", timeout: 150_000 });
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("logs Book progress from the empty Activity tab without a reload", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const frontendUrl = getFrontendUrl();
		const suffix = crypto.randomUUID();
		const bookName = `Logger Tracer Book ${suffix}`;
		const { email, client, password } = yield* createAuthenticatedClient(apiUrl);
		const seeded = yield* seedGlobalBookWithSeries(client, {
			bookName,
			seriesName: `Logger Tracer Series ${suffix}`,
			siblingName: `Logger Tracer Sequel ${suffix}`,
			bookProperties: { pages: 300, publishYear: 2012 },
		});
		const events = yield* bookEventSchemas(client);

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/e/${seeded.book.id}`);
		const media = mediaPluginFrame(page).contentFrame();
		yield* media
			.getByRole("heading", { level: 1, exact: true, name: bookName })
			.waitFor({ state: "visible", timeout: 150_000 });

		yield* media.getByRole("tab", { name: "Activity" }).click();
		yield* media.getByText("No activity yet", { exact: true }).waitFor({ state: "visible" });
		yield* media
			.getByRole("tabpanel", { name: "Activity" })
			.getByRole("button", { exact: true, name: "Log activity" })
			.click();
		const dialog = media.getByRole("dialog", { name: "Log activity" });
		yield* dialog.waitFor({ state: "visible" });
		yield* dialog
			.getByRole("radiogroup", { name: "What happened" })
			.getByRole("radio", { name: "Progress" })
			.click();
		yield* dialog.getByRole("radio", { name: "Set amount" }).click();
		yield* dialog.getByLabel("Percent").fill("40");
		yield* dialog.getByRole("button", { exact: true, name: "Save progress" }).click();
		yield* dialog
			.getByText("Progress saved at 40%.", { exact: true })
			.waitFor({ state: "visible" });
		yield* dialog.getByRole("button", { exact: true, name: "Done" }).click();
		yield* dialog.waitFor({ state: "hidden" });

		const progress = yield* waitForEventWithSchema(client, seeded.book.id, events.progress);
		expect(progress.properties.progressPercent).toBe(40);

		const body = media.locator("body");
		yield* body.getByText("40%", { exact: false }).first().waitFor({ state: "visible" });
		expect(yield* body.getByText("No activity yet", { exact: true }).count).toBe(0);
	}).pipe(PlaywrightSpawner.withBrowser),
);
