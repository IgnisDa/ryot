import {
	buildCompletedPodcastsQueryDocument,
	buildInProgressPodcastsQueryDocument,
	buildPodcastDetailQueryDocument,
	buildShowDetailQueryDocument,
	buildCollectionMediaSuggestionsQueryDocument,
	buildPersonalMediaSuggestionsQueryDocument,
	buildTrendingMediaQueryDocument,
} from "@ryot/media-plugin/query-recipes";
import { DateTime, Effect } from "effect";

import {
	createAuthenticatedClient,
	createCollection,
	createEventFixture,
	createGlobalBookEntityFixture,
	createRelationship,
	executeRyotQL,
	findBuiltinSchemaBySlug,
	getBuiltinEntitySchemaSlug,
	insertGlobalRelationship,
	insertLibraryMembership,
	listEventSchemas,
	listRelationshipSchemas,
	requireEventSchemaBySlug,
	requireRelationshipSchemaBySlug,
	requireRyotQLFieldValue,
	seedMediaEntity,
	type Client,
	type RyotQLResponse,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const seedPodcast = (client: Client, episodeCount: number) =>
	Effect.gen(function* () {
		const { schema: podcastSchema } = yield* findBuiltinSchemaBySlug(client, "podcast");
		const podcastEpisodeSchemaId = yield* getBuiltinEntitySchemaSlug("podcast-episode");
		const relationshipSchemas = yield* listRelationshipSchemas(client, {
			slugs: ["podcast-to-podcast-episode"],
		});
		const podcastEpisodeRelationship = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"podcast-to-podcast-episode",
		);
		const podcast = yield* seedMediaEntity({
			userId: null,
			providerId: null,
			entitySchemaSlug: podcastSchema.id,
			name: `Query Recipe Podcast ${crypto.randomUUID()}`,
			externalId: `query-recipe-podcast-${crypto.randomUUID()}`,
			properties: {
				images: [],
				genres: [],
				isNsfw: null,
				sourceUrl: null,
				description: null,
				publishYear: null,
				publishDate: null,
				providerRating: null,
				unlinkedCreators: [],
				productionStatus: null,
				totalEpisodes: episodeCount,
			},
		});
		const episodes = yield* Effect.all(
			Array.from({ length: episodeCount }, (_, index) =>
				seedMediaEntity({
					userId: null,
					providerId: null,
					name: `Podcast Episode ${index + 1}`,
					entitySchemaSlug: podcastEpisodeSchemaId,
					externalId: `query-recipe-podcast-episode-${crypto.randomUUID()}`,
					properties: {
						publishDate: null,
						runtime: 30 + index,
						episodeNumber: index + 1,
						description: `Episode ${index + 1}`,
					},
				}),
			),
		);
		yield* Effect.all(
			episodes.map((episode) =>
				insertGlobalRelationship({
					targetEntityId: episode.id,
					sourceEntityId: podcast.id,
					relationshipSchemaSlug: podcastEpisodeRelationship.id,
				}),
			),
		);
		const episodeEventSchemas = yield* listEventSchemas(client, podcastEpisodeSchemaId);
		const podcastEventSchemas = yield* listEventSchemas(client, podcastSchema.id);

		return {
			podcast,
			episodes,
			episodeProgressEventSchemaSlug: requireEventSchemaBySlug(episodeEventSchemas, "progress").id,
			episodeCompleteEventSchemaSlug: requireEventSchemaBySlug(episodeEventSchemas, "complete").id,
			podcastCompleteEventSchemaSlug: requireEventSchemaBySlug(podcastEventSchemas, "complete").id,
		};
	});

const readPodcastRows = (response: RyotQLResponse) => {
	const result = response.data.podcasts;
	if (result?.type !== "rows") {
		throw new Error("Expected podcast rows result");
	}
	return result;
};

