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
	propertyRef,
	requireEventSchemaBySlug,
	requireRelationshipSchemaBySlug,
	seasonEpisodeSource,
	seedMediaEntity,
	showEpisodeEventExistsSource,
	showSeasonSource,
	systemRef,
} from "../fixtures";

const completedRegularSeasonSource = (aliasSuffix: string) =>
	showSeasonSource(`seasonCompleted${aliasSuffix}`, {
		type: "and" as const,
		values: [
			{
				operator: "gt" as const,
				type: "comparison" as const,
				right: { type: "literal" as const, value: 0 },
				left: propertyRef(`seasonCompleted${aliasSuffix}`, "show-season", "seasonNumber"),
			},
			{
				operator: "eq" as const,
				type: "comparison" as const,
				left: {
					type: "aggregate" as const,
					aggregation: { function: "count" as const },
					source: seasonEpisodeSource(
						`seasonCompleted${aliasSuffix}`,
						`completedEpisode${aliasSuffix}`,
						{
							type: "exists" as const,
							source: showEpisodeEventExistsSource(`completedEpisode${aliasSuffix}`, "complete"),
						},
					),
				},
				right: {
					type: "aggregate" as const,
					aggregation: { function: "count" as const },
					source: seasonEpisodeSource(
						`seasonCompleted${aliasSuffix}`,
						`allEpisode${aliasSuffix}`,
						null,
					),
				},
			},
		],
	});

