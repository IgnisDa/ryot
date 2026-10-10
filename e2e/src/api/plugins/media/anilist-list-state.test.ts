import { animeRecipes } from "@ryot-app/media-plugin/shared/anime-recipes";
import { flatByLifecycleStateRecipe } from "@ryot-app/media-plugin/shared/lifecycle-list-recipes";
import type { ListStateProperties } from "@ryot-app/media-plugin/shared/list-state";
import { listStateSnapshotsRecipe } from "@ryot-app/media-plugin/shared/list-state-recipes";
import { mangaRecipes } from "@ryot-app/media-plugin/shared/manga-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEventFixture,
	executeRyotQLRecipe,
	getBuiltinEntitySchemaSlug,
	listEventSchemas,
	listEventsForEntity,
	requireEventSchemaBySlug,
	type Client,
} from "~/fixtures/kernel";
import { insertLibraryMembership, seedMediaEntity } from "~/fixtures/plugins/media";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const loadListStateSchemas = (client: Client) =>
	Effect.gen(function* () {
		const [animeSchemaId, mangaSchemaId] = yield* Effect.all([
			getBuiltinEntitySchemaSlug(client, "anime"),
			getBuiltinEntitySchemaSlug(client, "manga"),
		]);
		const [animeEvents, mangaEvents] = yield* Effect.all([
			listEventSchemas(client, animeSchemaId),
			listEventSchemas(client, mangaSchemaId),
		]);
		return {
			manga: {
				schemaId: mangaSchemaId,
				listState: requireEventSchemaBySlug(mangaEvents, "list-state").id,
			},
			anime: {
				schemaId: animeSchemaId,
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

const readAnimeSummary = (client: Client, entityId: string) =>
	Effect.gen(function* () {
		const result = yield* executeRyotQLRecipe(
			client,
			animeRecipes.summaryRecipe({ entityId, collectionLimit: 1 }),
		);
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
				const suffix = crypto.randomUUID();
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
					properties: { animeEpisode: 8, progressPercent: 100 },
				});
				yield* createListStateSnapshot(client, {
					entityId: anime.id,
					occurredAt: "2026-01-02T00:00:00.000Z",
					eventSchemaSlug: schemas.anime.listState,
					properties: {
						repeatCount: 2,
						animeEpisode: 0,
						source: "anilist",
						state: "in_progress",
						sourceEntryId: "entry",
						sourceAccountId: "acct",
						startedDate: { year: 2020 },
						sourceUpdatedAt: "2020-01-01T00:00:00.000Z",
					},
				});
				yield* createListStateSnapshot(client, {
					entityId: manga.id,
					occurredAt: "2026-01-02T00:00:00.000Z",
					eventSchemaSlug: schemas.manga.listState,
					properties: {
						mangaVolume: 0,
						repeatCount: 0,
						mangaChapter: 0,
						state: "on_hold",
						source: "anilist",
						sourceAccountId: "acct",
						sourceEntryId: "manga-entry",
						sourceUpdatedAt: "2020-01-01T00:00:00.000Z",
					},
				});

				const animeSummary = yield* readAnimeSummary(client, anime.id);
				expect(animeSummary).toMatchObject({ state: "in_progress", progressPercent: null });
				const initialFlat = yield* executeRyotQLRecipe(
					client,
					flatByLifecycleStateRecipe({ limit: 20, states: ["in_progress", "on_hold"] }),
				);
				const initialAnime = initialFlat.items.find((item) => item.id === anime.id);
				const initialManga = initialFlat.items.find((item) => item.id === manga.id);
				assertPresent(initialAnime, "Expected the anime in the flat lifecycle list");
				assertPresent(initialManga, "Expected the manga in the flat lifecycle list");
				expect(initialAnime).toMatchObject({
					animeEpisode: 0,
					state: "in_progress",
					progressPercent: null,
				});
				expect(initialManga).toMatchObject({ mangaVolume: 0, mangaChapter: 0, state: "on_hold" });

				yield* createEventFixture(client, {
					entityId: anime.id,
					properties: { progressPercent: 80 },
					eventSchemaSlug: schemas.anime.onHold,
					occurredAt: "2026-01-02T12:00:00.000Z",
				});
				expect(yield* readAnimeSummary(client, anime.id)).toMatchObject({
					state: "on_hold",
					progressPercent: null,
				});
				const heldFlat = yield* executeRyotQLRecipe(
					client,
					flatByLifecycleStateRecipe({ limit: 20, states: ["on_hold"] }),
				);
				expect(heldFlat.items.find((item) => item.id === anime.id)).toMatchObject({
					animeEpisode: 0,
					state: "on_hold",
					progressPercent: null,
				});

				yield* createEventFixture(client, {
					entityId: anime.id,
					occurredAt: "2026-01-03T00:00:00.000Z",
					eventSchemaSlug: schemas.anime.progress,
					properties: { animeEpisode: 3, progressPercent: 25 },
				});
				const resumedSummary = yield* readAnimeSummary(client, anime.id);
				expect(resumedSummary).toMatchObject({ progressPercent: 25, state: "in_progress" });
				const resumedFlat = yield* executeRyotQLRecipe(
					client,
					flatByLifecycleStateRecipe({ limit: 20, states: ["in_progress"] }),
				);
				const resumedAnime = resumedFlat.items.find((item) => item.id === anime.id);
				assertPresent(resumedAnime, "Expected the resumed anime in the flat lifecycle list");
				expect(resumedAnime).toMatchObject({ animeEpisode: 3, progressPercent: 25 });

				yield* createListStateSnapshot(client, {
					entityId: anime.id,
					occurredAt: "2026-01-04T00:00:00.000Z",
					eventSchemaSlug: schemas.anime.listState,
					properties: {
						repeatCount: 2,
						animeEpisode: 1,
						source: "anilist",
						state: "complete",
						sourceEntryId: "entry",
						sourceAccountId: "acct",
						sourceUpdatedAt: "2020-01-01T00:00:00.000Z",
					},
				});
				const completedSummary = yield* readAnimeSummary(client, anime.id);
				expect(completedSummary).toMatchObject({ state: "complete", progressPercent: null });
				const completedFlat = yield* executeRyotQLRecipe(
					client,
					flatByLifecycleStateRecipe({ limit: 20, states: ["complete"] }),
				);
				const completedAnime = completedFlat.items.find((item) => item.id === anime.id);
				assertPresent(completedAnime, "Expected the completed anime in the flat lifecycle list");
				expect(completedAnime).toMatchObject({ animeEpisode: 1, state: "complete" });

				const snapshots = yield* executeRyotQLRecipe(
					client,
					listStateSnapshotsRecipe({
						limit: 20,
						sourceAccountId: "acct",
						sourceEntryIds: ["entry", "manga-entry"],
					}),
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
					animeEpisode: 0,
					source: "anilist",
					state: "in_progress",
					sourceEntryId: "entry",
					sourceAccountId: "acct",
					startedDate: { year: 2020 },
					sourceUpdatedAt: "2020-01-01T00:00:00.000Z",
				});
				const otherAccountSnapshots = yield* executeRyotQLRecipe(
					client,
					listStateSnapshotsRecipe({
						limit: 20,
						sourceAccountId: "other-account",
						sourceEntryIds: ["entry", "manga-entry"],
					}),
				);
				expect(otherAccountSnapshots.items).toEqual([]);

				const [animeActivity, mangaActivity] = yield* Effect.all([
					executeRyotQLRecipe(
						client,
						animeRecipes.activityRecipe({
							eventLimit: 20,
							entityId: anime.id,
							collectionEventLimit: 20,
						}),
					),
					executeRyotQLRecipe(
						client,
						mangaRecipes.activityRecipe({
							eventLimit: 20,
							entityId: manga.id,
							collectionEventLimit: 20,
						}),
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
				expect(animeListStates).toEqual(
					expect.arrayContaining([
						expect.objectContaining({ animeEpisode: 1, state: "complete", sourceEntryId: "entry" }),
						expect.objectContaining({
							animeEpisode: 0,
							state: "in_progress",
							sourceEntryId: "entry",
							startedDate: { year: 2020 },
						}),
					]),
				);
				expect(mangaListStates).toEqual([
					expect.objectContaining({
						mangaVolume: 0,
						mangaChapter: 0,
						state: "on_hold",
						sourceEntryId: "manga-entry",
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
				).toEqual(["list-state", "progress", "on_hold", "list-state", "progress"]);
				expect(
					mangaHistory
						.filter((event) => event.eventSchemaSlug !== "add-to-media-library")
						.map((event) => event.eventSchemaSlug),
				).toEqual(["list-state"]);
				for (const history of [animeHistory, mangaHistory]) {
					expect(history.some((event) => event.eventSchemaSlug === "complete")).toBe(false);
					expect(history.some((event) => event.eventSchemaSlug === "review")).toBe(false);
					expect(history.some((event) => "rating" in event.properties)).toBe(false);
				}
			}),
	);
});
