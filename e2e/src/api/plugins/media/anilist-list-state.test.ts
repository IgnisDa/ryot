import { EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { animeRecipes } from "@ryot-app/media-plugin/shared/anime-recipes";
import { flatByLifecycleStateRecipe } from "@ryot-app/media-plugin/shared/lifecycle-list-recipes";
import type { ListStateProperties } from "@ryot-app/media-plugin/shared/list-state";
import { listStateSnapshotsRecipe } from "@ryot-app/media-plugin/shared/list-state-recipes";
import { mangaRecipes } from "@ryot-app/media-plugin/shared/manga-recipes";
import { arrayContaining, objectContaining } from "@ryot-app/testing/matchers";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";

import {
	type Client,
	createAuthenticatedClient,
	createEventFixture,
	executeRyotQLRecipe,
	listEventSchemas,
	listEventsForEntity,
	requireEventSchemaBySlug,
} from "~/fixtures/kernel";
import {
	findMediaEntitySchema,
	insertLibraryMembership,
	seedMediaEntity,
	waitForLibrarySummary,
} from "~/fixtures/plugins/media";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

type MediaReference = Parameters<typeof animeRecipes.summaryRecipe>[0]["reference"];

const loadListStateSchemas = (client: Client) =>
	Effect.gen(function* () {
		const [anime, manga] = yield* Effect.all([
			findMediaEntitySchema(client, "anime"),
			findMediaEntitySchema(client, "manga"),
		]);
		const [animeEvents, mangaEvents] = yield* Effect.all([
			listEventSchemas(client, anime.schema.reference),
			listEventSchemas(client, manga.schema.reference),
		]);
		const animeReference: MediaReference = { kind: "local", pluginId: anime.pluginId };
		const mangaReference: MediaReference = { kind: "local", pluginId: manga.pluginId };
		return {
			manga: {
				schemaId: manga.schema.id,
				reference: mangaReference,
				listState: requireEventSchemaBySlug(mangaEvents, "list-state").id,
			},
			anime: {
				schemaId: anime.schema.id,
				reference: animeReference,
				onHold: requireEventSchemaBySlug(animeEvents, "on_hold").id,
				progress: requireEventSchemaBySlug(animeEvents, "progress").id,
				listState: requireEventSchemaBySlug(animeEvents, "list-state").id,
			},
		};
	});

const createListStateSnapshot = (
	client: Client,
	input: {
		entityId: string;
		occurredAt: string;
		eventSchemaSlug: string;
		properties: ListStateProperties;
	},
) => createEventFixture(client, input);

const readAnimeSummary = (client: Client, reference: MediaReference, entityId: string) =>
	Effect.gen(function* () {
		const result = yield* executeRyotQLRecipe(client, animeRecipes.summaryRecipe({ reference }), {
			entityId,
		});
		assertPresent(result.summary, "Expected an anime summary row");
		return result.summary;
	});

describe("AniList list-state media queries", () => {
	it.live(
		"applies snapshots to lifecycle state and positions without creating review history",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const schemas = yield* loadListStateSchemas(client);
				const animeReference = schemas.anime.reference;
				const mangaReference = schemas.manga.reference;
				const suffix = yield* randomUuid;
				const [anime, manga] = yield* Effect.all([
					seedMediaEntity({
						userId: null,
						providerId: null,
						properties: { episodes: 24 },
						name: `AniList State Anime ${suffix}`,
						entitySchemaSlug: schemas.anime.schemaId,
						externalId: `anilist-state-anime-${suffix}`,
					}),
					seedMediaEntity({
						userId: null,
						providerId: null,
						properties: { chapters: 10 },
						name: `AniList State Manga ${suffix}`,
						entitySchemaSlug: schemas.manga.schemaId,
						externalId: `anilist-state-manga-${suffix}`,
					}),
				]);
				yield* Effect.all([
					insertLibraryMembership(client, { mediaEntityId: anime.id }),
					insertLibraryMembership(client, { mediaEntityId: manga.id }),
				]);

				yield* createEventFixture(client, {
					entityId: anime.id,
					occurredAt: "2026-01-01T00:00:00.000Z",
					eventSchemaSlug: schemas.anime.progress,
					properties: { position: { position: 8, unit: "episodes" } },
				});
				yield* createListStateSnapshot(client, {
					entityId: anime.id,
					occurredAt: "2026-01-02T00:00:00.000Z",
					eventSchemaSlug: schemas.anime.listState,
					properties: {
						repeatCount: 2,
						source: "anilist",
						state: "in_progress",
						sourceEntryId: "entry",
						sourceAccountId: "acct",
						startedDate: { year: 2020 },
						position: { position: 0, unit: "episodes" },
						sourceUpdatedAt: "2020-01-01T00:00:00.000Z",
					},
				});
				yield* createListStateSnapshot(client, {
					entityId: manga.id,
					occurredAt: "2026-01-02T00:00:00.000Z",
					eventSchemaSlug: schemas.manga.listState,
					properties: {
						repeatCount: 0,
						state: "on_hold",
						source: "anilist",
						sourceAccountId: "acct",
						sourceEntryId: "manga-entry",
						sourceUpdatedAt: "2020-01-01T00:00:00.000Z",
						position: { volume: 0, position: 0, unit: "chapters" },
					},
				});

				const animeSummary = yield* readAnimeSummary(client, animeReference, anime.id);
				expect(animeSummary).toMatchObject({ state: "in_progress", progressPercent: null });
				yield* Effect.all([
					waitForLibrarySummary(client, anime.id),
					waitForLibrarySummary(client, manga.id),
				]);
				const initialFlat = yield* executeRyotQLRecipe(
					client,
					flatByLifecycleStateRecipe({ reference: animeReference }),
					{ states: ["in_progress", "on_hold"] },
					{ pages: { items: { limit: 20 } } },
				);
				const initialAnime = initialFlat.items.find((item) => item.id === anime.id);
				const initialManga = initialFlat.items.find((item) => item.id === manga.id);
				assertPresent(initialAnime, "Expected the anime in the flat lifecycle list");
				assertPresent(initialManga, "Expected the manga in the flat lifecycle list");
				expect(initialAnime).toMatchObject({
					state: "in_progress",
					progressPercent: null,
					position: { position: 0, unit: "episodes" },
				});
				expect(initialManga).toMatchObject({
					state: "on_hold",
					position: { volume: 0, position: 0, unit: "chapters" },
				});

				yield* createEventFixture(client, {
					entityId: anime.id,
					properties: { progressPercent: 80 },
					eventSchemaSlug: schemas.anime.onHold,
					occurredAt: "2026-01-02T12:00:00.000Z",
				});
				expect(yield* readAnimeSummary(client, animeReference, anime.id)).toMatchObject({
					state: "on_hold",
					progressPercent: null,
				});
				yield* waitForLibrarySummary(client, anime.id);
				const heldFlat = yield* executeRyotQLRecipe(
					client,
					flatByLifecycleStateRecipe({ reference: animeReference }),
					{ states: ["on_hold"] },
					{ pages: { items: { limit: 20 } } },
				);
				expect(heldFlat.items.find((item) => item.id === anime.id)).toMatchObject({
					state: "on_hold",
					progressPercent: null,
					position: { position: 0, unit: "episodes" },
				});

				yield* createEventFixture(client, {
					entityId: anime.id,
					occurredAt: "2026-01-03T00:00:00.000Z",
					eventSchemaSlug: schemas.anime.progress,
					properties: { position: { position: 6, unit: "episodes" } },
				});
				const resumedSummary = yield* readAnimeSummary(client, animeReference, anime.id);
				expect(resumedSummary).toMatchObject({ progressPercent: 25, state: "in_progress" });
				yield* waitForLibrarySummary(client, anime.id);
				const resumedFlat = yield* executeRyotQLRecipe(
					client,
					flatByLifecycleStateRecipe({ reference: animeReference }),
					{ states: ["in_progress"] },
					{ pages: { items: { limit: 20 } } },
				);
				const resumedAnime = resumedFlat.items.find((item) => item.id === anime.id);
				assertPresent(resumedAnime, "Expected the resumed anime in the flat lifecycle list");
				expect(resumedAnime).toMatchObject({ position: { position: 6, unit: "episodes" } });

				yield* createListStateSnapshot(client, {
					entityId: anime.id,
					occurredAt: "2026-01-04T00:00:00.000Z",
					eventSchemaSlug: schemas.anime.listState,
					properties: {
						repeatCount: 2,
						source: "anilist",
						state: "complete",
						sourceEntryId: "entry",
						sourceAccountId: "acct",
						position: { position: 1, unit: "episodes" },
						sourceUpdatedAt: "2020-01-01T00:00:00.000Z",
					},
				});
				const completedSummary = yield* readAnimeSummary(client, animeReference, anime.id);
				expect(completedSummary).toMatchObject({ state: "complete", progressPercent: null });
				yield* waitForLibrarySummary(client, anime.id);
				const completedFlat = yield* executeRyotQLRecipe(
					client,
					flatByLifecycleStateRecipe({ reference: animeReference }),
					{ states: ["complete"] },
					{ pages: { items: { limit: 20 } } },
				);
				const completedAnime = completedFlat.items.find((item) => item.id === anime.id);
				assertPresent(completedAnime, "Expected the completed anime in the flat lifecycle list");
				expect(completedAnime).toMatchObject({
					state: "complete",
					position: { position: 1, unit: "episodes" },
				});

				const snapshots = yield* executeRyotQLRecipe(
					client,
					listStateSnapshotsRecipe({ reference: animeReference }),
					{ sourceAccountId: "acct", sourceEntryIds: ["entry", "manga-entry"] },
					{ pages: { snapshots: { limit: 20 } } },
				);
				expect(snapshots.items).toHaveLength(3);
				expect(snapshots.items.map(({ properties }) => properties.sourceEntryId).sort()).toEqual([
					"entry",
					"entry",
					"manga-entry",
				]);
				expect(
					snapshots.items.every(({ properties }) => properties.sourceAccountId === "acct"),
				).toBe(true);
				const startedSnapshot = snapshots.items.find(
					({ properties }) =>
						properties.sourceEntryId === "entry" && properties.state === "in_progress",
				);
				assertPresent(startedSnapshot, "Expected the AniList in-progress snapshot");
				expect(startedSnapshot.properties).toMatchObject({
					repeatCount: 2,
					source: "anilist",
					state: "in_progress",
					sourceEntryId: "entry",
					sourceAccountId: "acct",
					startedDate: { year: 2020 },
					position: { position: 0, unit: "episodes" },
					sourceUpdatedAt: "2020-01-01T00:00:00.000Z",
				});
				const otherAccountSnapshots = yield* executeRyotQLRecipe(
					client,
					listStateSnapshotsRecipe({ reference: animeReference }),
					{ sourceAccountId: "other-account", sourceEntryIds: ["entry", "manga-entry"] },
					{ pages: { snapshots: { limit: 20 } } },
				);
				expect(otherAccountSnapshots.items).toEqual([]);

				const [animeActivity, mangaActivity] = yield* Effect.all([
					executeRyotQLRecipe(
						client,
						animeRecipes.activityRecipe({ reference: animeReference }),
						{ entityId: anime.id },
						{ pages: { events: { limit: 20 }, collectionEvents: { limit: 20 } } },
					),
					executeRyotQLRecipe(
						client,
						mangaRecipes.activityRecipe({ reference: mangaReference }),
						{ entityId: manga.id },
						{ pages: { events: { limit: 20 }, collectionEvents: { limit: 20 } } },
					),
				]);
				const animeListStates = animeActivity.events.flatMap((event) =>
					event.kind === "media" &&
					event.eventSchemaSlug === "list-state" &&
					event.listState !== null
						? [event.listState]
						: [],
				);
				const mangaListStates = mangaActivity.events.flatMap((event) =>
					event.kind === "media" &&
					event.eventSchemaSlug === "list-state" &&
					event.listState !== null
						? [event.listState]
						: [],
				);
				expect(animeListStates).toEqual<unknown>(
					arrayContaining([
						objectContaining({
							state: "complete",
							sourceEntryId: "entry",
							position: { position: 1, unit: "episodes" },
						}),
						objectContaining({
							state: "in_progress",
							sourceEntryId: "entry",
							startedDate: { year: 2020 },
							position: { position: 0, unit: "episodes" },
						}),
					]),
				);
				expect(mangaListStates).toEqual<unknown>([
					objectContaining({
						state: "on_hold",
						sourceEntryId: "manga-entry",
						position: { volume: 0, position: 0, unit: "chapters" },
					}),
				]);
				for (const activity of [animeActivity, mangaActivity]) {
					expect(
						activity.events.some(
							(event) => event.kind === "media" && event.eventSchemaSlug === "review",
						),
					).toBe(false);
					expect(
						activity.events.some((event) => event.kind === "media" && event.rating !== null),
					).toBe(false);
				}

				const [animeHistory, mangaHistory] = yield* Effect.all([
					listEventsForEntity(client, anime.id, undefined, 20),
					listEventsForEntity(client, manga.id, undefined, 20),
				]);
				expect(
					animeHistory
						.filter((event) => event.eventSchemaSlug !== "add-to-media-library")
						.map((event) => event.eventSchemaSlug),
				).toEqual([
					EventSchemaSlug.make("list-state"),
					EventSchemaSlug.make("progress"),
					EventSchemaSlug.make("on_hold"),
					EventSchemaSlug.make("list-state"),
					EventSchemaSlug.make("progress"),
				]);
				expect(
					mangaHistory
						.filter((event) => event.eventSchemaSlug !== "add-to-media-library")
						.map((event) => event.eventSchemaSlug),
				).toEqual([EventSchemaSlug.make("list-state")]);
				for (const history of [animeHistory, mangaHistory]) {
					expect(history.some((event) => event.eventSchemaSlug === "complete")).toBe(false);
					expect(history.some((event) => event.eventSchemaSlug === "review")).toBe(false);
					expect(history.some((event) => "rating" in event.properties)).toBe(false);
				}
			}),
	);
});
