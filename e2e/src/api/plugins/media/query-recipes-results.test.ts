import {
	collectionMediaSuggestionsRecipe,
	personalMediaSuggestionsRecipe,
	podcastDetailRecipe,
	podcastsByLifecycleStateRecipe,
	trendingMediaRecipe,
} from "@ryot-app/media-plugin/query-recipes";
import { personRecipes } from "@ryot-app/media-plugin/shared/person-recipes";
import {
	showRecipes,
	showSeasonEpisodesRecipe,
	showSeasonsRecipe,
} from "@ryot-app/media-plugin/shared/show-recipes";
import { DateTime, Effect } from "effect";

import {
	createAuthenticatedClient,
	createCollection,
	createEventFixture,
	createRelationship,
	executeRyotQLRecipe,
	findBuiltinSchemaBySlug,
	getBuiltinEntitySchemaSlug,
	insertGlobalRelationship,
	listEventSchemas,
	listRelationshipSchemas,
	requireEventSchemaBySlug,
	requireRelationshipSchemaBySlug,
	type Client,
} from "~/fixtures/kernel";
import {
	createGlobalBookEntityFixture,
	insertLibraryMembership,
	insertMediaMonitoring,
	seedMediaEntity,
} from "~/fixtures/plugins/media";
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
		yield* Effect.forEach(episodes, (episode) =>
			insertGlobalRelationship({
				targetEntityId: episode.id,
				sourceEntityId: podcast.id,
				relationshipSchemaSlug: podcastEpisodeRelationship.id,
			}),
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

const seedCredit = (input: {
	name: string;
	schemaSlug: string;
	images: readonly Record<string, unknown>[];
}) =>
	seedMediaEntity({
		userId: null,
		providerId: null,
		name: input.name,
		entitySchemaSlug: input.schemaSlug,
		externalId: `overview-${crypto.randomUUID()}`,
		properties: { sourceUrl: null, description: null, images: input.images },
	});

const seedActivityShow = (client: Client) =>
	Effect.gen(function* () {
		const { schema: showSchema } = yield* findBuiltinSchemaBySlug(client, "show");
		const showSeasonSchemaId = yield* getBuiltinEntitySchemaSlug("show-season");
		const showEpisodeSchemaId = yield* getBuiltinEntitySchemaSlug("show-episode");
		const relationshipSchemas = yield* listRelationshipSchemas(client, {
			slugs: ["show-to-show-season", "show-season-to-show-episode"],
		});
		const showToSeason = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"show-to-show-season",
		);
		const seasonToEpisode = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"show-season-to-show-episode",
		);
		const suffix = crypto.randomUUID();
		const show = yield* seedMediaEntity({
			userId: null,
			providerId: null,
			name: `Activity Show ${suffix}`,
			entitySchemaSlug: showSchema.id,
			externalId: `activity-show-${suffix}`,
			properties: { totalSeasons: 1, totalEpisodes: 2 },
		});
		const [regularSeason, specialsSeason] = yield* Effect.forEach([1, 0], (seasonNumber) =>
			seedMediaEntity({
				userId: null,
				providerId: null,
				properties: { seasonNumber },
				entitySchemaSlug: showSeasonSchemaId,
				name: `Activity Season ${seasonNumber} ${suffix}`,
				externalId: `activity-season-${seasonNumber}-${suffix}`,
			}),
		);
		const [firstEpisode, secondEpisode, specialEpisode] = yield* Effect.forEach(
			[
				{ seasonNumber: 1, episodeNumber: 1 },
				{ seasonNumber: 1, episodeNumber: 2 },
				{ seasonNumber: 0, episodeNumber: 1 },
			],
			({ seasonNumber, episodeNumber }) =>
				seedMediaEntity({
					userId: null,
					providerId: null,
					entitySchemaSlug: showEpisodeSchemaId,
					name: `Activity S${seasonNumber}E${episodeNumber} ${suffix}`,
					properties: { seasonNumber, episodeNumber, runtime: 30 + episodeNumber },
					externalId: `activity-episode-${seasonNumber}-${episodeNumber}-${suffix}`,
				}),
		);
		assertPresent(regularSeason, "Missing regular activity season");
		assertPresent(specialsSeason, "Missing specials activity season");
		assertPresent(firstEpisode, "Missing first activity episode");
		assertPresent(secondEpisode, "Missing second activity episode");
		assertPresent(specialEpisode, "Missing special activity episode");
		yield* Effect.all([
			insertGlobalRelationship({
				sourceEntityId: show.id,
				targetEntityId: regularSeason.id,
				relationshipSchemaSlug: showToSeason.id,
			}),
			insertGlobalRelationship({
				sourceEntityId: show.id,
				targetEntityId: specialsSeason.id,
				relationshipSchemaSlug: showToSeason.id,
			}),
			insertGlobalRelationship({
				targetEntityId: firstEpisode.id,
				sourceEntityId: regularSeason.id,
				relationshipSchemaSlug: seasonToEpisode.id,
			}),
			insertGlobalRelationship({
				targetEntityId: secondEpisode.id,
				sourceEntityId: regularSeason.id,
				relationshipSchemaSlug: seasonToEpisode.id,
			}),
			insertGlobalRelationship({
				targetEntityId: specialEpisode.id,
				sourceEntityId: specialsSeason.id,
				relationshipSchemaSlug: seasonToEpisode.id,
			}),
		]);
		const showEventSchemas = yield* listEventSchemas(client, showSchema.id);
		const episodeEventSchemas = yield* listEventSchemas(client, showEpisodeSchemaId);
		return {
			show,
			firstEpisode,
			secondEpisode,
			specialEpisode,
			showEvents: {
				review: requireEventSchemaBySlug(showEventSchemas, "review").id,
				backlog: requireEventSchemaBySlug(showEventSchemas, "backlog").id,
				complete: requireEventSchemaBySlug(showEventSchemas, "complete").id,
			},
			episodeEvents: {
				review: requireEventSchemaBySlug(episodeEventSchemas, "review").id,
				progress: requireEventSchemaBySlug(episodeEventSchemas, "progress").id,
				complete: requireEventSchemaBySlug(episodeEventSchemas, "complete").id,
			},
		};
	});

