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
	requireQueryEngineFieldValue,
	requireQueryEngineIncludeValue,
	requireRelationshipSchemaBySlug,
	seedMediaEntity,
	showEpisodeEventExistsSource,
	showSeasonSource,
	systemRef,
	waitForEventCount,
} from "../fixtures";
import { assertPresent } from "../test-support/assertions";

const completedRegularSeasonSource = (aliasSuffix: string) =>
	showSeasonSource(`seasonCompleted${aliasSuffix}`, {
		type: "and",
		values: [
			{
				operator: "gt",
				type: "comparison",
				right: { type: "literal", value: 0 },
				left: propertyRef(`seasonCompleted${aliasSuffix}`, "show-season", "seasonNumber"),
			},
			{
				type: "exists",
				source: {
					type: "entities",
					schemas: ["show-episode"],
					alias: `episodeCompleted${aliasSuffix}`,
					via: {
						direction: "outgoing",
						schema: "show-season-to-show-episode",
						entityRef: `seasonCompleted${aliasSuffix}`,
						alias: `seasonEpisodeCompleted${aliasSuffix}`,
					},
					where: {
						type: "exists",
						source: showEpisodeEventExistsSource(`episodeCompleted${aliasSuffix}`, "complete"),
					},
				},
			},
		],
	});

