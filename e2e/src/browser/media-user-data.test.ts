import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { type Client, createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { getEntity } from "~/fixtures/kernel/entities";
import { createEventFixture } from "~/fixtures/kernel/entity-graph";
import { listEventSchemas, requireEventSchemaBySlug } from "~/fixtures/kernel/event-schemas";
import { listEventsForEntity } from "~/fixtures/kernel/events";
import { logMediaActivity } from "~/fixtures/plugins/media/activity-log";
import { findMediaEntitySchema } from "~/fixtures/plugins/media/entity-schemas";
import { mediaPluginFrame } from "~/fixtures/plugins/media/frame";
import { settledHistoryCorrection } from "~/fixtures/plugins/media/history-correction";
import {
	insertLibraryMembership,
	queryInMediaLibraryRelationship,
	seedGlobalMovieWithCollection,
	seedShow,
} from "~/fixtures/plugins/media/media";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";
import { nowIso } from "~/support/time";

const mediaLibraryRows = (client: Client, entityId: string, schemaSlug: string) =>
	Effect.map(queryInMediaLibraryRelationship(client, entityId, schemaSlug), (result) =>
		result.data.entity?.type === "rows" ? result.data.entity.items : [],
	);

const clickYourDataAction = (
	media: Playwright.FrameLocator,
	action: "Merge my data into…" | "Remove from library",
) =>
	Effect.gen(function* () {
		yield* media.getByRole("button", { exact: true, name: "Your data" }).click();
		yield* media.getByRole("menuitem", { exact: true, name: action }).click();
	});

const seedMovieWithUserData = (
	client: Client,
	input: { readonly name: string; readonly rating: number; readonly description: string },
) =>
	Effect.gen(function* () {
		const seeded = yield* seedGlobalMovieWithCollection(client, {
			movieName: input.name,
			siblingName: `Related movie ${crypto.randomUUID()}`,
			collectionName: `Movie collection ${crypto.randomUUID()}`,
			movieProperties: { runtime: 101, publishYear: 2020, description: input.description },
		});
		const { schema } = yield* findMediaEntitySchema(client, "movie");
		const eventSchemas = yield* listEventSchemas(client, schema.reference);
		yield* createEventFixture(client, {
			entityId: seeded.movie.id,
			properties: { timeSpent: 100 },
			occurredAt: "2026-04-01T10:00:00.000Z",
			eventSchemaSlug: requireEventSchemaBySlug(eventSchemas, "complete").id,
		});
		yield* createEventFixture(client, {
			entityId: seeded.movie.id,
			occurredAt: "2026-04-02T10:00:00.000Z",
			eventSchemaSlug: requireEventSchemaBySlug(eventSchemas, "review").id,
			properties: { rating: input.rating, text: "Browser user-data review" },
		});
		yield* insertLibraryMembership(client, {
			properties: { owned: true },
			mediaEntityId: seeded.movie.id,
		});
		return { movie: seeded.movie, schemaSlug: schema.id };
	});

it.live("cancels then confirms media-data removal while preserving metadata", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const name = `User data Movie ${crypto.randomUUID()}`;
		const seeded = yield* seedMovieWithUserData(client, {
			name,
			rating: 83,
			description: "Movie metadata remains after user data is removed.",
		});
		const originalEvents = yield* listEventsForEntity(client, seeded.movie.id, undefined, 100);
		const page = yield* (yield* Playwright.Browser).newPage({
			viewport: { width: 1280, height: 900 },
		});
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/e/${seeded.movie.id}`);
		const media = mediaPluginFrame(page).contentFrame();
		yield* media
			.getByRole("heading", { name, level: 1, exact: true })
			.waitFor({ state: "visible" });
		yield* media.getByRole("tab", { exact: true, name: "Activity" }).click();
		yield* media.getByText("Finished the movie", { exact: true }).waitFor({ state: "visible" });
		yield* media.getByText("83 / 100", { exact: true }).waitFor({ state: "visible" });

		yield* clickYourDataAction(media, "Remove from library");
		const cancelled = media.getByRole("dialog", { exact: true, name: "Remove your media data?" });
		yield* cancelled.getByRole("button", { exact: true, name: "Cancel" }).click();
		yield* cancelled.waitFor({ state: "hidden" });
		expect(yield* listEventsForEntity(client, seeded.movie.id, undefined, 100)).toEqual(
			originalEvents,
		);
		expect(yield* mediaLibraryRows(client, seeded.movie.id, seeded.schemaSlug)).toHaveLength(1);

		yield* clickYourDataAction(media, "Remove from library");
		const confirmation = media.getByRole("dialog", {
			exact: true,
			name: "Remove your media data?",
		});
		yield* confirmation.getByRole("button", { exact: true, name: "Remove data" }).click();
		yield* confirmation.waitFor({ state: "hidden" });
		yield* media.getByText("Finished the movie", { exact: true }).waitFor({ state: "hidden" });
		yield* media.getByText("83 / 100", { exact: true }).waitFor({ state: "hidden" });
		expect(yield* listEventsForEntity(client, seeded.movie.id, undefined, 100)).toEqual([]);
		expect(yield* mediaLibraryRows(client, seeded.movie.id, seeded.schemaSlug)).toEqual([]);
		expect((yield* getEntity(client, seeded.movie.id)).properties).toMatchObject({
			publishYear: 2020,
			description: "Movie metadata remains after user data is removed.",
		});
		yield* media.getByRole("tab", { exact: true, name: "Overview" }).click();
		yield* media.getByText("Not in your library", { exact: true }).waitFor({ state: "visible" });
		yield* media
			.getByText("Movie metadata remains after user data is removed.", { exact: true })
			.waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("merges data through the same-schema entity picker and opens the destination", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const suffix = crypto.randomUUID();
		const source = yield* seedMovieWithUserData(client, {
			rating: 91,
			name: `User data source ${suffix}`,
			description: "Source metadata is unchanged.",
		});
		const target = yield* seedGlobalMovieWithCollection(client, {
			siblingName: `Target sequel ${suffix}`,
			movieName: `User data target ${suffix}`,
			collectionName: `Target collection ${suffix}`,
			movieProperties: { publishYear: 2021, description: "Target metadata is unchanged." },
		});
		const sourceEvents = yield* listEventsForEntity(client, source.movie.id, undefined, 100);
		const page = yield* (yield* Playwright.Browser).newPage({
			viewport: { width: 1280, height: 900 },
		});
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/e/${source.movie.id}`);
		const media = mediaPluginFrame(page).contentFrame();
		yield* media
			.getByRole("heading", { level: 1, exact: true, name: source.movie.name })
			.waitFor({ state: "visible" });
		yield* clickYourDataAction(media, "Merge my data into…");
		const picker = page.getByRole("dialog", { exact: true, name: "Choose Movie" });
		yield* picker.getByLabel("Search", { exact: true }).fill(target.movie.name);
		yield* picker.getByRole("button", { exact: true, name: target.movie.name }).click();
		const confirmation = media.getByRole("dialog", { exact: true, name: "Merge your media data?" });
		yield* confirmation.getByRole("button", { exact: true, name: "Merge data" }).click();
		yield* page.waitForURL(`${getFrontendUrl()}/e/${target.movie.id}`);
		const targetMedia = mediaPluginFrame(page).contentFrame();
		yield* targetMedia
			.getByRole("heading", { level: 1, exact: true, name: target.movie.name })
			.waitFor({ state: "visible" });
		expect(yield* listEventsForEntity(client, source.movie.id, undefined, 100)).toEqual([]);
		const targetEvents = yield* listEventsForEntity(client, target.movie.id, undefined, 100);
		for (const event of sourceEvents) {
			expect(targetEvents.find(({ id }) => id === event.id)).toMatchObject({
				occurredAt: event.occurredAt,
				properties: event.properties,
			});
		}
		expect(yield* mediaLibraryRows(client, source.movie.id, source.schemaSlug)).toEqual([]);
		expect(yield* mediaLibraryRows(client, target.movie.id, source.schemaSlug)).toHaveLength(1);
		expect((yield* getEntity(client, source.movie.id)).properties).toMatchObject({
			description: "Source metadata is unchanged.",
		});
		expect((yield* getEntity(client, target.movie.id)).properties).toMatchObject({
			description: "Target metadata is unchanged.",
		});
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("keeps an episodic mapping conflict visible without changing either show", () =>
	Effect.gen(function* () {
		const { email, client, userId, password } = yield* createAuthenticatedClient();
		const suffix = crypto.randomUUID();
		const source = yield* seedShow(client, {
			inLibrary: false,
			name: `Episodic source ${suffix}`,
			properties: { productionStatus: "Ended" },
			seasons: [{ seasonNumber: 1, episodes: [{ episodeNumber: 1 }, { episodeNumber: 2 }] }],
		});
		const target = yield* seedShow(client, {
			inLibrary: false,
			name: `Episodic target ${suffix}`,
			properties: { productionStatus: "Ended" },
			seasons: [{ seasonNumber: 1, episodes: [{ episodeNumber: 1 }] }],
		});
		yield* insertLibraryMembership(client, {
			properties: { owned: true },
			mediaEntityId: source.show.id,
		});
		yield* insertLibraryMembership(client, {
			properties: { owned: true },
			mediaEntityId: source.episodeId(1, 2),
		});
		yield* logMediaActivity(client, {
			submittedAt: nowIso(),
			submissionId: crypto.randomUUID(),
			entry: {
				kind: "episodes",
				parentEntityId: source.show.id,
				episodeEntityIds: [source.episodeId(1, 2)],
				when: { kind: "date", finishedOn: "2026-04-03T10:00:00.000Z" },
			},
		});
		yield* settledHistoryCorrection(client, userId);
		const sourceEvents = yield* listEventsForEntity(client, source.episodeId(1, 2), undefined, 100);
		const sourceRootEvents = yield* listEventsForEntity(client, source.show.id, undefined, 100);
		const targetEvents = yield* listEventsForEntity(client, target.show.id, undefined, 100);
		const targetMembership = yield* mediaLibraryRows(client, target.show.id, "show");
		const page = yield* (yield* Playwright.Browser).newPage({
			viewport: { width: 1280, height: 900 },
		});
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/e/${source.show.id}`);
		const media = mediaPluginFrame(page).contentFrame();
		yield* media
			.getByRole("heading", { level: 1, exact: true, name: source.show.name })
			.waitFor({ state: "visible" });
		yield* clickYourDataAction(media, "Merge my data into…");
		const picker = page.getByRole("dialog", { exact: true, name: "Choose Show" });
		yield* picker.getByLabel("Search", { exact: true }).fill(target.show.name);
		yield* picker.getByRole("button", { exact: true, name: target.show.name }).click();
		const confirmation = media.getByRole("dialog", { exact: true, name: "Merge your media data?" });
		yield* confirmation.getByRole("button", { exact: true, name: "Merge data" }).click();
		yield* confirmation.getByRole("alert").waitFor({ state: "visible" });
		expect(
			yield* confirmation.getByRole("button", { exact: true, name: "Merge data" }).isEnabled(),
		).toBe(true);
		expect(page.url()).toBe(`${getFrontendUrl()}/e/${source.show.id}`);
		expect(yield* listEventsForEntity(client, source.episodeId(1, 2), undefined, 100)).toEqual(
			sourceEvents,
		);
		expect(yield* listEventsForEntity(client, source.show.id, undefined, 100)).toEqual(
			sourceRootEvents,
		);
		expect(yield* listEventsForEntity(client, target.show.id, undefined, 100)).toEqual(
			targetEvents,
		);
		expect(yield* mediaLibraryRows(client, source.show.id, "show")).toHaveLength(1);
		expect(yield* mediaLibraryRows(client, source.episodeId(1, 2), "show-episode")).toHaveLength(1);
		expect(yield* mediaLibraryRows(client, target.show.id, "show")).toEqual(targetMembership);
	}).pipe(PlaywrightSpawner.withBrowser),
);
