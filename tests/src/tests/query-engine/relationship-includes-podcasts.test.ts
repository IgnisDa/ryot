import {
	buildCompletedPodcastsQueryDocument,
	buildInProgressPodcastsQueryDocument,
	buildPodcastDetailQueryDocument,
} from "@ryot/query-engine/recipes/media";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createQueryEngineEvent,
	executeQueryEngine,
	findBuiltinSchemaBySlug,
	getBuiltinEntitySchemaSlug,
	insertGlobalRelationship,
	listEventSchemas,
	listRelationshipSchemas,
	requireEventSchemaBySlug,
	requireQueryEngineFieldValue,
	requireQueryEngineIncludeValue,
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
				sandboxScriptId: null,
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
				sandboxScriptId: null,
				entitySchemaSlug: podcastEpisodeSchemaId,
				externalId: `podcast-episode-2-${fixtureSuffix}`,
				properties: { runtime: 40, episodeNumber: 2, publishDate: null, description: "Second" },
			});
			const firstEpisode = yield* seedMediaEntity({
				userId: null,
				name: "Episode One",
				sandboxScriptId: null,
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
				eventSchemaSlug: episodeCompleteSchema.id,
				properties: { completionMode: "unknown" },
			});

			const detailDoc = buildPodcastDetailQueryDocument({ entityId: podcast.id, episodeLimit: 10 });

			const detailResult = yield* executeQueryEngine(client, detailDoc);
			const podcastRow = detailResult.data.items[0];
			assertPresent(podcastRow, "Expected podcast row");
			const episodes = requireQueryEngineIncludeValue(podcastRow, "episodes");
			expect(
				episodes.items.map(
					(episode) => requireQueryEngineFieldValue(episode, "episodeNumber").value,
				),
			).toEqual([1, 2]);
			const firstEpisodeRow = episodes.items[0];
			assertPresent(firstEpisodeRow, "Expected first podcast episode row");
			expect(requireQueryEngineFieldValue(firstEpisodeRow, "name").value).toBe("Episode One");
			expect(requireQueryEngineFieldValue(firstEpisodeRow, "hasProgress")).toEqual({
				value: true,
				kind: "boolean",
			});
			expect(requireQueryEngineFieldValue(firstEpisodeRow, "isComplete")).toEqual({
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
				sandboxScriptId: null,
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
				sandboxScriptId: null,
				entitySchemaSlug: podcastEpisodeSchemaId,
				externalId: `podcast-episode-1-${fixtureSuffix}`,
				properties: { runtime: 30, episodeNumber: 1, publishDate: null, description: "First" },
			});
			const secondEpisode = yield* seedMediaEntity({
				userId: null,
				name: "Episode Two",
				sandboxScriptId: null,
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
				entityId: podcast.id,
				limit: 10,
			});
			const fullyWatchedDoc = buildCompletedPodcastsQueryDocument({
				entityId: podcast.id,
				limit: 10,
			});

			const phaseOneCurrentlyWatching = yield* executeQueryEngine(client, currentlyWatchingDoc);
			expect(phaseOneCurrentlyWatching.data.items).toHaveLength(1);
			const phaseOneFullyWatched = yield* executeQueryEngine(client, fullyWatchedDoc);
			expect(phaseOneFullyWatched.data.items).toHaveLength(0);

			yield* createQueryEngineEvent(client, {
				entityId: secondEpisode.id,
				eventSchemaSlug: episodeCompleteSchema.id,
				properties: { completionMode: "unknown" },
			});

			const phaseTwoCurrentlyWatching = yield* executeQueryEngine(client, currentlyWatchingDoc);
			expect(phaseTwoCurrentlyWatching.data.items).toHaveLength(1);
			const phaseTwoFullyWatched = yield* executeQueryEngine(client, fullyWatchedDoc);
			expect(phaseTwoFullyWatched.data.items).toHaveLength(1);

			yield* createQueryEngineEvent(client, {
				entityId: podcast.id,
				eventSchemaSlug: podcastCompleteSchema.id,
				properties: { completionMode: "unknown" },
			});

			const phaseThreeCurrentlyWatching = yield* executeQueryEngine(client, currentlyWatchingDoc);
			expect(phaseThreeCurrentlyWatching.data.items).toHaveLength(0);
			const phaseThreeFullyWatched = yield* executeQueryEngine(client, fullyWatchedDoc);
			expect(phaseThreeFullyWatched.data.items).toHaveLength(1);
		}),
	);
});
