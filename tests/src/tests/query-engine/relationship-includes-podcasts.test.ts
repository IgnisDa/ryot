import { describe, expect, it } from "bun:test";

import {
	buildCompletedPodcastsQueryDocument,
	buildInProgressPodcastsQueryDocument,
	buildPodcastDetailQueryDocument,
} from "@ryot/query-engine";

import {
	createAuthenticatedClient,
	createQueryEngineEvent,
	executeQueryEngine,
	findBuiltinSchemaBySlug,
	getBuiltinEntitySchemaId,
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

describe("Relationship includes", () => {
	it("returns builtin podcast episodes with derived episode state", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema: podcastSchema } = await findBuiltinSchemaBySlug(client, "podcast");
		const podcastEpisodeSchemaId = await getBuiltinEntitySchemaId("podcast-episode");
		const relationshipSchemas = await listRelationshipSchemas(client, {
			slugs: ["podcast-to-podcast-episode"],
		});
		const podcastEpisodeRelationship = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"podcast-to-podcast-episode",
		);
		const episodeEvents = await listEventSchemas(client, podcastEpisodeSchemaId);
		const episodeProgressSchema = requireEventSchemaBySlug(episodeEvents, "progress");
		const episodeCompleteSchema = requireEventSchemaBySlug(episodeEvents, "complete");

		const fixtureSuffix = crypto.randomUUID();
		const podcast = await seedMediaEntity({
			userId: null,
			sandboxScriptId: null,
			name: "Episodic Test Podcast",
			entitySchemaId: podcastSchema.id,
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
		const secondEpisode = await seedMediaEntity({
			userId: null,
			name: "Episode Two",
			sandboxScriptId: null,
			entitySchemaId: podcastEpisodeSchemaId,
			externalId: `podcast-episode-2-${fixtureSuffix}`,
			properties: { runtime: 40, episodeNumber: 2, publishDate: null, description: "Second" },
		});
		const firstEpisode = await seedMediaEntity({
			userId: null,
			name: "Episode One",
			sandboxScriptId: null,
			entitySchemaId: podcastEpisodeSchemaId,
			externalId: `podcast-episode-1-${fixtureSuffix}`,
			properties: { runtime: 30, episodeNumber: 1, publishDate: null, description: "First" },
		});

		await insertGlobalRelationship({
			sourceEntityId: podcast.id,
			targetEntityId: secondEpisode.id,
			relationshipSchemaId: podcastEpisodeRelationship.id,
		});
		await insertGlobalRelationship({
			sourceEntityId: podcast.id,
			targetEntityId: firstEpisode.id,
			relationshipSchemaId: podcastEpisodeRelationship.id,
		});

		await createQueryEngineEvent(client, {
			entityId: firstEpisode.id,
			occurredAt: "2026-06-25T00:00:00.000Z",
			eventSchemaId: episodeProgressSchema.id,
			properties: { progressPercent: 100, consumedOn: "Audiobookshelf" },
		});
		await waitForEventCount(client, firstEpisode.id, 2);
		await createQueryEngineEvent(client, {
			entityId: secondEpisode.id,
			eventSchemaId: episodeCompleteSchema.id,
			properties: { completionMode: "unknown" },
		});

		const detailDoc = buildPodcastDetailQueryDocument({ entityId: podcast.id, episodeLimit: 10 });

		const detailResult = await executeQueryEngine(client, detailDoc);
		const podcastRow = detailResult.data.items[0];
		assertPresent(podcastRow, "Expected podcast row");
		const episodes = requireQueryEngineIncludeValue(podcastRow, "episodes");
		expect(
			episodes.items.map((episode) => requireQueryEngineFieldValue(episode, "episodeNumber").value),
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
	});

	it("derives podcast fully-watched and currently-watching from per-episode state", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema: podcastSchema } = await findBuiltinSchemaBySlug(client, "podcast");
		const podcastEpisodeSchemaId = await getBuiltinEntitySchemaId("podcast-episode");
		const relationshipSchemas = await listRelationshipSchemas(client, {
			slugs: ["podcast-to-podcast-episode"],
		});
		const podcastEpisodeRelationship = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"podcast-to-podcast-episode",
		);
		const episodeEvents = await listEventSchemas(client, podcastEpisodeSchemaId);
		const episodeProgressSchema = requireEventSchemaBySlug(episodeEvents, "progress");
		const episodeCompleteSchema = requireEventSchemaBySlug(episodeEvents, "complete");
		const podcastEvents = await listEventSchemas(client, podcastSchema.id);
		const podcastCompleteSchema = requireEventSchemaBySlug(podcastEvents, "complete");

		const fixtureSuffix = crypto.randomUUID();
		const podcast = await seedMediaEntity({
			userId: null,
			sandboxScriptId: null,
			name: "Derivation Podcast",
			entitySchemaId: podcastSchema.id,
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
		const firstEpisode = await seedMediaEntity({
			userId: null,
			name: "Episode One",
			sandboxScriptId: null,
			entitySchemaId: podcastEpisodeSchemaId,
			externalId: `podcast-episode-1-${fixtureSuffix}`,
			properties: { runtime: 30, episodeNumber: 1, publishDate: null, description: "First" },
		});
		const secondEpisode = await seedMediaEntity({
			userId: null,
			name: "Episode Two",
			sandboxScriptId: null,
			entitySchemaId: podcastEpisodeSchemaId,
			externalId: `podcast-episode-2-${fixtureSuffix}`,
			properties: { runtime: 40, episodeNumber: 2, publishDate: null, description: "Second" },
		});

		await insertGlobalRelationship({
			sourceEntityId: podcast.id,
			targetEntityId: firstEpisode.id,
			relationshipSchemaId: podcastEpisodeRelationship.id,
		});
		await insertGlobalRelationship({
			sourceEntityId: podcast.id,
			targetEntityId: secondEpisode.id,
			relationshipSchemaId: podcastEpisodeRelationship.id,
		});

		await createQueryEngineEvent(client, {
			entityId: firstEpisode.id,
			occurredAt: "2026-06-25T00:00:00.000Z",
			eventSchemaId: episodeProgressSchema.id,
			properties: { progressPercent: 100, consumedOn: "Audiobookshelf" },
		});
		await waitForEventCount(client, firstEpisode.id, 2);

		const currentlyWatchingDoc = buildInProgressPodcastsQueryDocument({
			entityId: podcast.id,
			limit: 10,
		});
		const fullyWatchedDoc = buildCompletedPodcastsQueryDocument({
			entityId: podcast.id,
			limit: 10,
		});

		const phaseOneCurrentlyWatching = await executeQueryEngine(client, currentlyWatchingDoc);
		expect(phaseOneCurrentlyWatching.data.items).toHaveLength(1);
		const phaseOneFullyWatched = await executeQueryEngine(client, fullyWatchedDoc);
		expect(phaseOneFullyWatched.data.items).toHaveLength(0);

		await createQueryEngineEvent(client, {
			entityId: secondEpisode.id,
			eventSchemaId: episodeCompleteSchema.id,
			properties: { completionMode: "unknown" },
		});

		const phaseTwoCurrentlyWatching = await executeQueryEngine(client, currentlyWatchingDoc);
		expect(phaseTwoCurrentlyWatching.data.items).toHaveLength(1);
		const phaseTwoFullyWatched = await executeQueryEngine(client, fullyWatchedDoc);
		expect(phaseTwoFullyWatched.data.items).toHaveLength(1);

		await createQueryEngineEvent(client, {
			entityId: podcast.id,
			eventSchemaId: podcastCompleteSchema.id,
			properties: { completionMode: "unknown" },
		});

		const phaseThreeCurrentlyWatching = await executeQueryEngine(client, currentlyWatchingDoc);
		expect(phaseThreeCurrentlyWatching.data.items).toHaveLength(0);
		const phaseThreeFullyWatched = await executeQueryEngine(client, fullyWatchedDoc);
		expect(phaseThreeFullyWatched.data.items).toHaveLength(1);
	});
});