const ACTIVITY_LIMITS = {
	timeZone: "UTC",
	coverageLimit: 100,
	watchDayLimit: 500,
	parentEventLimit: 60,
	episodeEventLimit: 100,
	collectionEventLimit: 60,
	episodeProgressLimit: 100,
} as const;

describe("Media RyotQL query recipe results", () => {
	it.live("loads seasons and selected season episodes with independent limits", () =>
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
			const [seasonOne, seasonTwo, seasonThree] = yield* Effect.forEach([1, 2, 3], (seasonNumber) =>
				seedMediaEntity({
					userId: null,
					providerId: null,
					name: `Season ${seasonNumber}`,
					entitySchemaSlug: showSeasonSchemaId,
					externalId: `query-recipe-season-${seasonNumber}-${suffix}`,
					properties: {
						seasonNumber,
						releaseDate: `2024-0${seasonNumber}-01`,
						description: `Season ${seasonNumber} overview`,
						images: [
							{
								type: "remote",
								purpose: "cover",
								url: `https://images.test/season-${seasonNumber}.jpg`,
							},
						],
					},
				}),
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
								publishDate: `2024-0${seasonNumber}-0${episodeNumber}`,
								description: `Season ${seasonNumber} episode ${episodeNumber} synopsis`,
								images: [
									{
										type: "remote",
										purpose: "still",
										url: `https://images.test/episode-${seasonNumber}-${episodeNumber}.jpg`,
									},
								],
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

			const showRow = yield* executeRyotQLRecipe(
				client,
				showSeasonsRecipe({ seasonLimit: 2, entityId: show.id }),
			);
			assertPresent(showRow, "Expected show row");
			const seasons = showRow.seasons;
			expect(seasons.items).toHaveLength(2);
			expect(seasons.items.map((season) => season.seasonNumber)).toEqual([1, 2]);
			const firstSeasonResult = seasons.items[0];
			const secondSeasonResult = seasons.items[1];
			assertPresent(firstSeasonResult, "Expected first season");
			assertPresent(secondSeasonResult, "Expected second season");
			const firstSeason = yield* executeRyotQLRecipe(
				client,
				showSeasonEpisodesRecipe({ limit: 1, containerId: firstSeasonResult.id }),
			);
			const secondSeason = yield* executeRyotQLRecipe(
				client,
				showSeasonEpisodesRecipe({ limit: 1, containerId: secondSeasonResult.id }),
			);
			expect(firstSeason.items).toHaveLength(1);
			expect(secondSeason.items).toHaveLength(1);
			const firstEpisodeResult = firstSeason.items[0];
			const secondSeasonEpisodeResult = secondSeason.items[0];
			assertPresent(firstEpisodeResult, "Expected first episode result");
			assertPresent(secondSeasonEpisodeResult, "Expected second-season episode result");
			expect(firstEpisodeResult.name).toBe("Season 1 Episode 1");
			expect(firstEpisodeResult.state).toBe("complete");
			expect(firstSeasonResult).toMatchObject({
				seasonNumber: 1,
				releaseDate: "2024-01-01",
				description: "Season 1 overview",
				images: [{ type: "remote", purpose: "cover", url: "https://images.test/season-1.jpg" }],
			});
			expect(firstEpisodeResult).toMatchObject({
				runtime: 40,
				seasonNumber: 1,
				episodeNumber: 1,
				publishDate: "2024-01-01",
				description: "Season 1 episode 1 synopsis",
				images: [{ type: "remote", purpose: "still", url: "https://images.test/episode-1-1.jpg" }],
			});
			expect(secondSeasonEpisodeResult.name).toBe("Season 2 Episode 1");
			expect(secondSeasonEpisodeResult.state).toBe("untracked");
			expect(firstEpisodeResult).not.toHaveProperty("hasProgress");
			expect(firstEpisodeResult).not.toHaveProperty("isComplete");
			expect(secondSeasonEpisodeResult).not.toHaveProperty("hasProgress");
			expect(secondSeasonEpisodeResult).not.toHaveProperty("isComplete");
		}),
	);

	it.live("reconstructs the show summary with provider, library, and collection state", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: showSchema } = yield* findBuiltinSchemaBySlug(client, "show");
			const relationshipSchemas = yield* listRelationshipSchemas(client, { slugs: ["member-of"] });
			const memberOf = requireRelationshipSchemaBySlug(relationshipSchemas, "member-of");
			const collection = yield* createCollection(client, {
				name: `Summary Collection ${crypto.randomUUID()}`,
			});
			const suffix = crypto.randomUUID();
			const show = yield* seedMediaEntity({
				userId: null,
				providerId: null,
				name: `Summary Show ${suffix}`,
				entitySchemaSlug: showSchema.id,
				externalId: `summary-show-${suffix}`,
				properties: {
					isNsfw: null,
					sourceUrl: null,
					totalSeasons: 1,
					totalEpisodes: 4,
					publishYear: 2025,
					unlinkedCreators: [],
					providerRating: 78.25,
					publishDate: "2025-03-13",
					productionStatus: "Ended",
					genres: ["Drama", "Crime"],
					description: "A four-part limited series.",
					images: [
						{ type: "remote", purpose: "backdrop", url: "https://images.test/backdrop.jpg" },
						{ type: "remote", purpose: "cover", url: "https://images.test/cover.jpg" },
					],
				},
			});
			yield* insertLibraryMembership(client, {
				mediaEntityId: show.id,
				properties: { owned: true },
			});
			yield* insertMediaMonitoring(client, show.id);
			yield* createRelationship(client, {
				properties: {},
				sourceEntityId: show.id,
				targetEntityId: collection.id,
				relationshipSchemaSlug: memberOf.id,
			});

			const summary = yield* executeRyotQLRecipe(
				client,
				showRecipes.summaryRecipe({ entityId: show.id, collectionLimit: 5 }),
			);
			const summaryRow = summary.summary;
			assertPresent(summaryRow, "Expected show summary row");

			expect(summary.entitySchemaSlug).toBe("show");
			expect(summaryRow.owned).toBe(true);
			expect(summaryRow.state).toBe("untracked");
			expect(summaryRow.isInLibrary).toBe(true);
			expect(summaryRow.isMonitored).toBe(true);
			expect(summaryRow.publishYear).toBe(2025);
			expect(summaryRow.totalSeasons).toBe(1);
			expect(summaryRow.totalEpisodes).toBe(4);
			expect(summaryRow.providerName).toBeNull();
			expect(summaryRow.providerRating).toBe(78.25);
			expect(summaryRow.productionStatus).toBe("Ended");
			expect(summaryRow.publishDate).toBe("2025-03-13");
			expect(summaryRow.genres).toEqual(["Drama", "Crime"]);
			expect(summaryRow.description).toBe("A four-part limited series.");
			expect(summaryRow.images).toEqual([
				{ type: "remote", purpose: "backdrop", url: "https://images.test/backdrop.jpg" },
				{ type: "remote", purpose: "cover", url: "https://images.test/cover.jpg" },
			]);
			expect(summaryRow.collections.items.map(({ name }) => name)).toEqual([collection.name]);
		}),
	);

	it.live("reconstructs show overview credits, companies and outgoing suggestions", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const showSchemaId = yield* getBuiltinEntitySchemaSlug("show");
			const personSchemaId = yield* getBuiltinEntitySchemaSlug("person");
			const companySchemaId = yield* getBuiltinEntitySchemaSlug("company");
			const relationshipSchemas = yield* listRelationshipSchemas(client, {
				slugs: ["person-to-show", "company-to-show", "media-suggestion"],
			});
			const personToShow = requireRelationshipSchemaBySlug(relationshipSchemas, "person-to-show");
			const mediaSuggestion = requireRelationshipSchemaBySlug(
				relationshipSchemas,
				"media-suggestion",
			);
			const companyToShow = requireRelationshipSchemaBySlug(relationshipSchemas, "company-to-show");
			const suffix = crypto.randomUUID();
			const seedShow = (name: string, images: readonly Record<string, unknown>[]) =>
				seedMediaEntity({
					name,
					userId: null,
					providerId: null,
					entitySchemaSlug: showSchemaId,
					externalId: `overview-${crypto.randomUUID()}`,
					properties: {
						images,
						genres: [],
						isNsfw: null,
						sourceUrl: null,
						totalSeasons: 1,
						totalEpisodes: 1,
						description: null,
						publishYear: null,
						publishDate: null,
						providerRating: null,
						unlinkedCreators: [],
						productionStatus: null,
					},
				});

			const show = yield* seedShow(`Overview Show ${suffix}`, []);
			const [lead, writer, studio, network, suggestedFirst, suggestedSecond, incomingSource] =
				yield* Effect.all([
					seedCredit({
						schemaSlug: personSchemaId,
						name: `Overview Lead ${suffix}`,
						images: [{ type: "remote", purpose: "profile", url: "https://images.test/lead.jpg" }],
					}),
					seedCredit({ images: [], schemaSlug: personSchemaId, name: `Overview Writer ${suffix}` }),
					seedCredit({
						schemaSlug: companySchemaId,
						name: `Overview Studio ${suffix}`,
						images: [{ type: "s3", purpose: "logo", key: "studio-logo" }],
					}),
					seedCredit({
						images: [],
						schemaSlug: companySchemaId,
						name: `Overview Network ${suffix}`,
					}),
					seedShow(`Overview Suggested A ${suffix}`, [
						{ type: "remote", purpose: "cover", url: "https://images.test/suggested-a.jpg" },
					]),
					seedShow(`Overview Suggested B ${suffix}`, []),
					seedShow(`Overview Incoming ${suffix}`, []),
				]);
			yield* Effect.all([
				insertGlobalRelationship({
					targetEntityId: show.id,
					sourceEntityId: lead.id,
					relationshipSchemaSlug: personToShow.id,
					properties: { order: 1, roles: ["Actor"], character: "Jamie" },
				}),
				insertGlobalRelationship({
					targetEntityId: show.id,
					sourceEntityId: writer.id,
					relationshipSchemaSlug: personToShow.id,
					properties: { order: 2, roles: ["Writer", "Creator"] },
				}),
				insertGlobalRelationship({
					targetEntityId: show.id,
					sourceEntityId: studio.id,
					relationshipSchemaSlug: companyToShow.id,
					properties: { order: 1, roles: ["Production Company"] },
				}),
				insertGlobalRelationship({
					targetEntityId: show.id,
					sourceEntityId: network.id,
					relationshipSchemaSlug: companyToShow.id,
					properties: { order: 2, roles: ["Network"] },
				}),
				insertGlobalRelationship({
					sourceEntityId: show.id,
					targetEntityId: suggestedFirst.id,
					relationshipSchemaSlug: mediaSuggestion.id,
				}),
				insertGlobalRelationship({
					sourceEntityId: show.id,
					targetEntityId: suggestedSecond.id,
					relationshipSchemaSlug: mediaSuggestion.id,
				}),
				insertGlobalRelationship({
					targetEntityId: show.id,
					sourceEntityId: incomingSource.id,
					relationshipSchemaSlug: mediaSuggestion.id,
				}),
			]);

			const overview = yield* executeRyotQLRecipe(
				client,
				showRecipes.overviewRecipe({
					peopleLimit: 12,
					companyLimit: 6,
					entityId: show.id,
					recommendationLimit: 12,
				}),
			);

			expect(overview.people.items.map((person) => person.name)).toEqual([lead.name, writer.name]);
			const leadCredit = overview.people.items[0];
			assertPresent(leadCredit, "Expected the lead credit");
			expect(leadCredit.order).toBe(1);
			expect(leadCredit.character).toBe("Jamie");
			expect(leadCredit.roles).toEqual(["Actor"]);
			expect(leadCredit.images).toEqual([
				{ type: "remote", purpose: "profile", url: "https://images.test/lead.jpg" },
			]);
			const writerCredit = overview.people.items[1];
			assertPresent(writerCredit, "Expected the writer credit");
			expect(writerCredit.character).toBeNull();
			expect(writerCredit.roles).toEqual(["Writer", "Creator"]);
			expect(overview.companies.items.map((company) => company.name)).toEqual([
				studio.name,
				network.name,
			]);
			const studioCredit = overview.companies.items[0];
			assertPresent(studioCredit, "Expected the studio credit");
			expect(studioCredit.roles).toEqual(["Production Company"]);
			expect(studioCredit.images).toEqual([{ type: "s3", purpose: "logo", key: "studio-logo" }]);
			expect(overview.recommendations.items.map((item) => item.id)).toEqual([
				suggestedFirst.id,
				suggestedSecond.id,
			]);
			expect(overview.recommendations.items.map((item) => item.id)).not.toContain(
				incomingSource.id,
			);
			const suggestedA = overview.recommendations.items[0];
			assertPresent(suggestedA, "Expected the first suggestion");
			expect(suggestedA.images).toEqual([
				{ type: "remote", purpose: "cover", url: "https://images.test/suggested-a.jpg" },
			]);
		}),
	);

	it.live("returns empty overview sections for a show with no relationships", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const showSchemaId = yield* getBuiltinEntitySchemaSlug("show");
			const suffix = crypto.randomUUID();
			const show = yield* seedMediaEntity({
				userId: null,
				providerId: null,
				entitySchemaSlug: showSchemaId,
				name: `Overview Bare ${suffix}`,
				externalId: `overview-bare-${suffix}`,
				properties: {
					images: [],
					genres: [],
					isNsfw: null,
					sourceUrl: null,
					totalSeasons: 1,
					totalEpisodes: 1,
					description: null,
					publishYear: null,
					publishDate: null,
					providerRating: null,
					unlinkedCreators: [],
					productionStatus: null,
				},
			});

			const overview = yield* executeRyotQLRecipe(
				client,
				showRecipes.overviewRecipe({
					peopleLimit: 12,
					companyLimit: 6,
					entityId: show.id,
					recommendationLimit: 12,
				}),
			);

			expect(overview.people.items).toEqual([]);
			expect(overview.companies.items).toEqual([]);
			expect(overview.recommendations.items).toEqual([]);
		}),
	);

	it.live("reconstructs person credits through the reverse join in per-target order", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const personSchemaId = yield* getBuiltinEntitySchemaSlug("person");
			const movieSchemaId = yield* getBuiltinEntitySchemaSlug("movie");
			const musicGroupSchemaId = yield* getBuiltinEntitySchemaSlug("music-group");
			const relationshipSchemas = yield* listRelationshipSchemas(client, {
				slugs: ["person-to-movie", "person-to-music-group"],
			});
			const personToMovie = requireRelationshipSchemaBySlug(relationshipSchemas, "person-to-movie");
			const personToMusicGroup = requireRelationshipSchemaBySlug(
				relationshipSchemas,
				"person-to-music-group",
			);
			const suffix = crypto.randomUUID();
			const seedMovie = (name: string, publishYear: number | null) =>
				seedMediaEntity({
					name,
					userId: null,
					providerId: null,
					entitySchemaSlug: movieSchemaId,
					externalId: `overview-${crypto.randomUUID()}`,
					properties: { images: [], publishYear, sourceUrl: null, description: null },
				});

			const [person, olderMovie, undatedMovie, newerMovie, secondBand, firstBand, unrelated] =
				yield* Effect.all([
					seedCredit({ images: [], schemaSlug: personSchemaId, name: `Credit Person ${suffix}` }),
					seedMovie(`Credit Older Movie ${suffix}`, 1999),
					seedMovie(`Credit Undated Movie ${suffix}`, null),
					seedMovie(`Credit Newer Movie ${suffix}`, 2014),
					seedCredit({ images: [], name: `B Band ${suffix}`, schemaSlug: musicGroupSchemaId }),
					seedCredit({ images: [], name: `A Band ${suffix}`, schemaSlug: musicGroupSchemaId }),
					seedMovie(`Credit Unrelated Movie ${suffix}`, 2020),
				]);
			const credit = (
				targetEntityId: string,
				relationshipSchemaSlug: string,
				properties: Record<string, unknown>,
			) =>
				insertGlobalRelationship({
					properties,
					targetEntityId,
					relationshipSchemaSlug,
					sourceEntityId: person.id,
				});
			yield* Effect.all([
				credit(olderMovie.id, personToMovie.id, { roles: ["Actor"], character: "Tyler" }),
				credit(undatedMovie.id, personToMovie.id, { roles: ["Director"] }),
				credit(newerMovie.id, personToMovie.id, { roles: ["Writer"] }),
				credit(secondBand.id, personToMusicGroup.id, { roles: ["Artist"] }),
				credit(firstBand.id, personToMusicGroup.id, { roles: ["Artist"] }),
				insertGlobalRelationship({
					targetEntityId: person.id,
					sourceEntityId: unrelated.id,
					relationshipSchemaSlug: personToMovie.id,
				}),
			]);

			const overview = yield* executeRyotQLRecipe(
				client,
				personRecipes.overviewRecipe({ creditLimit: 12, entityId: person.id }),
			);

			expect(overview.movie.items.map((item) => item.id)).toEqual([
				newerMovie.id,
				olderMovie.id,
				undatedMovie.id,
			]);
			const olderCredit = overview.movie.items[1];
			assertPresent(olderCredit, "Expected the older movie credit");
			expect(olderCredit.character).toBe("Tyler");
			expect(olderCredit.roles).toEqual(["Actor"]);
			expect(overview["music-group"].items.map((item) => item.id)).toEqual([
				firstBand.id,
				secondBand.id,
			]);
			expect(overview.show.items).toEqual([]);
		}),
	);

	it.live("reports a non-show entity through the show summary schema slug", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const book = yield* createGlobalBookEntityFixture(client, {
				name: `Summary Book ${crypto.randomUUID()}`,
			});

			const summary = yield* executeRyotQLRecipe(
				client,
				showRecipes.summaryRecipe({ collectionLimit: 5, entityId: book.entity.id }),
			);

			expect(summary.summary).toBeNull();
			expect(summary.entitySchemaSlug).toBe("book");
		}),
	);

	it.live("reports a missing entity through an absent show summary", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const summary = yield* executeRyotQLRecipe(
				client,
				showRecipes.summaryRecipe({
					collectionLimit: 5,
					entityId: `missing-${crypto.randomUUID()}`,
				}),
			);

			expect(summary.summary).toBeNull();
			expect(summary.entitySchemaSlug).toBeNull();
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

			const podcastRow = yield* executeRyotQLRecipe(
				client,
				podcastDetailRecipe({ episodeLimit: 2, entityId: seeded.podcast.id }),
			);
			assertPresent(podcastRow, "Expected podcast row");
			const episodes = podcastRow.episodes;
			expect(episodes.items).toHaveLength(2);
			expect(episodes.items.map((episode) => episode.episodeNumber)).toEqual([1, 2]);
			const firstEpisodeResult = episodes.items[0];
			const secondEpisodeResult = episodes.items[1];
			assertPresent(firstEpisodeResult, "Expected first podcast episode result");
			assertPresent(secondEpisodeResult, "Expected second podcast episode result");
			expect(firstEpisodeResult.state).toBe("in_progress");
			expect(secondEpisodeResult.state).toBe("complete");
			expect(firstEpisodeResult).not.toHaveProperty("hasProgress");
			expect(firstEpisodeResult).not.toHaveProperty("isComplete");
			expect(secondEpisodeResult).not.toHaveProperty("hasProgress");
			expect(secondEpisodeResult).not.toHaveProperty("isComplete");
			expect(podcastRow.state).toBe("in_progress");
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
			const lifecycleStates = [
				"untracked",
				"backlog",
				"in_progress",
				"on_hold",
				"dropped",
				"caught_up",
				"complete",
			] as const;
			const assertPodcastState = (expectedState: (typeof lifecycleStates)[number]) =>
				Effect.gen(function* () {
					const responses = yield* Effect.all(
						lifecycleStates.map((state) =>
							executeRyotQLRecipe(
								client,
								podcastsByLifecycleStateRecipe({ state, limit: 10, entityId: seeded.podcast.id }),
							),
						),
					);
					const matches = responses.flatMap((response, index) =>
						response.items
							.filter((item) => item.id === seeded.podcast.id)
							.map(() => lifecycleStates[index]),
					);
					expect(matches).toHaveLength(1);
					expect(matches[0]).toBe(expectedState);
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
			yield* assertPodcastState("in_progress");

			yield* createEventFixture(client, {
				entityId: secondEpisode.id,
				properties: { completionMode: "unknown" },
				eventSchemaSlug: seeded.episodeCompleteEventSchemaSlug,
			});
			yield* assertPodcastState("caught_up");

			yield* createEventFixture(client, {
				entityId: seeded.podcast.id,
				properties: { completionMode: "unknown" },
				eventSchemaSlug: seeded.podcastCompleteEventSchemaSlug,
			});
			yield* assertPodcastState("complete");
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

			const result = yield* executeRyotQLRecipe(
				client,
				personalMediaSuggestionsRecipe({ limit: 10, entitySchemaSlug: schema.slug }),
			);
			expect(result.items).toHaveLength(2);
			const first = result.items[0];
			const second = result.items[1];
			assertPresent(first, "Expected top suggestion");
			assertPresent(second, "Expected second suggestion");
			expect(first.id).toBe(candidateTop.entity.id);
			expect(first.recommendingSourceCount).toBe(2);
			expect(second.id).toBe(candidateOther.entity.id);
			expect(second.recommendingSourceCount).toBe(1);
			expect(result.items.map((item) => item.id)).not.toContain(alreadyOwned.entity.id);
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

			const result = yield* executeRyotQLRecipe(
				client,
				collectionMediaSuggestionsRecipe({
					limit: 10,
					collectionId: collection.id,
					entitySchemaSlug: schema.slug,
				}),
			);
			const byId = new Map(
				result.items.map((item) => [String(item.id), item.recommendingSourceCount]),
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

				const result = yield* executeRyotQLRecipe(
					client,
					trendingMediaRecipe({ limit: 10, fetchedAt, entitySchemaSlug: bookSchema.slug }),
				);
				expect(result.items).toHaveLength(2);
				const first = result.items[0];
				const secondResult = result.items[1];
				assertPresent(first, "Expected first trending row");
				assertPresent(secondResult, "Expected second trending row");
				expect(first.id).toBe(top.entity.id);
				expect(first.name).toBe(top.entity.name);
				expect(first.schemaSlug).toBe(bookSchema.slug);
				expect(first.rank).toBe(1);
				expect(first.fetchedAt).toBe(fetchedAt);
				expect(secondResult.id).toBe(secondBook.entity.id);
				expect(secondResult.rank).toBe(2);
			}),
	);

	it.live("journals parent, regular episode and special activity in one ordered history", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const seeded = yield* seedActivityShow(client);
			yield* createEventFixture(client, {
				entityId: seeded.show.id,
				occurredAt: "2024-03-01T12:00:00.000Z",
				eventSchemaSlug: seeded.showEvents.backlog,
			});
			for (const [occurredAt, progressPercent] of [
				["2024-03-02T12:00:00.000Z", 10],
				["2024-03-03T12:00:00.000Z", 60],
				["2024-03-04T12:00:00.000Z", 90],
			] as const) {
				yield* createEventFixture(client, {
					occurredAt,
					entityId: seeded.firstEpisode.id,
					eventSchemaSlug: seeded.episodeEvents.progress,
					properties: { progressPercent, consumedOn: "Jellyfin" },
				});
			}
			yield* createEventFixture(client, {
				entityId: seeded.firstEpisode.id,
				occurredAt: "2024-03-05T12:00:00.000Z",
				eventSchemaSlug: seeded.episodeEvents.complete,
				properties: { timeSpent: 45, consumedOn: "Jellyfin", completionMode: "unknown" },
			});
			yield* createEventFixture(client, {
				entityId: seeded.firstEpisode.id,
				occurredAt: "2024-03-06T12:00:00.000Z",
				eventSchemaSlug: seeded.episodeEvents.review,
				properties: { rating: 90, isSpoiler: true, text: "The arrest scene is the whole show." },
			});
			yield* createEventFixture(client, {
				entityId: seeded.secondEpisode.id,
				properties: { progressPercent: 35 },
				occurredAt: "2024-03-07T12:00:00.000Z",
				eventSchemaSlug: seeded.episodeEvents.progress,
			});
			yield* createEventFixture(client, {
				entityId: seeded.specialEpisode.id,
				properties: { progressPercent: 20 },
				occurredAt: "2024-03-08T12:00:00.000Z",
				eventSchemaSlug: seeded.episodeEvents.progress,
			});
			yield* createEventFixture(client, {
				entityId: seeded.show.id,
				occurredAt: "2024-03-09T12:00:00.000Z",
				properties: { completionMode: "unknown" },
				eventSchemaSlug: seeded.showEvents.complete,
			});
			yield* createEventFixture(client, {
				entityId: seeded.show.id,
				properties: { rating: 75 },
				occurredAt: "2024-03-10T12:00:00.000Z",
				eventSchemaSlug: seeded.showEvents.review,
			});

			const activity = yield* executeRyotQLRecipe(
				client,
				showRecipes.activityRecipe({ ...ACTIVITY_LIMITS, entityId: seeded.show.id }),
			);
			const identity = activity.events.map((event) => ({
				kind: event.kind,
				occurredAt: event.occurredAt,
				eventSchemaSlug: event.eventSchemaSlug,
				seasonNumber: event.kind === "episode" ? event.episode.seasonNumber : null,
				episodeNumber: event.kind === "episode" ? event.episode.episodeNumber : null,
			}));

			expect(activity.truncated).toBe(false);
			expect(new Set(activity.events.map((event) => event.id)).size).toBe(activity.events.length);
			expect(
				activity.coverage.map((season) => ({
					seasonNumber: season.seasonNumber,
					episodeTotal: season.episodeTotal,
				})),
			).toEqual([
				{ seasonNumber: 0, episodeTotal: 1 },
				{ seasonNumber: 1, episodeTotal: 2 },
			]);
			expect(activity.watchCount).toBe(1);
			expect(
				activity.watchDays.map((watch) => ({
					day: watch.day,
					minutes: watch.minutes,
					runtime: watch.runtime,
					seasonNumber: watch.seasonNumber,
					episodeNumber: watch.episodeNumber,
				})),
			).toEqual([
				{
					minutes: 45,
					runtime: 31,
					seasonNumber: 1,
					episodeNumber: 1,
					day: "2024-03-05T00:00:00.000Z",
				},
			]);
			expect(
				activity.coverage.map((season) => ({
					seasonNumber: season.seasonNumber,
					watchedTotal: season.watchedTotal,
					watchedMinutes: season.watchedMinutes,
					watchedUnknownRuntime: season.watchedUnknownRuntime,
				})),
			).toEqual([
				{ seasonNumber: 0, watchedTotal: 0, watchedMinutes: null, watchedUnknownRuntime: 0 },
				{ seasonNumber: 1, watchedTotal: 1, watchedMinutes: 45, watchedUnknownRuntime: 0 },
			]);
			expect(identity).toEqual([
				{
					kind: "parent",
					seasonNumber: null,
					episodeNumber: null,
					eventSchemaSlug: "review",
					occurredAt: "2024-03-10T12:00:00.000Z",
				},
				{
					kind: "parent",
					seasonNumber: null,
					episodeNumber: null,
					eventSchemaSlug: "complete",
					occurredAt: "2024-03-09T12:00:00.000Z",
				},
				{
					kind: "episode",
					seasonNumber: 0,
					episodeNumber: 1,
					eventSchemaSlug: "progress",
					occurredAt: "2024-03-08T12:00:00.000Z",
				},
				{
					kind: "episode",
					seasonNumber: 1,
					episodeNumber: 2,
					eventSchemaSlug: "progress",
					occurredAt: "2024-03-07T12:00:00.000Z",
				},
				{
					kind: "episode",
					seasonNumber: 1,
					episodeNumber: 1,
					eventSchemaSlug: "review",
					occurredAt: "2024-03-06T12:00:00.000Z",
				},
				{
					kind: "parent",
					seasonNumber: null,
					episodeNumber: null,
					eventSchemaSlug: "backlog",
					occurredAt: "2024-03-01T12:00:00.000Z",
				},
			]);
		}),
	);

	it.live("collapses dense episode progress into the latest milestone per episode", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const seeded = yield* seedActivityShow(client);
			for (const [occurredAt, progressPercent] of [
				["2024-04-01T12:00:00.000Z", 5],
				["2024-04-02T12:00:00.000Z", 45],
				["2024-04-03T12:00:00.000Z", 85],
			] as const) {
				yield* createEventFixture(client, {
					occurredAt,
					entityId: seeded.firstEpisode.id,
					eventSchemaSlug: seeded.episodeEvents.progress,
					properties: { progressPercent, consumedOn: "Plex" },
				});
			}

			const activity = yield* executeRyotQLRecipe(
				client,
				showRecipes.activityRecipe({ ...ACTIVITY_LIMITS, entityId: seeded.show.id }),
			);

			expect(activity.events).toHaveLength(1);
			expect(activity.events[0]).toMatchObject({
				kind: "episode",
				consumedOn: "Plex",
				progressPercent: 85,
				eventSchemaSlug: "progress",
				occurredAt: "2024-04-03T12:00:00.000Z",
			});
		}),
	);

	it.live("keeps optional event properties absent instead of failing the activity result", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const seeded = yield* seedActivityShow(client);
			yield* createEventFixture(client, {
				entityId: seeded.show.id,
				occurredAt: "2024-05-01T12:00:00.000Z",
				eventSchemaSlug: seeded.showEvents.backlog,
			});
			yield* createEventFixture(client, {
				entityId: seeded.secondEpisode.id,
				occurredAt: "2024-05-02T12:00:00.000Z",
				properties: { completionMode: "unknown" },
				eventSchemaSlug: seeded.episodeEvents.complete,
			});

			const activity = yield* executeRyotQLRecipe(
				client,
				showRecipes.activityRecipe({ ...ACTIVITY_LIMITS, entityId: seeded.show.id }),
			);

			expect(activity.watchDays[0]).toMatchObject({
				runtime: 32,
				minutes: null,
				seasonNumber: 1,
				consumedOn: null,
				episodeNumber: 2,
			});
			expect(activity.events[0]).toMatchObject({
				kind: "parent",
				timeSpent: null,
				consumedOn: null,
				eventSchemaSlug: "backlog",
			});
		}),
	);

	it.live("reads special-episode activity that no session entity links to the show", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const seeded = yield* seedActivityShow(client);
			yield* createEventFixture(client, {
				entityId: seeded.specialEpisode.id,
				occurredAt: "2024-06-01T12:00:00.000Z",
				properties: { completionMode: "unknown" },
				sessionEntityId: seeded.specialEpisode.id,
				eventSchemaSlug: seeded.episodeEvents.complete,
			});

			const activity = yield* executeRyotQLRecipe(
				client,
				showRecipes.activityRecipe({ ...ACTIVITY_LIMITS, entityId: seeded.show.id }),
			);

			expect(activity.events).toHaveLength(0);
			expect(activity.watchDays).toHaveLength(1);
			expect(activity.watchDays[0]).toMatchObject({
				seasonNumber: 0,
				episodeNumber: 1,
				day: "2024-06-01T00:00:00.000Z",
			});
		}),
	);

	it.live("reports truncation when the recorded activity outgrows the requested page", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const seeded = yield* seedActivityShow(client);
			for (const occurredAt of ["2024-07-01T12:00:00.000Z", "2024-07-02T12:00:00.000Z"]) {
				yield* createEventFixture(client, {
					occurredAt,
					entityId: seeded.show.id,
					properties: { completionMode: "unknown" },
					eventSchemaSlug: seeded.showEvents.complete,
				});
			}

			const activity = yield* executeRyotQLRecipe(
				client,
				showRecipes.activityRecipe({
					...ACTIVITY_LIMITS,
					parentEventLimit: 1,
					entityId: seeded.show.id,
				}),
			);

			expect(activity.truncated).toBe(true);
			expect(activity.events).toHaveLength(1);
			expect(activity.events[0]).toMatchObject({ occurredAt: "2024-07-02T12:00:00.000Z" });
		}),
	);
});
