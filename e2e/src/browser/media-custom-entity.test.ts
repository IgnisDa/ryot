import { savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import { mediaPlugin } from "@ryot-app/media-plugin";
import { Effect, Fiber, Option, Stream } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient, createEntity, getEntity } from "~/fixtures/kernel";
import { findMediaEntitySchema } from "~/fixtures/plugins/media";
import { mediaPluginFrame } from "~/fixtures/plugins/media/frame";
import { requireString } from "~/support/assertions";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const PIXEL_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
	"base64",
);

it.live("creates a custom movie from the saved view's Create custom handoff", () =>
	Effect.gen(function* () {
		const { email, password } = yield* createAuthenticatedClient();
		const movieName = `Custom movie ${crypto.randomUUID()}`;
		const page = yield* (yield* Playwright.Browser).newPage({
			viewport: { width: 1280, height: 900 },
		});
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(
			`${getFrontendUrl()}${savedViewPath({ kind: "plugin", slug: "all-movies", packageId: mediaPlugin.metadata.packageId })}`,
		);
		yield* page
			.locator("iframe")
			.contentFrame()
			.getByRole("button", { name: "Add", exact: true })
			.click();
		const provider = page.getByRole("dialog", { exact: true, name: "Add from a provider" });
		yield* provider.getByLabel("Search providers").fill(movieName);
		yield* provider.getByRole("button", { exact: true, name: "Create custom" }).click();

		const editor = mediaPluginFrame(page, { visible: true }).contentFrame();
		const form = editor.getByRole("form", { exact: true, name: "New Movie" });
		const name = form.getByLabel("Name", { exact: true });
		yield* name.waitFor({ state: "visible" });
		expect(yield* name.inputValue()).toBe(movieName);
		yield* form.getByRole("button", { exact: true, name: "Save" }).click();

		yield* page.waitForURL((url) => url.pathname.startsWith("/e/"));
		yield* mediaPluginFrame(page, { visible: true })
			.contentFrame()
			.getByRole("heading", { level: 1, exact: true, name: movieName })
			.waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("creates a private genre inline and shows it on a custom movie", () =>
	Effect.gen(function* () {
		const { email, password } = yield* createAuthenticatedClient();
		const movieName = `Custom movie ${crypto.randomUUID()}`;
		const genreName = `Private genre ${crypto.randomUUID()}`;
		const page = yield* (yield* Playwright.Browser).newPage({
			viewport: { width: 1280, height: 900 },
		});
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(
			`${getFrontendUrl()}${savedViewPath({ kind: "plugin", slug: "all-movies", packageId: mediaPlugin.metadata.packageId })}`,
		);
		const browser = page.locator("iframe").contentFrame();
		yield* browser.getByRole("button", { name: "Add", exact: true }).click();
		const provider = page.getByRole("dialog", { exact: true, name: "Add from a provider" });
		yield* provider.getByLabel("Search providers").fill(movieName);
		yield* provider.getByRole("button", { exact: true, name: "Create custom" }).click();

		const editor = mediaPluginFrame(page, { visible: true }).contentFrame();
		const form = editor.getByRole("form", { exact: true, name: "New Movie" });
		const name = form.getByLabel("Name", { exact: true });
		yield* name.waitFor({ state: "visible" });
		expect(yield* name.inputValue()).toBe(movieName);
		yield* form.getByRole("button", { exact: true, name: "Add Genres" }).click();

		const picker = page.getByRole("dialog", { exact: true, name: "Choose Genre" });
		yield* picker.getByLabel("Search", { exact: true }).fill(genreName);
		yield* picker.getByRole("button", { exact: true, name: `Create "${genreName}"` }).click();
		const inlineGenre = page.getByRole("form", { exact: true, name: "New Genre" });
		expect(yield* inlineGenre.getByLabel("Name", { exact: true }).inputValue()).toBe(genreName);
		yield* inlineGenre.getByRole("button", { exact: true, name: "Create" }).click();
		yield* form.getByText(genreName, { exact: true }).waitFor({ state: "visible" });
		yield* form.getByRole("button", { exact: true, name: "Save" }).click();

		yield* page.waitForURL((url) => url.pathname.startsWith("/e/"));
		const detail = mediaPluginFrame(page, { visible: true }).contentFrame();
		yield* detail
			.getByRole("heading", { level: 1, exact: true, name: movieName })
			.waitFor({ state: "visible" });
		yield* detail
			.locator("body")
			.getByText(genreName, { exact: true })
			.waitFor({ state: "visible" });
		yield* detail.getByRole("button", { exact: true, name: "Edit" }).click();
		const editForm = mediaPluginFrame(page, { visible: true })
			.contentFrame()
			.getByRole("form", { exact: true, name: "Edit Movie" });
		yield* editForm.getByText(genreName, { exact: true }).waitFor({ state: "visible" });
		yield* editForm.getByLabel("Name", { exact: true }).fill(`${movieName} edited`);
		yield* editForm.getByRole("button", { exact: true, name: "Save" }).click();
		yield* page.waitForURL((url) => url.pathname.startsWith("/e/"));
		const editedDetail = mediaPluginFrame(page, { visible: true }).contentFrame();
		yield* editedDetail
			.getByRole("heading", { level: 1, exact: true, name: `${movieName} edited` })
			.waitFor({ state: "visible" });
		yield* editedDetail.getByText(genreName, { exact: true }).waitFor({ state: "visible" });
		yield* editedDetail.getByRole("button", { exact: true, name: "Edit" }).click();
		const clearForm = mediaPluginFrame(page, { visible: true })
			.contentFrame()
			.getByRole("form", { exact: true, name: "Edit Movie" });
		yield* clearForm
			.getByRole("button", { exact: true, name: `Remove ${genreName} from Genres` })
			.click();
		yield* clearForm.getByRole("button", { exact: true, name: "Save" }).click();
		yield* page.waitForURL((url) => url.pathname.startsWith("/e/"));
		const clearedDetail = mediaPluginFrame(page, { visible: true }).contentFrame();
		yield* clearedDetail
			.getByRole("heading", { level: 1, exact: true, name: `${movieName} edited` })
			.waitFor({ state: "visible" });
		yield* clearedDetail.getByText(genreName, { exact: true }).waitFor({ state: "hidden" });
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("creates and edits a custom show without losing nested fields or image metadata", () =>
	Effect.gen(function* () {
		const showName = `Custom show ${crypto.randomUUID()}`;
		const { email, client, password } = yield* createAuthenticatedClient();
		const page = yield* (yield* Playwright.Browser).newPage({
			viewport: { width: 1280, height: 900 },
		});
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(
			`${getFrontendUrl()}${savedViewPath({ kind: "plugin", slug: "all-shows", packageId: mediaPlugin.metadata.packageId })}`,
		);
		yield* page
			.locator("iframe")
			.contentFrame()
			.getByRole("button", { exact: true, name: "Add" })
			.click();
		const provider = page.getByRole("dialog", { exact: true, name: "Add from a provider" });
		yield* provider.getByLabel("Search providers").fill(showName);
		yield* provider.getByRole("button", { exact: true, name: "Create custom" }).click();

		const editor = mediaPluginFrame(page, { visible: true }).contentFrame();
		const form = editor.getByRole("form", { exact: true, name: "New Show" });
		const name = form.getByLabel("Name", { exact: true });
		yield* name.waitFor({ state: "visible" });
		expect(yield* name.inputValue()).toBe(showName);

		yield* form.getByRole("button", { exact: true, name: "Add Watch providers item" }).click();
		const watchProvider = form.getByRole("group", { exact: true, name: "Watch providers item 1" });
		yield* watchProvider.getByLabel("Country", { exact: true }).fill("US");
		yield* watchProvider.getByRole("button", { exact: true, name: "Add Providers item" }).click();
		const watchProviderItem = watchProvider.getByRole("group", {
			exact: true,
			name: "Providers item 1",
		});
		yield* watchProviderItem.getByLabel("Name", { exact: true }).fill("Offline streaming");
		yield* watchProviderItem.getByRole("button", { exact: true, name: "Offers" }).click();
		yield* editor.getByRole("checkbox", { exact: true, name: "stream" }).click();
		yield* editor
			.getByRole("dialog", { exact: true, name: "Offers" })
			.getByRole("button", { exact: true, name: "Close options" })
			.click();

		yield* form.getByRole("button", { exact: true, name: "Add Episode orders item" }).click();
		const episodeOrder = form.getByRole("group", { exact: true, name: "Episode orders item 1" });
		yield* episodeOrder.getByLabel("Name", { exact: true }).fill("DVD order");
		yield* episodeOrder.getByLabel("External ID", { exact: true }).fill("custom-dvd");
		yield* episodeOrder.getByRole("radio", { exact: true, name: "dvd" }).click();
		yield* episodeOrder.getByRole("button", { exact: true, name: "Add Groups item" }).click();
		const group = episodeOrder.getByRole("group", { exact: true, name: "Groups item 1" });
		yield* group.getByLabel("Name", { exact: true }).fill("Season 1");
		yield* group.getByLabel("Order", { exact: true }).fill("1");
		yield* group
			.getByRole("button", { exact: true, name: "Add Episode external IDs item" })
			.click();
		yield* group.getByLabel("Episode external IDs item 1", { exact: true }).fill("episode-1");

		const chooser = yield* page
			.eventStream("filechooser")
			.pipe(Stream.runHead, Effect.forkChild({ startImmediately: true }));
		yield* form.getByRole("button", { exact: true, name: "Add Images" }).click();
		const picked = Option.getOrThrow(yield* Fiber.join(chooser));
		yield* picked.setFiles({ name: "photo.png", buffer: PIXEL_PNG, mimeType: "image/png" });
		yield* form
			.getByRole("button", { exact: true, name: "Remove Images 1" })
			.waitFor({ state: "visible" });
		yield* form.getByRole("radio", { exact: true, name: "cover" }).click();
		yield* form.getByRole("button", { exact: true, name: "Save" }).click();

		yield* page.waitForURL((url) => url.pathname.startsWith("/e/"));
		const entityId = requireString(
			new URL(page.url()).pathname.split("/").at(-1),
			"Entity ID is missing from the URL",
		);
		yield* mediaPluginFrame(page, { visible: true })
			.contentFrame()
			.getByRole("heading", { level: 1, exact: true, name: showName })
			.waitFor({ state: "visible" });

		expect((yield* getEntity(client, entityId)).properties).toMatchObject({
			images: [{ purpose: "cover" }],
			watchProviders: [
				{ country: "US", providers: [{ offers: ["stream"], name: "Offline streaming" }] },
			],
			episodeOrders: [
				{
					type: "dvd",
					name: "DVD order",
					externalId: "custom-dvd",
					groups: [{ order: 1, name: "Season 1", episodeExternalIds: ["episode-1"] }],
				},
			],
		});
		const original = yield* getEntity(client, entityId);
		const detail = mediaPluginFrame(page, { visible: true }).contentFrame();
		yield* detail.getByRole("button", { exact: true, name: "Edit" }).click();
		const editForm = mediaPluginFrame(page, { visible: true })
			.contentFrame()
			.getByRole("form", { exact: true, name: "Edit Show" });
		const editName = editForm.getByLabel("Name", { exact: true }).first();
		expect(yield* editName.inputValue()).toBe(showName);
		yield* editName.fill(`${showName} edited`);
		yield* editForm.getByRole("button", { exact: true, name: "Save" }).click();
		yield* page.waitForURL((url) => url.pathname === `/e/${entityId}`);
		yield* mediaPluginFrame(page, { visible: true })
			.contentFrame()
			.getByRole("heading", { level: 1, exact: true, name: `${showName} edited` })
			.waitFor({ state: "visible" });
		expect((yield* getEntity(client, entityId)).properties).toEqual(original.properties);

		yield* mediaPluginFrame(page, { visible: true })
			.contentFrame()
			.getByRole("button", { exact: true, name: "Edit" })
			.click();
		const datedForm = mediaPluginFrame(page, { visible: true })
			.contentFrame()
			.getByRole("form", { exact: true, name: "Edit Show" });
		yield* datedForm.getByLabel("Publish date", { exact: true }).fill("2026-10-26");
		yield* datedForm.getByRole("button", { exact: true, name: "Save" }).click();
		yield* page.waitForURL((url) => url.pathname === `/e/${entityId}`);
		expect((yield* getEntity(client, entityId)).properties).toEqual({
			...original.properties,
			publishYear: 2026,
			publishDate: "2026-10-26",
		});
	}).pipe(PlaywrightSpawner.withBrowser),
);

for (const [slug, label] of [
	["person", "Person"],
	["company", "Company"],
	["movie-group", "Movie Collection"],
] as const) {
	it.live(`edits an owned custom ${slug} and preserves its properties`, () =>
		Effect.gen(function* () {
			const { email, client, password } = yield* createAuthenticatedClient();
			const { schema } = yield* findMediaEntitySchema(client, slug);
			const name = `Custom ${slug} ${crypto.randomUUID()}`;
			const entity = yield* createEntity(client, {
				name,
				entitySchema: schema.reference,
				properties: { description: "Keep this description" },
			});
			const page = yield* (yield* Playwright.Browser).newPage({
				viewport: { width: 1280, height: 900 },
			});
			yield* signInThroughHostedOAuth(page, email, password);
			yield* page.goto(`${getFrontendUrl()}/e/${entity.id}`);
			yield* mediaPluginFrame(page, { visible: true })
				.contentFrame()
				.getByRole("button", { exact: true, name: "Edit" })
				.click();
			const form = mediaPluginFrame(page, { visible: true })
				.contentFrame()
				.getByRole("form", { exact: true, name: `Edit ${label}` });
			yield* form.getByLabel("Name", { exact: true }).fill(`${name} edited`);
			yield* form.getByRole("button", { exact: true, name: "Save" }).click();
			yield* page.waitForURL((url) => url.pathname === `/e/${entity.id}`);
			yield* mediaPluginFrame(page, { visible: true })
				.contentFrame()
				.getByRole("heading", { level: 1, exact: true, name: `${name} edited` })
				.waitFor({ state: "visible" });
			expect((yield* getEntity(client, entity.id)).properties).toEqual(entity.properties);
		}).pipe(PlaywrightSpawner.withBrowser),
	);
}

it.live("authors, tracks, and protects custom seasons and episodes from the Episodes tab", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const { schema } = yield* findMediaEntitySchema(client, "show");
		const showName = `Custom show ${crypto.randomUUID()}`;
		const show = yield* createEntity(client, {
			name: showName,
			properties: {},
			entitySchema: schema.reference,
		});
		const page = yield* (yield* Playwright.Browser).newPage({
			viewport: { width: 1280, height: 900 },
		});
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/e/${show.id}`);
		const media = () => mediaPluginFrame(page, { visible: true }).contentFrame();

		yield* media().getByRole("tab", { name: "Episodes" }).click();
		yield* media().getByRole("button", { exact: true, name: "Add season" }).click();
		const seasonForm = media().getByRole("form", { exact: true, name: "New Show Season" });
		yield* seasonForm.getByText(showName, { exact: true }).waitFor({ state: "visible" });
		expect(yield* seasonForm.getByLabel("Season number", { exact: true }).inputValue()).toBe("1");
		expect(
			yield* seasonForm.getByRole("button", { name: `Remove ${showName} from Show to Show Season` })
				.count,
		).toBe(0);
		yield* seasonForm.getByLabel("Name", { exact: true }).fill("First season");
		yield* seasonForm.getByRole("button", { exact: true, name: "Save" }).click();
		yield* page.waitForURL((url) => url.pathname === `/e/${show.id}`);

		yield* media().getByRole("tab", { name: "Episodes" }).click();
		yield* media().getByRole("button", { exact: true, name: "Add episode" }).click();
		const episodeForm = media().getByRole("form", { exact: true, name: "New Show Episode" });
		yield* episodeForm.getByText("First season", { exact: true }).waitFor({ state: "visible" });
		expect(yield* episodeForm.getByLabel("Season number", { exact: true }).inputValue()).toBe("1");
		expect(yield* episodeForm.getByLabel("Episode number", { exact: true }).inputValue()).toBe("1");
		yield* episodeForm.getByLabel("Name", { exact: true }).fill("Pilot");
		yield* episodeForm.getByRole("button", { exact: true, name: "Save" }).click();
		yield* page.waitForURL((url) => url.pathname === `/e/${show.id}`);

		yield* media().getByRole("tab", { name: "Episodes" }).click();
		yield* media().getByRole("button", { exact: true, name: "Open Pilot" }).click();
		const details = media().getByRole("dialog", { name: "Pilot" });
		yield* details.getByRole("button", { exact: true, name: "Mark watched" }).click();
		yield* details.getByText("Watched", { exact: true }).waitFor({ state: "visible" });
		yield* details.getByRole("button", { exact: true, name: "Edit episode" }).click();

		const editForm = media().getByRole("form", { exact: true, name: "Edit Show Episode" });
		yield* editForm.getByRole("button", { exact: true, name: "Delete" }).click();
		const confirmation = media().getByRole("dialog", { name: "Delete this show episode?" });
		yield* confirmation.getByRole("button", { exact: true, name: "Delete" }).click();
		yield* confirmation.getByRole("alert").waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);
