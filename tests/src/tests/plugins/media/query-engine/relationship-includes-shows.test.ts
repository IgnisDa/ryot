import {
	buildCompletedShowsQueryDocument,
	buildInProgressShowsQueryDocument,
	buildShowDetailQueryDocument,
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
	it.live("returns builtin show seasons and episodes with derived episode state", () =>
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
			const episodeProgressSchema = requireEventSchemaBySlug(episodeEvents, "progress");
			const episodeCompleteSchema = requireEventSchemaBySlug(episodeEvents, "complete");

			const fixtureSuffix = crypto.randomUUID();
			const show = yield* seedMediaEntity({
				userId: null,
				providerId: null,
				name: "Episodic Test Show",
				entitySchemaSlug: showSchema.id,
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
			const secondSeason = yield* seedMediaEntity({
				userId: null,
				name: "Season 2",
				providerId: null,
				entitySchemaSlug: showSeasonSchemaId,
				externalId: `season-2-${fixtureSuffix}`,
				properties: { seasonNumber: 2, description: "Second", releaseDate: null },
			});
			const specialEpisode = yield* seedMediaEntity({
				userId: null,
				name: "Special Episode",
				providerId: null,
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
			const firstEpisode = yield* seedMediaEntity({
				userId: null,
				name: "Episode One",
				providerId: null,
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
			const secondEpisode = yield* seedMediaEntity({
				userId: null,
				name: "Episode Two",
				providerId: null,
				entitySchemaSlug: showEpisodeSchemaId,
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
				relationshipSchemaSlug: showSeasonRelationship.id,
			});
			yield* insertGlobalRelationship({
				sourceEntityId: show.id,
				targetEntityId: firstSeason.id,
				relationshipSchemaSlug: showSeasonRelationship.id,
			});
			yield* insertGlobalRelationship({
				sourceEntityId: show.id,
				targetEntityId: secondSeason.id,
				relationshipSchemaSlug: showSeasonRelationship.id,
			});
			yield* insertGlobalRelationship({
				sourceEntityId: specialSeason.id,
				targetEntityId: specialEpisode.id,
				relationshipSchemaSlug: seasonEpisodeRelationship.id,
			});
			yield* insertGlobalRelationship({
				sourceEntityId: firstSeason.id,
				targetEntityId: firstEpisode.id,
				relationshipSchemaSlug: seasonEpisodeRelationship.id,
			});
			yield* insertGlobalRelationship({
				sourceEntityId: secondSeason.id,
				targetEntityId: secondEpisode.id,
				relationshipSchemaSlug: seasonEpisodeRelationship.id,
			});

			yield* createQueryEngineEvent(client, {
				entityId: firstEpisode.id,
				eventSchemaSlug: episodeProgressSchema.id,
				occurredAt: "2026-06-25T00:00:00.000Z",
				properties: { progressPercent: 100, consumedOn: "Jellyfin" },
			});
			yield* waitForEventCount(client, firstEpisode.id, 2);
			yield* createQueryEngineEvent(client, {
				entityId: secondEpisode.id,
				eventSchemaSlug: episodeCompleteSchema.id,
				properties: { completionMode: "unknown" },
			});
			yield* createQueryEngineEvent(client, {
				entityId: specialEpisode.id,
				eventSchemaSlug: episodeCompleteSchema.id,
				properties: { completionMode: "unknown" },
			});

			const detailDoc = buildShowDetailQueryDocument({
				entityId: show.id,
				seasonLimit: 10,
				episodeLimit: 10,
			});

			const detailResult = yield* executeRyotQL(client, detailDoc);
			const showResult = detailResult.data.show;
			if (showResult?.type !== "rows") {
				throw new Error("Expected show rows result");
			}
			const showRow = showResult.items[0];
			assertPresent(showRow, "Expected show row");
			const seasons = showRow.seasons;
			if (!seasons || !("items" in seasons)) {
				throw new Error("Expected seasons include");
			}
			expect(
				seasons.items.map((season) => requireRyotQLFieldValue(season, "seasonNumber").value),
			).toEqual([0, 1, 2]);
			const firstSeasonRow = seasons.items[1];
			assertPresent(firstSeasonRow, "Expected first regular season row");
			const firstSeasonEpisodes = firstSeasonRow.episodes;
			if (!firstSeasonEpisodes || !("items" in firstSeasonEpisodes)) {
				throw new Error("Expected episodes include");
			}
			const firstEpisodeRow = firstSeasonEpisodes.items[0];
			assertPresent(firstEpisodeRow, "Expected first episode row");
			expect(requireRyotQLFieldValue(firstEpisodeRow, "name").value).toBe("Episode One");
			expect(requireRyotQLFieldValue(firstEpisodeRow, "hasProgress")).toEqual({
				value: true,
				kind: "boolean",
			});
			expect(requireRyotQLFieldValue(firstEpisodeRow, "isComplete")).toEqual({
				value: true,
				kind: "boolean",
			});

			const currentlyWatchingDoc = buildInProgressShowsQueryDocument({
				limit: 10,
				entityId: show.id,
			});
			const currentlyWatchingResult = yield* executeRyotQL(client, currentlyWatchingDoc);
			if (currentlyWatchingResult.data.shows?.type !== "rows") {
				throw new Error("Expected in-progress show rows result");
			}
			expect(currentlyWatchingResult.data.shows.items).toHaveLength(1);

			const fullyWatchedDoc = buildCompletedShowsQueryDocument({ entityId: show.id, limit: 10 });
			const fullyWatchedResult = yield* executeRyotQL(client, fullyWatchedDoc);
			if (fullyWatchedResult.data.shows?.type !== "rows") {
				throw new Error("Expected completed show rows result");
			}
			expect(fullyWatchedResult.data.shows.items).toHaveLength(1);
		}),
	);
});
