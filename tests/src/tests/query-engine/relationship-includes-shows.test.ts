import {
	buildCompletedShowsQueryDocument,
	buildInProgressShowsQueryDocument,
	buildShowDetailQueryDocument,
} from "@ryot/query-engine";
import { Effect } from "effect";

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
import { describe, expect, it } from "~/support/effect-test";

describe("Relationship includes", () => {
	it.live("returns builtin show seasons and episodes with derived episode state", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: showSchema } = yield* findBuiltinSchemaBySlug(client, "show");
			const showSeasonSchemaId = yield* getBuiltinEntitySchemaId("show-season");
			const showEpisodeSchemaId = yield* getBuiltinEntitySchemaId("show-episode");
			const relationshipSchemas = yield* listRelationshipSchemas(client, {
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
			const episodeEvents = yield* listEventSchemas(client, showEpisodeSchemaId);
			const episodeProgressSchema = requireEventSchemaBySlug(episodeEvents, "progress");
			const episodeCompleteSchema = requireEventSchemaBySlug(episodeEvents, "complete");

			const fixtureSuffix = crypto.randomUUID();
			const show = yield* seedMediaEntity({
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
			const specialSeason = yield* seedMediaEntity({
				userId: null,
				name: "Specials",
				sandboxScriptId: null,
				entitySchemaId: showSeasonSchemaId,
				externalId: `season-0-${fixtureSuffix}`,
				properties: { seasonNumber: 0, description: "Specials", releaseDate: null },
			});
			const firstSeason = yield* seedMediaEntity({
				userId: null,
				name: "Season 1",
				sandboxScriptId: null,
				entitySchemaId: showSeasonSchemaId,
				externalId: `season-1-${fixtureSuffix}`,
				properties: { seasonNumber: 1, description: "First", releaseDate: null },
			});
			const secondSeason = yield* seedMediaEntity({
				userId: null,
				name: "Season 2",
				sandboxScriptId: null,
				entitySchemaId: showSeasonSchemaId,
				externalId: `season-2-${fixtureSuffix}`,
				properties: { seasonNumber: 2, description: "Second", releaseDate: null },
			});
			const specialEpisode = yield* seedMediaEntity({
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
			const firstEpisode = yield* seedMediaEntity({
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
			const secondEpisode = yield* seedMediaEntity({
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

			yield* insertGlobalRelationship({
				sourceEntityId: show.id,
				targetEntityId: specialSeason.id,
				relationshipSchemaId: showSeasonRelationship.id,
			});
			yield* insertGlobalRelationship({
				sourceEntityId: show.id,
				targetEntityId: firstSeason.id,
				relationshipSchemaId: showSeasonRelationship.id,
			});
			yield* insertGlobalRelationship({
				sourceEntityId: show.id,
				targetEntityId: secondSeason.id,
				relationshipSchemaId: showSeasonRelationship.id,
			});
			yield* insertGlobalRelationship({
				sourceEntityId: specialSeason.id,
				targetEntityId: specialEpisode.id,
				relationshipSchemaId: seasonEpisodeRelationship.id,
			});
			yield* insertGlobalRelationship({
				sourceEntityId: firstSeason.id,
				targetEntityId: firstEpisode.id,
				relationshipSchemaId: seasonEpisodeRelationship.id,
			});
			yield* insertGlobalRelationship({
				sourceEntityId: secondSeason.id,
				targetEntityId: secondEpisode.id,
				relationshipSchemaId: seasonEpisodeRelationship.id,
			});

			yield* createQueryEngineEvent(client, {
				entityId: firstEpisode.id,
				eventSchemaId: episodeProgressSchema.id,
				occurredAt: "2026-06-25T00:00:00.000Z",
				properties: { progressPercent: 100, consumedOn: "Jellyfin" },
			});
			yield* waitForEventCount(client, firstEpisode.id, 2);
			yield* createQueryEngineEvent(client, {
				entityId: secondEpisode.id,
				eventSchemaId: episodeCompleteSchema.id,
				properties: { completionMode: "unknown" },
			});
			yield* createQueryEngineEvent(client, {
				entityId: specialEpisode.id,
				eventSchemaId: episodeCompleteSchema.id,
				properties: { completionMode: "unknown" },
			});

			const detailDoc = buildShowDetailQueryDocument({
				entityId: show.id,
				seasonLimit: 10,
				episodeLimit: 10,
			});

			const detailResult = yield* executeQueryEngine(client, detailDoc);
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

			const currentlyWatchingDoc = buildInProgressShowsQueryDocument({
				entityId: show.id,
				limit: 10,
			});
			const currentlyWatchingResult = yield* executeQueryEngine(client, currentlyWatchingDoc);
			expect(currentlyWatchingResult.data.items).toHaveLength(1);

			const fullyWatchedDoc = buildCompletedShowsQueryDocument({ entityId: show.id, limit: 10 });
			const fullyWatchedResult = yield* executeQueryEngine(client, fullyWatchedDoc);
			expect(fullyWatchedResult.data.items).toHaveLength(1);
		}),
	);
});