describe("Relationship includes", () => {
	it("derives show fully-watched from per-episode completion across multi-episode seasons", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema: showSchema } = await findBuiltinSchemaBySlug(client, "show");
		const showSeasonSchemaId = await getBuiltinEntitySchemaId("show-season");
		const showEpisodeSchemaId = await getBuiltinEntitySchemaId("show-episode");
		const relationshipSchemas = await listRelationshipSchemas(client, {
			slugs: ["show-to-show-season", "show-season-to-show-episode"],
		});
		const showSeasonRelationship = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"show-to-show-season",
		);
		const seasonEpisodeRelationship = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"show-season-to-show-episode",
		);
		const episodeEvents = await listEventSchemas(client, showEpisodeSchemaId);
		const episodeCompleteSchema = requireEventSchemaBySlug(episodeEvents, "complete");

		const fixtureSuffix = crypto.randomUUID();
		const show = await seedMediaEntity({
			image: null,
			userId: null,
			sandboxScriptId: null,
			entitySchemaId: showSchema.id,
			externalId: `show-${fixtureSuffix}`,
			name: "Multi-Episode Derivation Show",
			properties: {
				images: [],
				genres: [],
				isNsfw: null,
				sourceUrl: null,
				totalSeasons: 2,
				totalEpisodes: 3,
				description: null,
				publishYear: null,
				publishDate: null,
				providerRating: null,
				productionStatus: null,
			},
		});
		const specialSeason = await seedMediaEntity({
			image: null,
			userId: null,
			name: "Specials",
			sandboxScriptId: null,
			entitySchemaId: showSeasonSchemaId,
			externalId: `season-0-${fixtureSuffix}`,
			properties: { seasonNumber: 0, description: "Specials", releaseDate: null },
		});
		const firstSeason = await seedMediaEntity({
			image: null,
			userId: null,
			name: "Season 1",
			sandboxScriptId: null,
			entitySchemaId: showSeasonSchemaId,
			externalId: `season-1-${fixtureSuffix}`,
			properties: { seasonNumber: 1, description: "First", releaseDate: null },
		});
		const specialEpisode = await seedMediaEntity({
			image: null,
			userId: null,
			sandboxScriptId: null,
			name: "Special Episode",
			entitySchemaId: showEpisodeSchemaId,
			externalId: `episode-0-1-${fixtureSuffix}`,
			properties: {
				runtime: 10,
				seasonNumber: 0,
				episodeNumber: 1,
				publishDate: null,
				description: "Special",
			},
		});
		const firstSeasonEpisodeOne = await seedMediaEntity({
			image: null,
			userId: null,
			sandboxScriptId: null,
			name: "Season 1 Episode One",
			entitySchemaId: showEpisodeSchemaId,
			externalId: `episode-1-1-${fixtureSuffix}`,
			properties: {
				runtime: 45,
				seasonNumber: 1,
				episodeNumber: 1,
				publishDate: null,
				description: "First",
			},
		});
		const firstSeasonEpisodeTwo = await seedMediaEntity({
			image: null,
			userId: null,
			sandboxScriptId: null,
			name: "Season 1 Episode Two",
			entitySchemaId: showEpisodeSchemaId,
			externalId: `episode-1-2-${fixtureSuffix}`,
			properties: {
				runtime: 50,
				seasonNumber: 1,
				episodeNumber: 2,
				publishDate: null,
				description: "Second",
			},
		});

		await insertGlobalRelationship({
			sourceEntityId: show.id,
			targetEntityId: specialSeason.id,
			relationshipSchemaId: showSeasonRelationship.id,
		});
		await insertGlobalRelationship({
			sourceEntityId: show.id,
			targetEntityId: firstSeason.id,
			relationshipSchemaId: showSeasonRelationship.id,
		});
		await insertGlobalRelationship({
			sourceEntityId: specialSeason.id,
			targetEntityId: specialEpisode.id,
			relationshipSchemaId: seasonEpisodeRelationship.id,
		});
		await insertGlobalRelationship({
			sourceEntityId: firstSeason.id,
			targetEntityId: firstSeasonEpisodeOne.id,
			relationshipSchemaId: seasonEpisodeRelationship.id,
		});
		await insertGlobalRelationship({
			sourceEntityId: firstSeason.id,
			targetEntityId: firstSeasonEpisodeTwo.id,
			relationshipSchemaId: seasonEpisodeRelationship.id,
		});

		await createQueryEngineEvent(client, {
			entityId: specialEpisode.id,
			eventSchemaId: episodeCompleteSchema.id,
			properties: { completionMode: "unknown" },
		});
		await createQueryEngineEvent(client, {
			entityId: firstSeasonEpisodeOne.id,
			eventSchemaId: episodeCompleteSchema.id,
			properties: { completionMode: "unknown" },
		});

		const showNameWhere = {
			operator: "eq" as const,
			type: "comparison" as const,
			left: systemRef("show", "id"),
			right: { type: "literal" as const, value: show.id },
		};
		const fullyWatchedDoc = buildRowsDoc({
			limit: 10,
			alias: "show",
			schemas: ["show"],
			fields: [{ key: "name", expr: systemRef("show", "name") }],
			source: {
				alias: "show",
				type: "entities",
				schemas: ["show"],
				where: {
					type: "and" as const,
					values: [
						showNameWhere,
						{
							operator: "eq" as const,
							type: "comparison" as const,
							left: {
								type: "aggregate" as const,
								aggregation: { function: "count" as const },
								source: completedRegularSeasonSource("Filter"),
							},
							right: {
								type: "aggregate" as const,
								aggregation: { function: "count" as const },
								source: showSeasonSource("seasonRegularFilter", {
									operator: "gt" as const,
									type: "comparison" as const,
									right: { type: "literal" as const, value: 0 },
									left: propertyRef("seasonRegularFilter", "show-season", "seasonNumber"),
								}),
							},
						},
					],
				},
			},
		});

		const incompleteResult = await executeQueryEngine(client, fullyWatchedDoc);
		expect(incompleteResult.data.items).toHaveLength(0);

		await createQueryEngineEvent(client, {
			entityId: firstSeasonEpisodeTwo.id,
			eventSchemaId: episodeCompleteSchema.id,
			properties: { completionMode: "unknown" },
		});

		const completeResult = await executeQueryEngine(client, fullyWatchedDoc);
		expect(completeResult.data.items).toHaveLength(1);
	});
});
