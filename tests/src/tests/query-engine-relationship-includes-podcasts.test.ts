import { describe, expect, it } from "bun:test";

import {
	buildRowsDoc,
	createAuthenticatedClient,
	createQueryEngineEvent,
	executeQueryEngine,
	findBuiltinSchemaBySlug,
	getBuiltinEntitySchemaId,
	insertGlobalRelationship,
	listEventSchemas,
	listRelationshipSchemas,
	podcastEpisodeSource,
	propertyRef,
	requireEventSchemaBySlug,
	requireQueryEngineFieldValue,
	requireQueryEngineIncludeValue,
	requireRelationshipSchemaBySlug,
	seedMediaEntity,
	showEpisodeEventExistsSource,
	systemRef,
	waitForEventCount,
} from "../fixtures";
import { assertPresent } from "../test-support/assertions";

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
			image: null,
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
			image: null,
			userId: null,
			name: "Episode Two",
			sandboxScriptId: null,
			entitySchemaId: podcastEpisodeSchemaId,
			externalId: `podcast-episode-2-${fixtureSuffix}`,
			properties: { runtime: 40, episodeNumber: 2, publishDate: null, description: "Second" },
		});
		const firstEpisode = await seedMediaEntity({
			image: null,
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

		const podcastIdWhere = {
			operator: "eq" as const,
			type: "comparison" as const,
			left: systemRef("podcast", "id"),
			right: { type: "literal" as const, value: podcast.id },
		};
		const detailDoc = buildRowsDoc({
			limit: 1,
			alias: "podcast",
			schemas: ["podcast"],
			fields: [{ key: "name", expr: systemRef("podcast", "name") }],
			source: { alias: "podcast", type: "entities", schemas: ["podcast"], where: podcastIdWhere },
			output: {
				type: "rows",
				pagination: { page: 1, limit: 1 },
				fields: [{ key: "name", expr: systemRef("podcast", "name") }],
				orderBy: [{ order: "asc", expr: systemRef("podcast", "name") }],
				include: [
					{
						limit: 10,
						key: "episodes",
						orderBy: [
							{ order: "asc", expr: propertyRef("episode", "podcast-episode", "episodeNumber") },
						],
						fields: [
							{ key: "name", expr: systemRef("episode", "name") },
							{
								key: "episodeNumber",
								expr: propertyRef("episode", "podcast-episode", "episodeNumber"),
							},
							{
								key: "hasProgress",
								expr: {
									type: "exists",
									source: showEpisodeEventExistsSource("episode", "progress"),
								},
							},
							{
								key: "isComplete",
								expr: {
									type: "exists",
									source: showEpisodeEventExistsSource("episode", "complete"),
								},
							},
						],
						source: {
							where: null,
							alias: "episode",
							type: "entities",
							schemas: ["podcast-episode"],
							via: {
								entityRef: "podcast",
								direction: "outgoing",
								alias: "podcastEpisode",
								schema: "podcast-to-podcast-episode",
							},
						},
					},
				],
			},
		});

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
			image: null,
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
			image: null,
			userId: null,
			name: "Episode One",
			sandboxScriptId: null,
			entitySchemaId: podcastEpisodeSchemaId,
			externalId: `podcast-episode-1-${fixtureSuffix}`,
			properties: { runtime: 30, episodeNumber: 1, publishDate: null, description: "First" },
		});
		const secondEpisode = await seedMediaEntity({
			image: null,
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

		const podcastIdWhere = {
			operator: "eq" as const,
			type: "comparison" as const,
			left: systemRef("podcast", "id"),
			right: { type: "literal" as const, value: podcast.id },
		};
		const currentlyWatchingDoc = buildRowsDoc({
			limit: 10,
			alias: "podcast",
			schemas: ["podcast"],
			fields: [{ key: "name", expr: systemRef("podcast", "name") }],
			source: {
				alias: "podcast",
				type: "entities",
				schemas: ["podcast"],
				where: {
					type: "and" as const,
					values: [
						podcastIdWhere,
						{
							type: "not" as const,
							expr: {
								type: "exists" as const,
								source: {
									where: null,
									type: "events" as const,
									entityRef: "podcast",
									schemas: ["complete"],
									alias: "podcastCompletion",
								},
							},
						},
						{
							type: "exists" as const,
							source: podcastEpisodeSource("episodeWatching", {
								type: "exists" as const,
								source: showEpisodeEventExistsSource("episodeWatching", "progress"),
							}),
						},
					],
				},
			},
		});
		const fullyWatchedDoc = buildRowsDoc({
			limit: 10,
			alias: "podcast",
			schemas: ["podcast"],
			fields: [{ key: "name", expr: systemRef("podcast", "name") }],
			source: {
				alias: "podcast",
				type: "entities",
				schemas: ["podcast"],
				where: {
					type: "and" as const,
					values: [
						podcastIdWhere,
						{
							operator: "eq" as const,
							type: "comparison" as const,
							left: {
								type: "aggregate" as const,
								aggregation: { function: "count" as const },
								source: podcastEpisodeSource("completedEpisode", {
									type: "exists" as const,
									source: showEpisodeEventExistsSource("completedEpisode", "complete"),
								}),
							},
							right: {
								type: "aggregate" as const,
								aggregation: { function: "count" as const },
								source: podcastEpisodeSource("allEpisode", null),
							},
						},
					],
				},
			},
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