describe("Relationship includes", () => {
	it("returns builtin show seasons and episodes with derived episode state", async () => {
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
		const episodeProgressSchema = requireEventSchemaBySlug(episodeEvents, "progress");
		const episodeCompleteSchema = requireEventSchemaBySlug(episodeEvents, "complete");

		const fixtureSuffix = crypto.randomUUID();
		const show = await seedMediaEntity({
			image: null,
			userId: null,
			sandboxScriptId: null,
			name: "Episodic Test Show",
			entitySchemaId: showSchema.id,
			externalId: `show-${fixtureSuffix}`,
			properties: {
				images: [],
				genres: [],
				isNsfw: null,
				sourceUrl: null,
				totalSeasons: 3,
				totalEpisodes: 2,
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
		const secondSeason = await seedMediaEntity({
			image: null,
			userId: null,
			name: "Season 2",
			sandboxScriptId: null,
			entitySchemaId: showSeasonSchemaId,
			externalId: `season-2-${fixtureSuffix}`,
			properties: { seasonNumber: 2, description: "Second", releaseDate: null },
		});
		const specialEpisode = await seedMediaEntity({
			image: null,
			userId: null,
			name: "Special Episode",
			sandboxScriptId: null,
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
		const firstEpisode = await seedMediaEntity({
			image: null,
			userId: null,
			name: "Episode One",
			sandboxScriptId: null,
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
		const secondEpisode = await seedMediaEntity({
			image: null,
			userId: null,
			name: "Episode Two",
			sandboxScriptId: null,
			entitySchemaId: showEpisodeSchemaId,
			externalId: `episode-2-1-${fixtureSuffix}`,
			properties: {
				runtime: 50,
				seasonNumber: 2,
				episodeNumber: 1,
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
			sourceEntityId: show.id,
			targetEntityId: secondSeason.id,
			relationshipSchemaId: showSeasonRelationship.id,
		});
		await insertGlobalRelationship({
			sourceEntityId: specialSeason.id,
			targetEntityId: specialEpisode.id,
			relationshipSchemaId: seasonEpisodeRelationship.id,
		});
		await insertGlobalRelationship({
			sourceEntityId: firstSeason.id,
			targetEntityId: firstEpisode.id,
			relationshipSchemaId: seasonEpisodeRelationship.id,
		});
		await insertGlobalRelationship({
			sourceEntityId: secondSeason.id,
			targetEntityId: secondEpisode.id,
			relationshipSchemaId: seasonEpisodeRelationship.id,
		});

		await createQueryEngineEvent(client, {
			entityId: firstEpisode.id,
			eventSchemaId: episodeProgressSchema.id,
			occurredAt: "2026-06-25T00:00:00.000Z",
			properties: { progressPercent: 100, consumedOn: "Jellyfin" },
		});
		await waitForEventCount(client, firstEpisode.id, 2);
		await createQueryEngineEvent(client, {
			entityId: secondEpisode.id,
			eventSchemaId: episodeCompleteSchema.id,
			properties: { completionMode: "unknown" },
		});
		await createQueryEngineEvent(client, {
			entityId: specialEpisode.id,
			eventSchemaId: episodeCompleteSchema.id,
			properties: { completionMode: "unknown" },
		});

		const showNameWhere = {
			operator: "eq" as const,
			type: "comparison" as const,
			left: systemRef("show", "id"),
			right: { type: "literal" as const, value: show.id },
		};
		const detailDoc = buildRowsDoc({
			limit: 1,
			alias: "show",
			schemas: ["show"],
			fields: [{ key: "name", expr: systemRef("show", "name") }],
			source: { alias: "show", type: "entities", schemas: ["show"], where: showNameWhere },
			output: {
				type: "rows",
				pagination: { page: 1, limit: 1 },
				fields: [{ key: "name", expr: systemRef("show", "name") }],
				orderBy: [{ order: "asc", expr: systemRef("show", "name") }],
				include: [
					{
						limit: 10,
						key: "seasons",
						fields: [
							{ key: "name", expr: systemRef("season", "name") },
							{ key: "seasonNumber", expr: propertyRef("season", "show-season", "seasonNumber") },
						],
						orderBy: [{ order: "asc", expr: propertyRef("season", "show-season", "seasonNumber") }],
						source: {
							where: null,
							alias: "season",
							type: "entities",
							schemas: ["show-season"],
							via: {
								entityRef: "show",
								alias: "showSeason",
								direction: "outgoing",
								schema: "show-to-show-season",
							},
						},
						include: [
							{
								limit: 10,
								key: "episodes",
								orderBy: [
									{ order: "asc", expr: propertyRef("episode", "show-episode", "episodeNumber") },
								],
								fields: [
									{ key: "name", expr: systemRef("episode", "name") },
									{
										key: "episodeNumber",
										expr: propertyRef("episode", "show-episode", "episodeNumber"),
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
									schemas: ["show-episode"],
									via: {
										entityRef: "season",
										direction: "outgoing",
										alias: "seasonEpisode",
										schema: "show-season-to-show-episode",
									},
								},
							},
						],
					},
				],
			},
		});

		const detailResult = await executeQueryEngine(client, detailDoc);
		const showRow = detailResult.data.items[0];
		assertPresent(showRow, "Expected show row");
		const seasons = requireQueryEngineIncludeValue(showRow, "seasons");
		expect(
			seasons.items.map((season) => requireQueryEngineFieldValue(season, "seasonNumber").value),
		).toEqual([0, 1, 2]);
		const firstSeasonRow = seasons.items[1];
		assertPresent(firstSeasonRow, "Expected first regular season row");
		const firstSeasonEpisodes = requireQueryEngineIncludeValue(firstSeasonRow, "episodes");
		const firstEpisodeRow = firstSeasonEpisodes.items[0];
		assertPresent(firstEpisodeRow, "Expected first episode row");
		expect(requireQueryEngineFieldValue(firstEpisodeRow, "name").value).toBe("Episode One");
		expect(requireQueryEngineFieldValue(firstEpisodeRow, "hasProgress")).toEqual({
			kind: "boolean",
			value: true,
		});
		expect(requireQueryEngineFieldValue(firstEpisodeRow, "isComplete")).toEqual({
			kind: "boolean",
			value: true,
		});

		const currentlyWatchingDoc = buildRowsDoc({
			limit: 10,
			alias: "show",
			schemas: ["show"],
			fields: [{ key: "name", expr: systemRef("show", "name") }],
			source: {
				alias: "show",
				type: "entities",
				schemas: ["show"],
				where: {
					type: "and",
					values: [
						showNameWhere,
						{
							type: "not",
							expr: {
								type: "exists",
								source: {
									where: null,
									type: "events",
									entityRef: "show",
									schemas: ["complete"],
									alias: "showCompletion",
								},
							},
						},
						{
							type: "exists",
							source: showSeasonSource("seasonWatching", {
								type: "exists",
								source: {
									type: "entities",
									alias: "episodeWatching",
									schemas: ["show-episode"],
									where: {
										type: "exists",
										source: showEpisodeEventExistsSource("episodeWatching", "progress"),
									},
									via: {
										direction: "outgoing",
										entityRef: "seasonWatching",
										alias: "seasonEpisodeWatching",
										schema: "show-season-to-show-episode",
									},
								},
							}),
						},
					],
				},
			},
		});
		const currentlyWatchingResult = await executeQueryEngine(client, currentlyWatchingDoc);
		expect(currentlyWatchingResult.data.items).toHaveLength(1);

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
					type: "and",
					values: [
						showNameWhere,
						{
							operator: "eq",
							type: "comparison",
							left: {
								type: "aggregate",
								aggregation: { function: "count" },
								source: completedRegularSeasonSource("Filter"),
							},
							right: {
								type: "aggregate",
								aggregation: { function: "count" },
								source: showSeasonSource("seasonRegularFilter", {
									operator: "gt",
									type: "comparison",
									right: { type: "literal", value: 0 },
									left: propertyRef("seasonRegularFilter", "show-season", "seasonNumber"),
								}),
							},
						},
					],
				},
			},
		});
		const fullyWatchedResult = await executeQueryEngine(client, fullyWatchedDoc);
		expect(fullyWatchedResult.data.items).toHaveLength(1);
	});
});
