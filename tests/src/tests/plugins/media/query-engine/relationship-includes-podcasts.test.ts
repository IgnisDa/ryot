import {
	buildCompletedPodcastsQueryDocument,
	buildInProgressPodcastsQueryDocument,
	buildPodcastDetailQueryDocument,
} from "@ryot/media-plugin/query-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createQueryEngineEvent,
	executeRyotQL,
	findBuiltinSchemaBySlug,
	getBuiltinEntitySchemaSlug,
	insertGlobalRelationship,
	listEventSchemas,
	listRelationshipSchemas,
	requireEventSchemaBySlug,
	requireRyotQLFieldValue,
	requireRelationshipSchemaBySlug,
	seedMediaEntity,
	waitForEventCount,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("Relationship includes", () => {
	it.live("returns builtin podcast episodes with derived episode state", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: podcastSchema } = yield* findBuiltinSchemaBySlug(client, "podcast");
			const podcastEpisodeSchemaId = yield* getBuiltinEntitySchemaSlug("podcast-episode");
			const relationshipSchemas = yield* listRelationshipSchemas(client, {
				slugs: ["podcast-to-podcast-episode"],
			});
			const podcastEpisodeRelationship = requireRelationshipSchemaBySlug(
				relationshipSchemas,
				"podcast-to-podcast-episode",
			);
			const episodeEvents = yield* listEventSchemas(client, podcastEpisodeSchemaId);
			const episodeProgressSchema = requireEventSchemaBySlug(episodeEvents, "progress");
			const episodeCompleteSchema = requireEventSchemaBySlug(episodeEvents, "complete");

			const fixtureSuffix = crypto.randomUUID();
			const podcast = yield* seedMediaEntity({
				userId: null,
				providerId: null,
				name: "Episodic Test Podcast",
				entitySchemaSlug: podcastSchema.id,
				externalId: `podcast-${fixtureSuffix}`,
				properties: {
					images: [],
					genres: [],
					isNsfw: null,
					sourceUrl: null,
					totalEpisodes: 2,
					description: null,
					publishYear: null,
					publishDate: null,
					providerRating: null,
					unlinkedCreators: [],
					productionStatus: null,
				},
			});
			const secondEpisode = yield* seedMediaEntity({
				userId: null,
				name: "Episode Two",
				providerId: null,
				entitySchemaSlug: podcastEpisodeSchemaId,
				externalId: `podcast-episode-2-${fixtureSuffix}`,
				properties: { runtime: 40, episodeNumber: 2, publishDate: null, description: "Second" },
			});
			const firstEpisode = yield* seedMediaEntity({
				userId: null,
				name: "Episode One",
				providerId: null,
				entitySchemaSlug: podcastEpisodeSchemaId,
				externalId: `podcast-episode-1-${fixtureSuffix}`,
				properties: { runtime: 30, episodeNumber: 1, publishDate: null, description: "First" },
			});

			yield* insertGlobalRelationship({
				sourceEntityId: podcast.id,
				targetEntityId: secondEpisode.id,
				relationshipSchemaSlug: podcastEpisodeRelationship.id,
			});
			yield* insertGlobalRelationship({
				sourceEntityId: podcast.id,
				targetEntityId: firstEpisode.id,
				relationshipSchemaSlug: podcastEpisodeRelationship.id,
			});

			yield* createQueryEngineEvent(client, {
				entityId: firstEpisode.id,
				occurredAt: "2026-06-25T00:00:00.000Z",
				eventSchemaSlug: episodeProgressSchema.id,
				properties: { progressPercent: 100, consumedOn: "Audiobookshelf" },
			});
			yield* waitForEventCount(client, firstEpisode.id, 2);
			yield* createQueryEngineEvent(client, {
				entityId: secondEpisode.id,
				properties: { completionMode: "unknown" },
				eventSchemaSlug: episodeCompleteSchema.id,
			});

			const detailDoc = buildPodcastDetailQueryDocument({ entityId: podcast.id, episodeLimit: 10 });

			const detailResult = yield* executeRyotQL(client, detailDoc);
			const podcastResult = detailResult.data.podcast;
			if (podcastResult?.type !== "rows") {
				throw new Error("Expected podcast rows result");
			}
			const podcastRow = podcastResult.items[0];
			assertPresent(podcastRow, "Expected podcast row");
			const episodes = podcastRow.episodes;
			if (!episodes || !("items" in episodes)) {
				throw new Error("Expected episodes include");
			}
			expect(
				episodes.items.map((episode) => requireRyotQLFieldValue(episode, "episodeNumber").value),
			).toEqual([1, 2]);
			const firstEpisodeRow = episodes.items[0];
			assertPresent(firstEpisodeRow, "Expected first podcast episode row");
			expect(requireRyotQLFieldValue(firstEpisodeRow, "name").value).toBe("Episode One");
			expect(requireRyotQLFieldValue(firstEpisodeRow, "hasProgress")).toEqual({
				value: true,
				kind: "boolean",
			});
			expect(requireRyotQLFieldValue(firstEpisodeRow, "isComplete")).toEqual({
				value: true,
				kind: "boolean",
			});
		}),
	);

	it.live("derives podcast fully-watched and currently-watching from per-episode state", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: podcastSchema } = yield* findBuiltinSchemaBySlug(client, "podcast");
			const podcastEpisodeSchemaId = yield* getBuiltinEntitySchemaSlug("podcast-episode");
			const relationshipSchemas = yield* listRelationshipSchemas(client, {
				slugs: ["podcast-to-podcast-episode"],
			});
			const podcastEpisodeRelationship = requireRelationshipSchemaBySlug(
				relationshipSchemas,
				"podcast-to-podcast-episode",
			);
			const episodeEvents = yield* listEventSchemas(client, podcastEpisodeSchemaId);
			const episodeProgressSchema = requireEventSchemaBySlug(episodeEvents, "progress");
			const episodeCompleteSchema = requireEventSchemaBySlug(episodeEvents, "complete");
			const podcastEvents = yield* listEventSchemas(client, podcastSchema.id);
			const podcastCompleteSchema = requireEventSchemaBySlug(podcastEvents, "complete");

			const fixtureSuffix = crypto.randomUUID();
			const podcast = yield* seedMediaEntity({
				userId: null,
				providerId: null,
				name: "Derivation Podcast",
				entitySchemaSlug: podcastSchema.id,
				externalId: `podcast-${fixtureSuffix}`,
				properties: {
					images: [],
					genres: [],
					isNsfw: null,
					sourceUrl: null,
					totalEpisodes: 2,
					description: null,
					publishYear: null,
					publishDate: null,
					providerRating: null,
					unlinkedCreators: [],
					productionStatus: null,
				},
			});
			const firstEpisode = yield* seedMediaEntity({
				userId: null,
				name: "Episode One",
				providerId: null,
				entitySchemaSlug: podcastEpisodeSchemaId,
				externalId: `podcast-episode-1-${fixtureSuffix}`,
				properties: { runtime: 30, episodeNumber: 1, publishDate: null, description: "First" },
			});
			const secondEpisode = yield* seedMediaEntity({
				userId: null,
				name: "Episode Two",
				providerId: null,
				entitySchemaSlug: podcastEpisodeSchemaId,
				externalId: `podcast-episode-2-${fixtureSuffix}`,
				properties: { runtime: 40, episodeNumber: 2, publishDate: null, description: "Second" },
			});

			yield* insertGlobalRelationship({
				sourceEntityId: podcast.id,
				targetEntityId: firstEpisode.id,
				relationshipSchemaSlug: podcastEpisodeRelationship.id,
			});
			yield* insertGlobalRelationship({
				sourceEntityId: podcast.id,
				targetEntityId: secondEpisode.id,
				relationshipSchemaSlug: podcastEpisodeRelationship.id,
			});

			yield* createQueryEngineEvent(client, {
				entityId: firstEpisode.id,
				occurredAt: "2026-06-25T00:00:00.000Z",
				eventSchemaSlug: episodeProgressSchema.id,
				properties: { progressPercent: 100, consumedOn: "Audiobookshelf" },
			});
			yield* waitForEventCount(client, firstEpisode.id, 2);

			const currentlyWatchingDoc = buildInProgressPodcastsQueryDocument({
				limit: 10,
				entityId: podcast.id,
			});
			const fullyWatchedDoc = buildCompletedPodcastsQueryDocument({
				limit: 10,
				entityId: podcast.id,
			});

			const phaseOneCurrentlyWatching = yield* executeRyotQL(client, currentlyWatchingDoc);
			const phaseOneWatchingRows = phaseOneCurrentlyWatching.data.podcasts;
			if (phaseOneWatchingRows?.type !== "rows") {
				throw new Error("Expected in-progress podcast rows result");
			}
			expect(phaseOneWatchingRows.items).toHaveLength(1);
			const phaseOneFullyWatched = yield* executeRyotQL(client, fullyWatchedDoc);
			const phaseOneCompletedRows = phaseOneFullyWatched.data.podcasts;
			if (phaseOneCompletedRows?.type !== "rows") {
				throw new Error("Expected completed podcast rows result");
			}
			expect(phaseOneCompletedRows.items).toHaveLength(0);

			yield* createQueryEngineEvent(client, {
				entityId: secondEpisode.id,
				properties: { completionMode: "unknown" },
				eventSchemaSlug: episodeCompleteSchema.id,
			});

			const phaseTwoCurrentlyWatching = yield* executeRyotQL(client, currentlyWatchingDoc);
			const phaseTwoWatchingRows = phaseTwoCurrentlyWatching.data.podcasts;
			if (phaseTwoWatchingRows?.type !== "rows") {
				throw new Error("Expected in-progress podcast rows result");
			}
			expect(phaseTwoWatchingRows.items).toHaveLength(1);
			const phaseTwoFullyWatched = yield* executeRyotQL(client, fullyWatchedDoc);
			const phaseTwoCompletedRows = phaseTwoFullyWatched.data.podcasts;
			if (phaseTwoCompletedRows?.type !== "rows") {
				throw new Error("Expected completed podcast rows result");
			}
			expect(phaseTwoCompletedRows.items).toHaveLength(1);

			yield* createQueryEngineEvent(client, {
				entityId: podcast.id,
				properties: { completionMode: "unknown" },
				eventSchemaSlug: podcastCompleteSchema.id,
			});

			const phaseThreeCurrentlyWatching = yield* executeRyotQL(client, currentlyWatchingDoc);
			const phaseThreeWatchingRows = phaseThreeCurrentlyWatching.data.podcasts;
			if (phaseThreeWatchingRows?.type !== "rows") {
				throw new Error("Expected in-progress podcast rows result");
			}
			expect(phaseThreeWatchingRows.items).toHaveLength(0);
			const phaseThreeFullyWatched = yield* executeRyotQL(client, fullyWatchedDoc);
			const phaseThreeCompletedRows = phaseThreeFullyWatched.data.podcasts;
			if (phaseThreeCompletedRows?.type !== "rows") {
				throw new Error("Expected completed podcast rows result");
			}
			expect(phaseThreeCompletedRows.items).toHaveLength(1);
		}),
	);
});
