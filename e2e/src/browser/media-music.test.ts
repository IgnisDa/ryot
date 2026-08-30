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
import { insertLibraryMembership, seedGlobalMusicWithAlbum } from "~/fixtures/plugins/media";
import { requirePresent } from "~/support/assertions";
import { browserLayer, signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getApiUrl, getFrontendUrl } from "~/support/harness-target";

const TRACK_COVER = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="#7c3aed"/></svg>`;

const SIBLING_COVER = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#ea580c"/></svg>`;

const uploadPermanentAsset = (apiUrl: string, client: Client, body: string) =>
	Effect.gen(function* () {
		const intent = yield* client.call((c) =>
			c.uploads.createIntent({
				payload: { kind: "permanent", fileName: "music-art.svg", contentType: "image/svg+xml" },
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

const musicEventSchemas = (client: Client) =>
	Effect.gen(function* () {
		const { schema } = yield* findBuiltinSchemaBySlug(client, "music");
		const eventSchemas = yield* listEventSchemas(client, schema.id);
		return {
			progress: requireEventSchemaBySlug(eventSchemas, "progress").id,
			complete: requireEventSchemaBySlug(eventSchemas, "complete").id,
		};
	});

const sectionTitles = (media: Playwright.FrameLocator) =>
	media.locator("section > div > div > h2").allTextContents();

it.live("renders a populated Music detail with its album rail and no watch providers", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const frontendUrl = getFrontendUrl();
		const suffix = crypto.randomUUID();
		const trackName = `Browser Tracer Track ${suffix}`;
		const siblingName = `Browser Tracer B Side ${suffix}`;
		const albumName = `Browser Tracer Album ${suffix}`;
		const { email, client, password } = yield* createAuthenticatedClient(apiUrl);
		const cover = yield* uploadPermanentAsset(apiUrl, client, TRACK_COVER);
		const siblingCover = yield* uploadPermanentAsset(apiUrl, client, SIBLING_COVER);
		const seeded = yield* seedGlobalMusicWithAlbum(client, {
			albumName,
			trackName,
			siblingName,
			withCredits: true,
			siblingProperties: { images: [{ ...siblingCover, purpose: "cover" }] },
			trackProperties: {
				duration: 222,
				publishYear: 1997,
				providerRating: 92.5,
				byVariousArtists: false,
				productionStatus: "Released",
				genres: ["Alternative Rock"],
				images: [{ ...cover, purpose: "cover" }],
				description: "A deterministic browser tracer track.",
			},
		});
		yield* insertLibraryMembership(client, { mediaEntityId: seeded.track.id });
		const events = yield* musicEventSchemas(client);
		yield* createEventFixture(client, {
			entityId: seeded.track.id,
			eventSchemaSlug: events.complete,
			occurredAt: "2026-07-01T10:00:00.000Z",
			properties: { completionMode: "unknown" },
		});
		yield* createEventFixture(client, {
			entityId: seeded.track.id,
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
		yield* page.goto(`${frontendUrl}/e/${seeded.track.id}`);
		const frame = page.locator('iframe[title="media plugin"]');
		yield* frame.waitFor({ state: "visible" });
		const media = frame.contentFrame();
		yield* media
			.getByRole("heading", { level: 1, exact: true, name: trackName })
			.waitFor({ state: "visible", timeout: 150_000 });

		const body = media.locator("body");
		yield* body
			.getByText("Music • MusicBrainz • 1997", { exact: true })
			.waitFor({ state: "visible" });
		yield* body.getByText("Alternative Rock", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("3:42", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Length", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Various artists", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Released", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("MusicBrainz rating", { exact: true }).waitFor({ state: "visible" });
		expect(yield* body.getByText("Runtime", { exact: true }).count).toBe(0);
		expect(yield* body.getByText("Seasons", { exact: true }).count).toBe(0);
		expect(yield* body.getByText("Episodes", { exact: true }).count).toBe(0);

		yield* body.getByText("Your status", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Complete", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("In library", { exact: true }).waitFor({ state: "visible" });

		expect(yield* media.getByRole("tab").allTextContents()).toEqual(["Overview", "Activity"]);

		yield* media
			.getByRole("heading", { level: 2, name: `Part of ${albumName}` })
			.waitFor({ state: "visible" });
		expect(yield* sectionTitles(media)).toEqual([
			"Images",
			"Artists & credits",
			"Labels",
			"More like this",
			`Part of ${albumName}`,
		]);
		expect(yield* body.getByText("Where to watch", { exact: true }).count).toBe(0);
		expect(yield* body.getByText("JustWatch", { exact: false }).count).toBe(0);

		const siblingLink = media.getByRole("link", { name: `Open ${siblingName}` });
		yield* siblingLink.waitFor({ state: "visible" });
		const siblingArt = siblingLink.locator("img");
		yield* siblingArt.waitFor({ state: "visible" });
		const siblingSrc = requirePresent(
			yield* siblingArt.getAttribute("src"),
			"Missing album sibling artwork",
		);
		expect(siblingSrc).toContain(siblingCover.key);
		expect(yield* media.getByRole("link", { name: `Open ${trackName}` }).count).toBe(0);

		yield* media.getByRole("tab", { name: "Activity" }).click();
		const record = media.getByRole("list", { name: "Listen record" });
		yield* record.waitFor({ state: "visible" });
		expect(yield* record.getByText("Finished the track", { exact: true }).count).toBe(2);
		expect(yield* body.getByText("Coverage", { exact: true }).count).toBe(0);
		expect(yield* body.getByText("Listens", { exact: true }).count).toBe(1);
		expect(yield* body.getByText("Watches", { exact: true }).count).toBe(0);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("renders the Music presentation facts in the canonical saved view", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const frontendUrl = getFrontendUrl();
		const suffix = crypto.randomUUID();
		const trackName = `Row Tracer Track ${suffix}`;
		const { email, client, password } = yield* createAuthenticatedClient(apiUrl);
		const seeded = yield* seedGlobalMusicWithAlbum(client, {
			trackName,
			albumName: `Row Tracer Album ${suffix}`,
			siblingName: `Row Tracer B Side ${suffix}`,
			trackProperties: { duration: 3735, publishYear: 2014 },
		});
		const events = yield* musicEventSchemas(client);
		yield* createEventFixture(client, {
			entityId: seeded.track.id,
			eventSchemaSlug: events.progress,
			properties: { progressPercent: 60 },
			occurredAt: "2026-07-03T10:00:00.000Z",
		});

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/v/all-music`);
		const view = page.locator("iframe").contentFrame();
		const row = view.locator(`article[data-entity-id="${seeded.track.id}"]`);
		yield* row.waitFor({ state: "visible" });

		yield* row.getByText("2014", { exact: true }).waitFor({ state: "visible" });
		yield* row.getByText("1:02:15", { exact: true }).waitFor({ state: "visible" });
		yield* row.getByText("In progress", { exact: true }).waitFor({ state: "visible" });
		yield* row.getByText("60% listened", { exact: true }).waitFor({ state: "visible" });

		yield* view.getByRole("link", { exact: true, name: trackName }).click();
		yield* page.waitForURL(`${frontendUrl}/e/${seeded.track.id}`);
		yield* page
			.locator('iframe[title="media plugin"]')
			.contentFrame()
			.getByRole("heading", { level: 1, exact: true, name: trackName })
			.waitFor({ state: "visible", timeout: 150_000 });
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);