describe("Media RyotQL query recipe results", () => {
	it.live("reconstructs show details with nested state and independent limits", () =>
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
			const episodeEventSchemas = yield* listEventSchemas(client, showEpisodeSchemaId);
			const progressEventSchema = requireEventSchemaBySlug(episodeEventSchemas, "progress");
			const completeEventSchema = requireEventSchemaBySlug(episodeEventSchemas, "complete");
			const suffix = crypto.randomUUID();
			const show = yield* seedMediaEntity({
				userId: null,
				providerId: null,
				entitySchemaSlug: showSchema.id,
				name: `Query Recipe Show ${suffix}`,
				externalId: `query-recipe-show-${suffix}`,
				properties: {
					images: [],
					genres: [],
					isNsfw: null,
					sourceUrl: null,
					totalSeasons: 3,
					totalEpisodes: 6,
					description: null,
					publishYear: null,
					publishDate: null,
					providerRating: null,
					unlinkedCreators: [],
					productionStatus: null,
				},
			});
			const [seasonOne, seasonTwo, seasonThree] = yield* Effect.all(
				[1, 2, 3].map((seasonNumber) =>
					seedMediaEntity({
						userId: null,
						providerId: null,
						name: `Season ${seasonNumber}`,
						entitySchemaSlug: showSeasonSchemaId,
						externalId: `query-recipe-season-${seasonNumber}-${suffix}`,
						properties: { seasonNumber, description: null, releaseDate: null },
					}),
				),
			);
			const episodes = yield* Effect.all(
				[1, 2, 3].flatMap((seasonNumber) =>
					[1, 2].map((episodeNumber) =>
						seedMediaEntity({
							userId: null,
							providerId: null,
							entitySchemaSlug: showEpisodeSchemaId,
							name: `Season ${seasonNumber} Episode ${episodeNumber}`,
							externalId: `query-recipe-episode-${seasonNumber}-${episodeNumber}-${suffix}`,
							properties: {
								runtime: 40,
								seasonNumber,
								episodeNumber,
								publishDate: null,
								description: null,
							},
						}),
					),
				),
			);
			const [firstEpisode, secondEpisode, thirdEpisode, fourthEpisode, fifthEpisode, sixthEpisode] =
				episodes;
			assertPresent(seasonOne, "Missing first season");
			assertPresent(seasonTwo, "Missing second season");
			assertPresent(seasonThree, "Missing third season");
			assertPresent(firstEpisode, "Missing first episode");
			assertPresent(secondEpisode, "Missing second episode");
			assertPresent(thirdEpisode, "Missing third episode");
			assertPresent(fourthEpisode, "Missing fourth episode");
			assertPresent(fifthEpisode, "Missing fifth episode");
			assertPresent(sixthEpisode, "Missing sixth episode");
			yield* Effect.all([
				insertGlobalRelationship({
					sourceEntityId: show.id,
					targetEntityId: seasonOne.id,
					relationshipSchemaSlug: showSeasonRelationship.id,
				}),
				insertGlobalRelationship({
					sourceEntityId: show.id,
					targetEntityId: seasonTwo.id,
					relationshipSchemaSlug: showSeasonRelationship.id,
				}),
				insertGlobalRelationship({
					sourceEntityId: show.id,
					targetEntityId: seasonThree.id,
					relationshipSchemaSlug: showSeasonRelationship.id,
				}),
				insertGlobalRelationship({
					sourceEntityId: seasonOne.id,
					targetEntityId: firstEpisode.id,
					relationshipSchemaSlug: seasonEpisodeRelationship.id,
				}),
				insertGlobalRelationship({
					sourceEntityId: seasonOne.id,
					targetEntityId: secondEpisode.id,
					relationshipSchemaSlug: seasonEpisodeRelationship.id,
				}),
				insertGlobalRelationship({
					sourceEntityId: seasonTwo.id,
					targetEntityId: thirdEpisode.id,
					relationshipSchemaSlug: seasonEpisodeRelationship.id,
				}),
				insertGlobalRelationship({
					sourceEntityId: seasonTwo.id,
					targetEntityId: fourthEpisode.id,
					relationshipSchemaSlug: seasonEpisodeRelationship.id,
				}),
				insertGlobalRelationship({
					sourceEntityId: seasonThree.id,
					targetEntityId: fifthEpisode.id,
					relationshipSchemaSlug: seasonEpisodeRelationship.id,
				}),
				insertGlobalRelationship({
					sourceEntityId: seasonThree.id,
					targetEntityId: sixthEpisode.id,
					relationshipSchemaSlug: seasonEpisodeRelationship.id,
				}),
			]);
			yield* createEventFixture(client, {
				entityId: firstEpisode.id,
				eventSchemaSlug: progressEventSchema.id,
				properties: { progressPercent: 50, consumedOn: "RyotQL test" },
			});
			yield* createEventFixture(client, {
				entityId: firstEpisode.id,
				eventSchemaSlug: completeEventSchema.id,
				properties: { completionMode: "unknown" },
			});

			const response = yield* executeRyotQL(
				client,
				buildShowDetailQueryDocument({ seasonLimit: 2, episodeLimit: 1, entityId: show.id }),
			);
			const result = response.data.show;
			if (result?.type !== "rows") {
				throw new Error("Expected show rows result");
			}
			const showRow = result.items[0];
			assertPresent(showRow, "Expected show row");
			const seasons = showRow.seasons;
			if (!seasons || !("items" in seasons)) {
				throw new Error("Expected seasons include");
			}
			expect(seasons.items).toHaveLength(2);
			expect(
				seasons.items.map((season) => requireRyotQLFieldValue(season, "seasonNumber").value),
			).toEqual([1, 2]);
			const firstSeasonResult = seasons.items[0];
			const secondSeasonResult = seasons.items[1];
			assertPresent(firstSeasonResult, "Expected first season");
			assertPresent(secondSeasonResult, "Expected second season");
			const firstEpisodes = firstSeasonResult.episodes;
			const secondEpisodes = secondSeasonResult.episodes;
			if (
				!firstEpisodes ||
				!("items" in firstEpisodes) ||
				!secondEpisodes ||
				!("items" in secondEpisodes)
			) {
				throw new Error("Expected nested episode includes");
			}
			expect(firstEpisodes.items).toHaveLength(1);
			expect(secondEpisodes.items).toHaveLength(1);
			const firstEpisodeResult = firstEpisodes.items[0];
			const secondSeasonEpisodeResult = secondEpisodes.items[0];
			assertPresent(firstEpisodeResult, "Expected first episode result");
			assertPresent(secondSeasonEpisodeResult, "Expected second-season episode result");
			expect(requireRyotQLFieldValue(firstEpisodeResult, "name").value).toBe("Season 1 Episode 1");
			expect(requireRyotQLFieldValue(firstEpisodeResult, "hasProgress")).toEqual({
				value: true,
				kind: "boolean",
			});
			expect(requireRyotQLFieldValue(firstEpisodeResult, "isComplete")).toEqual({
				value: true,
				kind: "boolean",
			});
			expect(requireRyotQLFieldValue(secondSeasonEpisodeResult, "name").value).toBe(
				"Season 2 Episode 1",
			);
			expect(requireRyotQLFieldValue(secondSeasonEpisodeResult, "hasProgress")).toEqual({
				value: false,
				kind: "boolean",
			});
			expect(requireRyotQLFieldValue(secondSeasonEpisodeResult, "isComplete")).toEqual({
				value: false,
				kind: "boolean",
			});
		}),
	);

	it.live("reconstructs podcast episode state and enforces the episode limit", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const seeded = yield* seedPodcast(client, 3);
			const firstEpisode = seeded.episodes[0];
			const secondEpisode = seeded.episodes[1];
			assertPresent(firstEpisode, "Expected first podcast episode");
			assertPresent(secondEpisode, "Expected second podcast episode");
			yield* createEventFixture(client, {
				entityId: firstEpisode.id,
				eventSchemaSlug: seeded.episodeProgressEventSchemaSlug,
				properties: { progressPercent: 50, consumedOn: "RyotQL test" },
			});
			yield* createEventFixture(client, {
				entityId: secondEpisode.id,
				properties: { completionMode: "unknown" },
				eventSchemaSlug: seeded.episodeCompleteEventSchemaSlug,
			});

			const response = yield* executeRyotQL(
				client,
				buildPodcastDetailQueryDocument({ entityId: seeded.podcast.id, episodeLimit: 2 }),
			);
			const result = response.data.podcast;
			if (result?.type !== "rows") {
				throw new Error("Expected podcast rows result");
			}
			const podcastRow = result.items[0];
			assertPresent(podcastRow, "Expected podcast row");
			const episodes = podcastRow.episodes;
			if (!episodes || !("items" in episodes)) {
				throw new Error("Expected podcast episodes include");
			}
			expect(episodes.items).toHaveLength(2);
			expect(
				episodes.items.map((episode) => requireRyotQLFieldValue(episode, "episodeNumber").value),
			).toEqual([1, 2]);
			const firstEpisodeResult = episodes.items[0];
			const secondEpisodeResult = episodes.items[1];
			assertPresent(firstEpisodeResult, "Expected first podcast episode result");
			assertPresent(secondEpisodeResult, "Expected second podcast episode result");
			expect(requireRyotQLFieldValue(firstEpisodeResult, "hasProgress")).toEqual({
				value: true,
				kind: "boolean",
			});
			expect(requireRyotQLFieldValue(firstEpisodeResult, "isComplete")).toEqual({
				value: false,
				kind: "boolean",
			});
			expect(requireRyotQLFieldValue(secondEpisodeResult, "hasProgress")).toEqual({
				value: false,
				kind: "boolean",
			});
			expect(requireRyotQLFieldValue(secondEpisodeResult, "isComplete")).toEqual({
				value: true,
				kind: "boolean",
			});
		}),
	);

	it.live("derives podcast in-progress and completed state from episode and podcast events", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const seeded = yield* seedPodcast(client, 2);
			const firstEpisode = seeded.episodes[0];
			const secondEpisode = seeded.episodes[1];
			assertPresent(firstEpisode, "Expected first podcast episode");
			assertPresent(secondEpisode, "Expected second podcast episode");
			const inProgressDocument = buildInProgressPodcastsQueryDocument({
				limit: 10,
				entityId: seeded.podcast.id,
			});
			const completedDocument = buildCompletedPodcastsQueryDocument({
				limit: 10,
				entityId: seeded.podcast.id,
			});
			yield* createEventFixture(client, {
				entityId: firstEpisode.id,
				eventSchemaSlug: seeded.episodeProgressEventSchemaSlug,
				properties: { progressPercent: 100, consumedOn: "RyotQL test" },
			});
			yield* createEventFixture(client, {
				entityId: firstEpisode.id,
				properties: { completionMode: "unknown" },
				eventSchemaSlug: seeded.episodeCompleteEventSchemaSlug,
			});
			let response = readPodcastRows(yield* executeRyotQL(client, inProgressDocument));
			expect(response.items).toHaveLength(1);
			response = readPodcastRows(yield* executeRyotQL(client, completedDocument));
			expect(response.items).toHaveLength(0);

			yield* createEventFixture(client, {
				entityId: secondEpisode.id,
				properties: { completionMode: "unknown" },
				eventSchemaSlug: seeded.episodeCompleteEventSchemaSlug,
			});
			response = readPodcastRows(yield* executeRyotQL(client, inProgressDocument));
			expect(response.items).toHaveLength(1);
			response = readPodcastRows(yield* executeRyotQL(client, completedDocument));
			expect(response.items).toHaveLength(1);

			yield* createEventFixture(client, {
				entityId: seeded.podcast.id,
				properties: { completionMode: "unknown" },
				eventSchemaSlug: seeded.podcastCompleteEventSchemaSlug,
			});
			response = readPodcastRows(yield* executeRyotQL(client, inProgressDocument));
			expect(response.items).toHaveLength(0);
			response = readPodcastRows(yield* executeRyotQL(client, completedDocument));
			expect(response.items).toHaveLength(1);
		}),
	);

	it.live("applies personal suggestion ownership semantics to persisted suggestion edges", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* createGlobalBookEntityFixture(client);
			const [sourceA, sourceB, candidateTop, candidateOther, alreadyOwned] = yield* Effect.all([
				createGlobalBookEntityFixture(client, {
					name: `Suggestion Source A ${crypto.randomUUID()}`,
				}),
				createGlobalBookEntityFixture(client, {
					name: `Suggestion Source B ${crypto.randomUUID()}`,
				}),
				createGlobalBookEntityFixture(client, {
					name: `Suggestion Candidate Top ${crypto.randomUUID()}`,
				}),
				createGlobalBookEntityFixture(client, {
					name: `Suggestion Candidate Other ${crypto.randomUUID()}`,
				}),
				createGlobalBookEntityFixture(client, {
					name: `Suggestion Already Owned ${crypto.randomUUID()}`,
				}),
			]);
			const relationshipSchemas = yield* listRelationshipSchemas(client, {
				slugs: ["media-suggestion"],
			});
			const mediaSuggestion = requireRelationshipSchemaBySlug(
				relationshipSchemas,
				"media-suggestion",
			);
			yield* Effect.all([
				insertLibraryMembership(client, { mediaEntityId: sourceA.entity.id }),
				insertLibraryMembership(client, { mediaEntityId: sourceB.entity.id }),
				insertLibraryMembership(client, { mediaEntityId: alreadyOwned.entity.id }),
				insertGlobalRelationship({
					sourceEntityId: sourceA.entity.id,
					targetEntityId: candidateTop.entity.id,
					relationshipSchemaSlug: mediaSuggestion.id,
				}),
				insertGlobalRelationship({
					sourceEntityId: sourceB.entity.id,
					targetEntityId: candidateTop.entity.id,
					relationshipSchemaSlug: mediaSuggestion.id,
				}),
				insertGlobalRelationship({
					sourceEntityId: sourceA.entity.id,
					targetEntityId: candidateOther.entity.id,
					relationshipSchemaSlug: mediaSuggestion.id,
				}),
				insertGlobalRelationship({
					sourceEntityId: sourceA.entity.id,
					targetEntityId: alreadyOwned.entity.id,
					relationshipSchemaSlug: mediaSuggestion.id,
				}),
			]);

			const response = yield* executeRyotQL(
				client,
				buildPersonalMediaSuggestionsQueryDocument({ limit: 10, entitySchemaSlug: schema.slug }),
			);
			const result = response.data.recommendations;
			if (result?.type !== "aggregate") {
				throw new Error("Expected recommendation aggregate result");
			}
			expect(result.items).toHaveLength(2);
			const first = result.items[0];
			const second = result.items[1];
			assertPresent(first, "Expected top suggestion");
			assertPresent(second, "Expected second suggestion");
			expect(requireRyotQLFieldValue(first, "id").value).toBe(candidateTop.entity.id);
			expect(requireRyotQLFieldValue(first, "recommendingSourceCount").value).toBe(2);
			expect(requireRyotQLFieldValue(second, "id").value).toBe(candidateOther.entity.id);
			expect(requireRyotQLFieldValue(second, "recommendingSourceCount").value).toBe(1);
			expect(result.items.map((item) => requireRyotQLFieldValue(item, "id").value)).not.toContain(
				alreadyOwned.entity.id,
			);
		}),
	);

	it.live("keeps collection members in collection suggestion results", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const collection = yield* createCollection(client, {
				name: `Suggestion Collection ${crypto.randomUUID()}`,
			});
			const { schema } = yield* createGlobalBookEntityFixture(client);
			const [sourceA, sourceB, candidateTop, candidateMember] = yield* Effect.all([
				createGlobalBookEntityFixture(client, {
					name: `Collection Source A ${crypto.randomUUID()}`,
				}),
				createGlobalBookEntityFixture(client, {
					name: `Collection Source B ${crypto.randomUUID()}`,
				}),
				createGlobalBookEntityFixture(client, {
					name: `Collection Candidate Top ${crypto.randomUUID()}`,
				}),
				createGlobalBookEntityFixture(client, {
					name: `Collection Candidate Member ${crypto.randomUUID()}`,
				}),
			]);
			const relationshipSchemas = yield* listRelationshipSchemas(client, {
				slugs: ["media-suggestion", "member-of"],
			});
			const mediaSuggestion = requireRelationshipSchemaBySlug(
				relationshipSchemas,
				"media-suggestion",
			);
			const memberOf = requireRelationshipSchemaBySlug(relationshipSchemas, "member-of");
			yield* Effect.all([
				createRelationship(client, {
					properties: {},
					targetEntityId: collection.id,
					sourceEntityId: sourceA.entity.id,
					relationshipSchemaSlug: memberOf.id,
				}),
				createRelationship(client, {
					properties: {},
					targetEntityId: collection.id,
					sourceEntityId: sourceB.entity.id,
					relationshipSchemaSlug: memberOf.id,
				}),
				createRelationship(client, {
					properties: {},
					targetEntityId: collection.id,
					relationshipSchemaSlug: memberOf.id,
					sourceEntityId: candidateMember.entity.id,
				}),
				insertGlobalRelationship({
					sourceEntityId: sourceA.entity.id,
					targetEntityId: candidateTop.entity.id,
					relationshipSchemaSlug: mediaSuggestion.id,
				}),
				insertGlobalRelationship({
					sourceEntityId: sourceB.entity.id,
					targetEntityId: candidateTop.entity.id,
					relationshipSchemaSlug: mediaSuggestion.id,
				}),
				insertGlobalRelationship({
					sourceEntityId: sourceA.entity.id,
					targetEntityId: candidateMember.entity.id,
					relationshipSchemaSlug: mediaSuggestion.id,
				}),
			]);

			const response = yield* executeRyotQL(
				client,
				buildCollectionMediaSuggestionsQueryDocument({
					limit: 10,
					collectionId: collection.id,
					entitySchemaSlug: schema.slug,
				}),
			);
			const result = response.data.recommendations;
			if (result?.type !== "aggregate") {
				throw new Error("Expected recommendation aggregate result");
			}
			const byId = new Map(
				result.items.map((item) => [
					String(requireRyotQLFieldValue(item, "id").value),
					Number(requireRyotQLFieldValue(item, "recommendingSourceCount").value),
				]),
			);
			expect(byId.get(candidateTop.entity.id)).toBe(2);
			expect(byId.get(candidateMember.entity.id)).toBe(1);
		}),
	);

	it.live(
		"filters trending edges by snapshot and schema, orders by rank, and rebuilds fields",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { schema: bookSchema } = yield* findBuiltinSchemaBySlug(client, "book");
				const { schema: movieSchema } = yield* findBuiltinSchemaBySlug(client, "movie");
				const [top, secondBook, stale] = yield* Effect.all([
					createGlobalBookEntityFixture(client, { name: `Trending Top ${crypto.randomUUID()}` }),
					createGlobalBookEntityFixture(client, { name: `Trending Second ${crypto.randomUUID()}` }),
					createGlobalBookEntityFixture(client, { name: `Trending Stale ${crypto.randomUUID()}` }),
				]);
				const wrongSchema = yield* seedMediaEntity({
					userId: null,
					providerId: null,
					entitySchemaSlug: movieSchema.id,
					name: `Trending Wrong Schema ${crypto.randomUUID()}`,
					properties: { images: [], genres: [], description: null },
					externalId: `query-recipe-trending-movie-${crypto.randomUUID()}`,
				});
				const fetchedAt = DateTime.formatIso(
					DateTime.makeUnsafe(Date.UTC(2026, 6, 1) + Math.floor(Math.random() * 1_000_000)),
				);
				const relationshipSchemas = yield* listRelationshipSchemas(client, {
					slugs: ["media-trending"],
				});
				const mediaTrending = requireRelationshipSchemaBySlug(
					relationshipSchemas,
					"media-trending",
				);
				yield* Effect.all([
					insertGlobalRelationship({
						sourceEntityId: top.entity.id,
						targetEntityId: top.entity.id,
						properties: { rank: 1, fetchedAt },
						relationshipSchemaSlug: mediaTrending.id,
					}),
					insertGlobalRelationship({
						properties: { rank: 2, fetchedAt },
						sourceEntityId: secondBook.entity.id,
						targetEntityId: secondBook.entity.id,
						relationshipSchemaSlug: mediaTrending.id,
					}),
					insertGlobalRelationship({
						sourceEntityId: stale.entity.id,
						targetEntityId: stale.entity.id,
						relationshipSchemaSlug: mediaTrending.id,
						properties: { rank: 0, fetchedAt: "2026-06-01T00:00:00.000Z" },
					}),
					insertGlobalRelationship({
						sourceEntityId: wrongSchema.id,
						targetEntityId: wrongSchema.id,
						properties: { rank: 0, fetchedAt },
						relationshipSchemaSlug: mediaTrending.id,
					}),
				]);

				const response = yield* executeRyotQL(
					client,
					buildTrendingMediaQueryDocument({
						limit: 10,
						fetchedAt,
						entitySchemaSlug: bookSchema.slug,
					}),
				);
				const result = response.data.trending;
				if (result?.type !== "rows") {
					throw new Error("Expected trending rows result");
				}
				expect(result.items).toHaveLength(2);
				const first = result.items[0];
				const secondResult = result.items[1];
				assertPresent(first, "Expected first trending row");
				assertPresent(secondResult, "Expected second trending row");
				expect(requireRyotQLFieldValue(first, "id").value).toBe(top.entity.id);
				expect(requireRyotQLFieldValue(first, "name").value).toBe(top.entity.name);
				expect(requireRyotQLFieldValue(first, "schemaSlug").value).toBe(bookSchema.slug);
				expect(requireRyotQLFieldValue(first, "rank").value).toBe(1);
				expect(requireRyotQLFieldValue(first, "fetchedAt").value).toBe(fetchedAt);
				expect(requireRyotQLFieldValue(secondResult, "id").value).toBe(secondBook.entity.id);
				expect(requireRyotQLFieldValue(secondResult, "rank").value).toBe(2);
			}),
	);
});
