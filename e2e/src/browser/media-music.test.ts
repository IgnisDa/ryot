import { savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import { mediaPlugin } from "@ryot-app/media-plugin";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	createAuthenticatedClient,
	createEventFixture,
	listEventSchemas,
	requireEventSchemaBySlug,
	type Client,
} from "~/fixtures/kernel";
import {
	findMediaEntitySchema,
	insertLibraryMembership,
	seedGlobalMusicWithAlbum,
} from "~/fixtures/plugins/media";
import { seedGlobalMediaGenres } from "~/fixtures/plugins/media/genres";
import { requirePresent } from "~/support/assertions";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getApiUrl, getFrontendUrl } from "~/support/harness-target";

const TRACK_COVER = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="#7c3aed"/></svg>`;

const SIBLING_COVER = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#ea580c"/></svg>`;
const TRACK_COVER_URL = "https://artwork.example.test/music-track.svg";
const SIBLING_COVER_URL = "https://artwork.example.test/music-sibling.svg";

const musicEventSchemas = (client: Client) =>
	Effect.gen(function* () {
		const { schema } = yield* findMediaEntitySchema(client, "music");
		const eventSchemas = yield* listEventSchemas(client, schema.reference);
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
		const seeded = yield* seedGlobalMusicWithAlbum(client, {
			albumName,
			trackName,
			siblingName,
			withCredits: true,
			siblingProperties: { images: [{ type: "remote", purpose: "cover", url: SIBLING_COVER_URL }] },
			trackProperties: {
				duration: 222,
				publishYear: 1997,
				providerRating: 92.5,
				byVariousArtists: false,
				productionStatus: "Released",
				description: "A deterministic browser tracer track.",
				images: [{ type: "remote", purpose: "cover", url: TRACK_COVER_URL }],
			},
		});
		yield* seedGlobalMediaGenres({
			entityId: seeded.track.id,
			entitySchemaSlug: "music",
			names: ["Alternative Rock"],
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
		yield* Effect.forEach(
			[
				{ body: TRACK_COVER, url: TRACK_COVER_URL },
				{ body: SIBLING_COVER, url: SIBLING_COVER_URL },
			],
			({ url, body }) =>
				page.use((raw) =>
					raw.route(url, (route) =>
						route.fulfill({
							body,
							contentType: "image/svg+xml",
							headers: { "access-control-allow-origin": "*" },
						}),
					),
				),
			{ discard: true },
		);
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/e/${seeded.track.id}`);
		const frame = page.locator('iframe[title="Media plugin"]');
		yield* frame.waitFor({ state: "visible" });
		const media = frame.contentFrame();
		yield* media
			.getByRole("heading", { level: 1, exact: true, name: trackName })
			.waitFor({ state: "visible", timeout: 150_000 });

		const body = media.locator("body");
		yield* body.getByText("1997·3:42·MusicBrainz", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Alternative Rock", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Various artists", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Released", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("MusicBrainz rating", { exact: true }).waitFor({ state: "visible" });
		expect(yield* body.getByText("Runtime", { exact: true }).count).toBe(0);
		expect(yield* body.getByText("Seasons", { exact: true }).count).toBe(0);
		expect(yield* body.getByText("Episodes", { exact: true }).count).toBe(0);

		yield* body.getByText("Your status", { exact: true }).waitFor({ state: "visible" });
		yield* body.getByText("Complete", { exact: true }).first().waitFor({ state: "visible" });
		yield* body.getByText("In media library", { exact: true }).waitFor({ state: "visible" });

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
		expect(siblingSrc).toBe(SIBLING_COVER_URL);
		expect(yield* media.getByRole("link", { name: `Open ${trackName}` }).count).toBe(0);

		yield* media.getByRole("tab", { name: "Activity" }).click();
		const record = media.getByRole("list", { name: "Listen record" });
		yield* record.waitFor({ state: "visible" });
		expect(yield* record.getByText("Finished the track", { exact: true }).count).toBe(2);
		expect(yield* body.getByText("Coverage", { exact: true }).count).toBe(0);
		expect(yield* body.getByText("Listens", { exact: true }).count).toBe(1);
		expect(yield* body.getByText("Watches", { exact: true }).count).toBe(0);
	}).pipe(PlaywrightSpawner.withBrowser),
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
		yield* page.goto(
			`${frontendUrl}${savedViewPath({ kind: "plugin", slug: "all-music", packageId: mediaPlugin.metadata.packageId })}`,
		);
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
			.locator('iframe[title="Media plugin"]')
			.contentFrame()
			.getByRole("heading", { level: 1, exact: true, name: trackName })
			.waitFor({ state: "visible", timeout: 150_000 });
	}).pipe(PlaywrightSpawner.withBrowser),
);
