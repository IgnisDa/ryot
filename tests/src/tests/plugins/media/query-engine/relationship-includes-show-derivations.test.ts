import { buildCompletedShowsQueryDocument } from "@ryot/plugin-media/query-recipes";
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
	requireRelationshipSchemaBySlug,
	seedMediaEntity,
} from "~/fixtures";
import { describe, expect, it } from "~/support/effect-test";

describe("Relationship includes", () => {
	it.live(
		"derives show fully-watched from per-episode completion across multi-episode seasons",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { schema: showSchema } = yield* findBuiltinSchemaBySlug(client, "show");
				const showSeasonSchemaId = yield* getBuiltinEntitySchemaSlug("show-season");
				const showEpisodeSchemaId = yield* getBuiltinEntitySchemaSlug("show-episode");
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
				const episodeCompleteSchema = requireEventSchemaBySlug(episodeEvents, "complete");

				const fixtureSuffix = crypto.randomUUID();
				const show = yield* seedMediaEntity({
					userId: null,
					providerId: null,
					entitySchemaSlug: showSchema.id,
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
				const specialSeason = yield* seedMediaEntity({
					userId: null,
					name: "Specials",
					providerId: null,
					entitySchemaSlug: showSeasonSchemaId,
					externalId: `season-0-${fixtureSuffix}`,
					properties: { seasonNumber: 0, description: "Specials", releaseDate: null },
				});
				const firstSeason = yield* seedMediaEntity({
					userId: null,
					name: "Season 1",
					providerId: null,
					entitySchemaSlug: showSeasonSchemaId,
					externalId: `season-1-${fixtureSuffix}`,
					properties: { seasonNumber: 1, description: "First", releaseDate: null },
				});
				const specialEpisode = yield* seedMediaEntity({
					userId: null,
					providerId: null,
					name: "Special Episode",
					entitySchemaSlug: showEpisodeSchemaId,
					externalId: `episode-0-1-${fixtureSuffix}`,
					properties: {
						runtime: 10,
						seasonNumber: 0,
						episodeNumber: 1,
						publishDate: null,
						description: "Special",
					},
				});
				const firstSeasonEpisodeOne = yield* seedMediaEntity({
					userId: null,
					providerId: null,
					name: "Season 1 Episode One",
					entitySchemaSlug: showEpisodeSchemaId,
					externalId: `episode-1-1-${fixtureSuffix}`,
					properties: {
						runtime: 45,
						seasonNumber: 1,
						episodeNumber: 1,
						publishDate: null,
						description: "First",
					},
				});
				const firstSeasonEpisodeTwo = yield* seedMediaEntity({
					userId: null,
					providerId: null,
					name: "Season 1 Episode Two",
					entitySchemaSlug: showEpisodeSchemaId,
					externalId: `episode-1-2-${fixtureSuffix}`,
					properties: {
						runtime: 50,
						seasonNumber: 1,
						episodeNumber: 2,
						publishDate: null,
						description: "Second",
					},
				});

				yield* insertGlobalRelationship({
					sourceEntityId: show.id,
					targetEntityId: specialSeason.id,
					relationshipSchemaSlug: showSeasonRelationship.id,
				});
				yield* insertGlobalRelationship({
					sourceEntityId: show.id,
					targetEntityId: firstSeason.id,
					relationshipSchemaSlug: showSeasonRelationship.id,
				});
				yield* insertGlobalRelationship({
					sourceEntityId: specialSeason.id,
					targetEntityId: specialEpisode.id,
					relationshipSchemaSlug: seasonEpisodeRelationship.id,
				});
				yield* insertGlobalRelationship({
					sourceEntityId: firstSeason.id,
					targetEntityId: firstSeasonEpisodeOne.id,
					relationshipSchemaSlug: seasonEpisodeRelationship.id,
				});
				yield* insertGlobalRelationship({
					sourceEntityId: firstSeason.id,
					targetEntityId: firstSeasonEpisodeTwo.id,
					relationshipSchemaSlug: seasonEpisodeRelationship.id,
				});

				yield* createQueryEngineEvent(client, {
					entityId: specialEpisode.id,
					eventSchemaSlug: episodeCompleteSchema.id,
					properties: { completionMode: "unknown" },
				});
				yield* createQueryEngineEvent(client, {
					entityId: firstSeasonEpisodeOne.id,
					eventSchemaSlug: episodeCompleteSchema.id,
					properties: { completionMode: "unknown" },
				});

				const fullyWatchedDoc = buildCompletedShowsQueryDocument({ entityId: show.id, limit: 10 });

				const incompleteResult = yield* executeQueryEngine(client, fullyWatchedDoc);
				expect(incompleteResult.data.items).toHaveLength(0);

				yield* createQueryEngineEvent(client, {
					entityId: firstSeasonEpisodeTwo.id,
					eventSchemaSlug: episodeCompleteSchema.id,
					properties: { completionMode: "unknown" },
				});

				const completeResult = yield* executeQueryEngine(client, fullyWatchedDoc);
				expect(completeResult.data.items).toHaveLength(1);
			}),
	);
});
