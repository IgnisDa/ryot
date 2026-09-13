import { EntityId, RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	podcastDetailRecipe,
	podcastsByLifecycleStateRecipe,
	showsByLifecycleStateRecipe,
} from "@ryot-app/media-plugin/query-recipes";
import { movieRecipes } from "@ryot-app/media-plugin/shared/movie-recipes";
import { podcastRecipes } from "@ryot-app/media-plugin/shared/podcast-recipes";
import { showRecipes, showSeasonEpisodesRecipe } from "@ryot-app/media-plugin/shared/show-recipes";
import { column, descending, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEventFixture,
	executeRyotQL,
	executeRyotQLRecipe,
	fakeProviderDetailsResult,
	getBuiltinEntitySchemaSlug,
	insertGlobalRelationship,
	installTestProvider,
	listAdminGlobalRelationships,
	listEventSchemas,
	listEventsForEntity,
	listRelationshipSchemas,
	pollUntil,
	providerSandboxSource,
	replaceSandboxScriptCompiledRepresentation,
	requireEventSchemaBySlug,
	requireRelationshipSchemaBySlug,
	requireRows,
	requireRyotQLDate,
	requireRyotQLText,
	type Client,
} from "~/fixtures/kernel";
import {
	enableMediaMonitoring,
	getGlobalEntityByProvenance,
	insertLibraryMembership,
	seedMediaEntity,
	triggerCronAndWaitForEntity,
} from "~/fixtures/plugins/media";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const lifecycleStates = [
	"untracked",
	"backlog",
	"in_progress",
	"on_hold",
	"dropped",
	"caught_up",
	"complete",
] as const;

type LifecycleState = (typeof lifecycleStates)[number];
type SeededMediaEntity = Effect.Success<ReturnType<typeof seedMediaEntity>>;

const loadLifecycleSchemas = (client: Client) =>
	Effect.gen(function* () {
		const loaded = yield* Effect.all({
			showSchemaId: getBuiltinEntitySchemaSlug(client, "show"),
			podcastSchemaId: getBuiltinEntitySchemaSlug(client, "podcast"),
			showSeasonSchemaId: getBuiltinEntitySchemaSlug(client, "show-season"),
			showEpisodeSchemaId: getBuiltinEntitySchemaSlug(client, "show-episode"),
			podcastEpisodeSchemaId: getBuiltinEntitySchemaSlug(client, "podcast-episode"),
			relationshipSchemas: listRelationshipSchemas(client, {
				slugs: ["show-to-show-season", "show-season-to-show-episode", "podcast-to-podcast-episode"],
			}),
		});
		const [showEvents, showEpisodeEvents, podcastEvents, podcastEpisodeEvents] = yield* Effect.all([
			listEventSchemas(client, loaded.showSchemaId),
			listEventSchemas(client, loaded.showEpisodeSchemaId),
			listEventSchemas(client, loaded.podcastSchemaId),
			listEventSchemas(client, loaded.podcastEpisodeSchemaId),
		]);
		return {
			...loaded,
			showToSeasonRelationship: requireRelationshipSchemaBySlug(
				loaded.relationshipSchemas,
				"show-to-show-season",
			).id,
			seasonToEpisodeRelationship: requireRelationshipSchemaBySlug(
				loaded.relationshipSchemas,
				"show-season-to-show-episode",
			).id,
			podcastToEpisodeRelationship: requireRelationshipSchemaBySlug(
				loaded.relationshipSchemas,
				"podcast-to-podcast-episode",
			).id,
			showEpisodeEvents: {
				complete: requireEventSchemaBySlug(showEpisodeEvents, "complete").id,
				progress: requireEventSchemaBySlug(showEpisodeEvents, "progress").id,
			},
			podcastEpisodeEvents: {
				complete: requireEventSchemaBySlug(podcastEpisodeEvents, "complete").id,
				progress: requireEventSchemaBySlug(podcastEpisodeEvents, "progress").id,
			},
			showEvents: {
				onHold: requireEventSchemaBySlug(showEvents, "on_hold").id,
				backlog: requireEventSchemaBySlug(showEvents, "backlog").id,
				dropped: requireEventSchemaBySlug(showEvents, "dropped").id,
				complete: requireEventSchemaBySlug(showEvents, "complete").id,
			},
			podcastEvents: {
				onHold: requireEventSchemaBySlug(podcastEvents, "on_hold").id,
				dropped: requireEventSchemaBySlug(podcastEvents, "dropped").id,
				backlog: requireEventSchemaBySlug(podcastEvents, "backlog").id,
				complete: requireEventSchemaBySlug(podcastEvents, "complete").id,
			},
		};
	});

type LifecycleSchemas = Effect.Success<ReturnType<typeof loadLifecycleSchemas>>;

const AIRED = "2020-01-01";
const UNAIRED = "2999-01-01";

type PublishDates = ReadonlyArray<string | null>;

const publishDateAt = (publishDates: PublishDates | undefined, index: number) =>
	publishDates === undefined ? AIRED : (publishDates[index] ?? AIRED);

const seedShowEpisode = (
	schemas: LifecycleSchemas,
	input: {
		readonly suffix: string;
		readonly seasonId: string;
		readonly seasonNumber: number;
		readonly episodeNumber: number;
		readonly publishDate: string | null;
	},
) =>
	Effect.gen(function* () {
		const entity = yield* seedMediaEntity({
			userId: null,
			providerId: null,
			entitySchemaSlug: schemas.showEpisodeSchemaId,
			name: `S${input.seasonNumber}E${input.episodeNumber} ${input.suffix}`,
			externalId: `lifecycle-episode-${input.seasonNumber}-${input.episodeNumber}-${input.suffix}`,
			properties: {
				publishDate: input.publishDate,
				seasonNumber: input.seasonNumber,
				episodeNumber: input.episodeNumber,
			},
		});
		yield* insertGlobalRelationship({
			targetEntityId: entity.id,
			sourceEntityId: input.seasonId,
			relationshipSchemaSlug: schemas.seasonToEpisodeRelationship,
		});
		return entity;
	});

const seedShow = (
	client: Client,
	schemas: LifecycleSchemas,
	input: {
		readonly productionStatus?: string | null;
		readonly seasons: ReadonlyArray<{
			readonly episodeCount: number;
			readonly seasonNumber: number;
			readonly publishDates?: PublishDates;
		}>;
	},
) =>
	Effect.gen(function* () {
		const suffix = crypto.randomUUID();
		const show = yield* seedMediaEntity({
			userId: null,
			providerId: null,
			name: `Lifecycle Show ${suffix}`,
			externalId: `lifecycle-show-${suffix}`,
			entitySchemaSlug: schemas.showSchemaId,
			properties: {
				totalSeasons: input.seasons.length,
				productionStatus: input.productionStatus ?? null,
				totalEpisodes: input.seasons.reduce((total, season) => total + season.episodeCount, 0),
			},
		});
		yield* insertLibraryMembership(client, { mediaEntityId: show.id });
		const seasons: SeededMediaEntity[] = [];
		const episodes: Array<{ entity: SeededMediaEntity; seasonNumber: number }> = [];
		for (const seasonInput of input.seasons) {
			const season = yield* seedMediaEntity({
				userId: null,
				providerId: null,
				entitySchemaSlug: schemas.showSeasonSchemaId,
				name: `Season ${seasonInput.seasonNumber} ${suffix}`,
				properties: { seasonNumber: seasonInput.seasonNumber },
				externalId: `lifecycle-season-${seasonInput.seasonNumber}-${suffix}`,
			});
			seasons.push(season);
			yield* insertGlobalRelationship({
				sourceEntityId: show.id,
				targetEntityId: season.id,
				relationshipSchemaSlug: schemas.showToSeasonRelationship,
			});
			for (let episodeNumber = 1; episodeNumber <= seasonInput.episodeCount; episodeNumber += 1) {
				const entity = yield* seedShowEpisode(schemas, {
					suffix,
					episodeNumber,
					seasonId: season.id,
					seasonNumber: seasonInput.seasonNumber,
					publishDate: publishDateAt(seasonInput.publishDates, episodeNumber - 1),
				});
				episodes.push({ entity, seasonNumber: seasonInput.seasonNumber });
			}
		}
		return { show, suffix, seasons, episodes };
	});

const seedPodcast = (
	client: Client,
	schemas: LifecycleSchemas,
	input: {
		readonly episodeCount: number;
		readonly publishDates?: PublishDates;
		readonly productionStatus?: string | null;
	},
) =>
	Effect.gen(function* () {
		const suffix = crypto.randomUUID();
		const podcast = yield* seedMediaEntity({
			userId: null,
			providerId: null,
			name: `Lifecycle Podcast ${suffix}`,
			externalId: `lifecycle-podcast-${suffix}`,
			entitySchemaSlug: schemas.podcastSchemaId,
			properties: {
				totalEpisodes: input.episodeCount,
				productionStatus: input.productionStatus ?? null,
			},
		});
		yield* insertLibraryMembership(client, { mediaEntityId: podcast.id });
		const episodes: SeededMediaEntity[] = [];
		for (let episodeNumber = 1; episodeNumber <= input.episodeCount; episodeNumber += 1) {
			const episode = yield* seedMediaEntity({
				userId: null,
				providerId: null,
				entitySchemaSlug: schemas.podcastEpisodeSchemaId,
				name: `Podcast Episode ${episodeNumber} ${suffix}`,
				externalId: `lifecycle-podcast-episode-${episodeNumber}-${suffix}`,
				properties: {
					episodeNumber,
					publishDate: publishDateAt(input.publishDates, episodeNumber - 1),
				},
			});
			episodes.push(episode);
			yield* insertGlobalRelationship({
				sourceEntityId: podcast.id,
				targetEntityId: episode.id,
				relationshipSchemaSlug: schemas.podcastToEpisodeRelationship,
			});
		}
		return { podcast, episodes };
	});

const waitForCompletions = (client: Client, entityId: string, expectedCount: number) =>
	pollUntil(
		`${expectedCount} complete events on entity ${entityId}`,
		Effect.gen(function* () {
			const events = yield* listEventsForEntity(client, entityId, undefined, 100, {
				eventSchemaSlug: "complete",
			});
			return events.length >= expectedCount ? events : null;
		}),
	);

const readShowSummary = (client: Client, entityId: string) =>
	Effect.gen(function* () {
		const result = yield* executeRyotQLRecipe(
			client,
			showRecipes.summaryRecipe({ entityId, collectionLimit: 1 }),
		);
		assertPresent(result.summary, "Expected a show summary row");
		return result.summary;
	});

const readPodcastSummary = (client: Client, entityId: string) =>
	Effect.gen(function* () {
		const result = yield* executeRyotQLRecipe(
			client,
			podcastRecipes.summaryRecipe({ entityId, collectionLimit: 1 }),
		);
		assertPresent(result.summary, "Expected a podcast summary row");
		return result.summary;
	});

const readSeasonStates = (client: Client, seasonId: string) =>
	Effect.gen(function* () {
		const page = yield* executeRyotQLRecipe(
			client,
			showSeasonEpisodesRecipe({ limit: 10, containerId: seasonId }),
		);
		return page.items.map((episode) => episode.state);
	});

const assertShowState = (client: Client, entityId: string, expected: LifecycleState) =>
	Effect.gen(function* () {
		const results = yield* Effect.all(
			lifecycleStates.map((state) =>
				executeRyotQLRecipe(client, showsByLifecycleStateRecipe({ state, entityId, limit: 1 })),
			),
		);
		const memberships = results.flatMap((result, index) =>
			result.items.some((item) => item.id === entityId) ? [lifecycleStates[index]] : [],
		);
		expect(memberships).toEqual([expected]);
	});

const assertPodcastState = (client: Client, entityId: string, expected: LifecycleState) =>
	Effect.gen(function* () {
		const results = yield* Effect.all(
			lifecycleStates.map((state) =>
				executeRyotQLRecipe(client, podcastsByLifecycleStateRecipe({ state, entityId, limit: 1 })),
			),
		);
		const memberships = results.flatMap((result, index) =>
			result.items.some((item) => item.id === entityId) ? [lifecycleStates[index]] : [],
		);
		expect(memberships).toEqual([expected]);
	});

const createProgress = (
	client: Client,
	entityId: string,
	eventSchemaSlug: string,
	occurredAt: string,
) =>
	createEventFixture(client, {
		entityId,
		occurredAt,
		eventSchemaSlug,
		properties: { progressPercent: 50 },
	});

const createComplete = (
	client: Client,
	entityId: string,
	eventSchemaSlug: string,
	occurredAt: string,
) =>
	createEventFixture(client, {
		entityId,
		occurredAt,
		eventSchemaSlug,
		properties: { completionMode: "unknown" },
	});

const readCreatedOrder = (client: Client, entityId: string, occurredAt: string) =>
	Effect.gen(function* () {
		const event = table("event", "event");
		const result = yield* executeRyotQL(
			client,
			document({
				events: rows(event, {
					limit: 10,
					where: eq(column(event, "entityId"), literal(entityId)),
					orderBy: [descending(column(event, "createdAt")), descending(column(event, "id"))],
					fields: [
						field("createdAt", column(event, "createdAt")),
						field("occurredAt", column(event, "occurredAt")),
						field("eventSchemaSlug", column(event, "eventSchemaSlug")),
					],
				}),
			}),
		);
		return requireRows(result.data.events, "events")
			.items.filter((item) => requireRyotQLDate(item, "occurredAt") === occurredAt)
			.map((item) => ({
				createdAt: requireRyotQLDate(item, "createdAt"),
				eventSchemaSlug: requireRyotQLText(item, "eventSchemaSlug"),
			}));
	});

describe("Media episodic lifecycle query recipes", () => {
	it.live(
		"covers show transitions through interruptions, manual completion, resume, and caught up",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const schemas = yield* loadLifecycleSchemas(client);
				const { show, episodes } = yield* seedShow(client, schemas, {
					productionStatus: "Continuing",
					seasons: [{ seasonNumber: 1, episodeCount: 2 }],
				});
				const firstEpisode = episodes[0]?.entity;
				const secondEpisode = episodes[1]?.entity;
				assertPresent(firstEpisode, "Expected first show episode");
				assertPresent(secondEpisode, "Expected second show episode");

				yield* assertShowState(client, show.id, "untracked");
				yield* createProgress(
					client,
					firstEpisode.id,
					schemas.showEpisodeEvents.progress,
					"2026-05-01T01:00:00.000Z",
				);
				yield* assertShowState(client, show.id, "in_progress");
				yield* createEventFixture(client, {
					properties: {},
					entityId: show.id,
					occurredAt: "2026-05-01T02:00:00.000Z",
					eventSchemaSlug: schemas.showEvents.backlog,
				});
				yield* assertShowState(client, show.id, "backlog");
				yield* createProgress(
					client,
					firstEpisode.id,
					schemas.showEpisodeEvents.progress,
					"2026-05-01T03:00:00.000Z",
				);
				yield* assertShowState(client, show.id, "in_progress");
				yield* createEventFixture(client, {
					entityId: show.id,
					properties: { progressPercent: 50 },
					occurredAt: "2026-05-01T04:00:00.000Z",
					eventSchemaSlug: schemas.showEvents.onHold,
				});
				yield* assertShowState(client, show.id, "on_hold");
				yield* createProgress(
					client,
					firstEpisode.id,
					schemas.showEpisodeEvents.progress,
					"2026-05-01T05:00:00.000Z",
				);
				yield* assertShowState(client, show.id, "in_progress");
				yield* createEventFixture(client, {
					entityId: show.id,
					properties: { progressPercent: 50 },
					occurredAt: "2026-05-01T06:00:00.000Z",
					eventSchemaSlug: schemas.showEvents.dropped,
				});
				yield* assertShowState(client, show.id, "dropped");
				yield* createProgress(
					client,
					firstEpisode.id,
					schemas.showEpisodeEvents.progress,
					"2026-05-01T07:00:00.000Z",
				);
				yield* assertShowState(client, show.id, "in_progress");
				yield* createComplete(
					client,
					show.id,
					schemas.showEvents.complete,
					"2026-05-01T08:00:00.000Z",
				);
				yield* assertShowState(client, show.id, "complete");
				yield* createProgress(
					client,
					firstEpisode.id,
					schemas.showEpisodeEvents.progress,
					"2026-05-01T09:00:00.000Z",
				);
				yield* assertShowState(client, show.id, "in_progress");
				yield* createComplete(
					client,
					firstEpisode.id,
					schemas.showEpisodeEvents.complete,
					"2026-05-01T10:00:00.000Z",
				);
				yield* assertShowState(client, show.id, "in_progress");
				yield* createComplete(
					client,
					secondEpisode.id,
					schemas.showEpisodeEvents.complete,
					"2026-05-01T11:00:00.000Z",
				);
				yield* assertShowState(client, show.id, "caught_up");
			}),
	);

	it.live("automatically completes terminal coverage and isolates rewatch cycles", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* loadLifecycleSchemas(client);
			const cycles = yield* seedShow(client, schemas, {
				productionStatus: "Ended",
				seasons: [{ seasonNumber: 1, episodeCount: 2 }],
			});
			const firstEpisode = cycles.episodes[0]?.entity;
			const secondEpisode = cycles.episodes[1]?.entity;
			assertPresent(firstEpisode, "Expected first cycle show episode");
			assertPresent(secondEpisode, "Expected second cycle show episode");

			yield* createComplete(
				client,
				firstEpisode.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-02T01:00:00.000Z",
			);
			yield* assertShowState(client, cycles.show.id, "in_progress");
			yield* createComplete(
				client,
				secondEpisode.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-02T02:00:00.000Z",
			);
			yield* waitForCompletions(client, cycles.show.id, 1);
			yield* assertShowState(client, cycles.show.id, "complete");

			yield* createComplete(
				client,
				firstEpisode.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-02T03:00:00.000Z",
			);
			yield* assertShowState(client, cycles.show.id, "in_progress");
			yield* createComplete(
				client,
				secondEpisode.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-02T04:00:00.000Z",
			);
			const parentEvents = yield* waitForCompletions(client, cycles.show.id, 2);
			expect(parentEvents.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(2);
			yield* assertShowState(client, cycles.show.id, "complete");

			const detailFixture = yield* seedShow(client, schemas, {
				productionStatus: "Continuing",
				seasons: [{ seasonNumber: 1, episodeCount: 1 }],
			});
			const detailEpisode = detailFixture.episodes[0]?.entity;
			assertPresent(detailEpisode, "Expected detail show episode");
			yield* createComplete(
				client,
				detailEpisode.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-02T05:00:00.000Z",
			);
			yield* assertShowState(client, detailFixture.show.id, "caught_up");
			yield* createProgress(
				client,
				detailEpisode.id,
				schemas.showEpisodeEvents.progress,
				"2026-05-02T06:00:00.000Z",
			);
			yield* assertShowState(client, detailFixture.show.id, "in_progress");
			const season = detailFixture.seasons[0];
			assertPresent(season, "Expected show season");
			const detail = yield* executeRyotQLRecipe(
				client,
				showSeasonEpisodesRecipe({ limit: 10, containerId: season.id }),
			);
			assertPresent(detail, "Expected season episodes");
			const episode = detail.items[0];
			assertPresent(episode, "Expected episode detail");
			expect(episode.state).toBe("in_progress");
			expect(episode).not.toHaveProperty("hasProgress");
			expect(episode).not.toHaveProperty("isComplete");
		}),
	);

	it.live("uses occurredAt before creation order and createdAt for equal occurrence times", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* loadLifecycleSchemas(client);
			const fixture = yield* seedShow(client, schemas, {
				seasons: [{ seasonNumber: 1, episodeCount: 1 }],
			});
			const episode = fixture.episodes[0]?.entity;
			assertPresent(episode, "Expected chronological show episode");

			yield* createProgress(
				client,
				episode.id,
				schemas.showEpisodeEvents.progress,
				"2026-05-03T02:00:00.000Z",
			);
			yield* createEventFixture(client, {
				entityId: fixture.show.id,
				properties: { progressPercent: 50 },
				occurredAt: "2026-05-03T01:00:00.000Z",
				eventSchemaSlug: schemas.showEvents.dropped,
			});
			yield* assertShowState(client, fixture.show.id, "in_progress");

			const equalOccurredAt = "2026-05-03T03:00:00.000Z";
			yield* createEventFixture(client, {
				properties: {},
				entityId: fixture.show.id,
				occurredAt: equalOccurredAt,
				eventSchemaSlug: schemas.showEvents.backlog,
			});
			yield* Effect.sleep("25 millis");
			yield* createEventFixture(client, {
				entityId: fixture.show.id,
				occurredAt: equalOccurredAt,
				properties: { progressPercent: 50 },
				eventSchemaSlug: schemas.showEvents.onHold,
			});
			const createdOrder = yield* readCreatedOrder(client, fixture.show.id, equalOccurredAt);
			expect(createdOrder.map((event) => event.eventSchemaSlug)).toEqual(["on_hold", "backlog"]);
			expect(Date.parse(createdOrder[0]?.createdAt ?? "")).toBeGreaterThan(
				Date.parse(createdOrder[1]?.createdAt ?? ""),
			);
			yield* assertShowState(client, fixture.show.id, "on_hold");
		}),
	);

	it.live("guards empty coverage and isolates season zero episode activity", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* loadLifecycleSchemas(client);
			const noSeasons = yield* seedShow(client, schemas, { seasons: [] });
			const specialsOnly = yield* seedShow(client, schemas, {
				seasons: [{ seasonNumber: 0, episodeCount: 1 }],
			});
			const emptyRegularSeason = yield* seedShow(client, schemas, {
				seasons: [{ seasonNumber: 1, episodeCount: 0 }],
			});
			const mixedRegularSeasons = yield* seedShow(client, schemas, {
				seasons: [
					{ seasonNumber: 1, episodeCount: 1 },
					{ seasonNumber: 2, episodeCount: 0 },
				],
			});
			const special = specialsOnly.episodes[0]?.entity;
			const regularEpisode = mixedRegularSeasons.episodes[0]?.entity;
			assertPresent(special, "Expected season zero episode");
			assertPresent(regularEpisode, "Expected regular episode");

			yield* assertShowState(client, noSeasons.show.id, "untracked");
			yield* assertShowState(client, emptyRegularSeason.show.id, "untracked");
			yield* createComplete(
				client,
				special.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-04T01:00:00.000Z",
			);
			yield* assertShowState(client, specialsOnly.show.id, "untracked");
			const specialSeason = specialsOnly.seasons[0];
			assertPresent(specialSeason, "Expected specials season");
			const specialDetail = yield* executeRyotQLRecipe(
				client,
				showSeasonEpisodesRecipe({ limit: 10, containerId: specialSeason.id }),
			);
			assertPresent(specialDetail, "Expected specials season episodes");
			const specialEpisode = specialDetail.items[0];
			assertPresent(specialEpisode, "Expected special episode detail");
			expect(specialEpisode.state).toBe("complete");

			yield* createComplete(
				client,
				regularEpisode.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-04T02:00:00.000Z",
			);
			yield* assertShowState(client, mixedRegularSeasons.show.id, "caught_up");
		}),
	);

	it.live("applies interruption, manual completion, caught-up, and rewatch rules to podcasts", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* loadLifecycleSchemas(client);
			const { podcast, episodes } = yield* seedPodcast(client, schemas, {
				episodeCount: 2,
				productionStatus: "Continuing",
			});
			const firstEpisode = episodes[0];
			const secondEpisode = episodes[1];
			assertPresent(firstEpisode, "Expected first podcast episode");
			assertPresent(secondEpisode, "Expected second podcast episode");

			yield* assertPodcastState(client, podcast.id, "untracked");
			yield* createProgress(
				client,
				firstEpisode.id,
				schemas.podcastEpisodeEvents.progress,
				"2026-05-05T01:00:00.000Z",
			);
			yield* assertPodcastState(client, podcast.id, "in_progress");
			yield* createEventFixture(client, {
				properties: {},
				entityId: podcast.id,
				occurredAt: "2026-05-05T02:00:00.000Z",
				eventSchemaSlug: schemas.podcastEvents.backlog,
			});
			yield* assertPodcastState(client, podcast.id, "backlog");
			yield* createProgress(
				client,
				firstEpisode.id,
				schemas.podcastEpisodeEvents.progress,
				"2026-05-05T03:00:00.000Z",
			);
			yield* assertPodcastState(client, podcast.id, "in_progress");
			yield* createEventFixture(client, {
				entityId: podcast.id,
				properties: { progressPercent: 50 },
				occurredAt: "2026-05-05T04:00:00.000Z",
				eventSchemaSlug: schemas.podcastEvents.onHold,
			});
			yield* assertPodcastState(client, podcast.id, "on_hold");
			yield* createProgress(
				client,
				firstEpisode.id,
				schemas.podcastEpisodeEvents.progress,
				"2026-05-05T05:00:00.000Z",
			);
			yield* assertPodcastState(client, podcast.id, "in_progress");
			yield* createEventFixture(client, {
				entityId: podcast.id,
				properties: { progressPercent: 50 },
				occurredAt: "2026-05-05T06:00:00.000Z",
				eventSchemaSlug: schemas.podcastEvents.dropped,
			});
			yield* assertPodcastState(client, podcast.id, "dropped");
			yield* createProgress(
				client,
				firstEpisode.id,
				schemas.podcastEpisodeEvents.progress,
				"2026-05-05T07:00:00.000Z",
			);
			yield* assertPodcastState(client, podcast.id, "in_progress");
			yield* createComplete(
				client,
				podcast.id,
				schemas.podcastEvents.complete,
				"2026-05-05T08:00:00.000Z",
			);
			yield* assertPodcastState(client, podcast.id, "complete");
			yield* createComplete(
				client,
				firstEpisode.id,
				schemas.podcastEpisodeEvents.complete,
				"2026-05-05T09:00:00.000Z",
			);
			yield* assertPodcastState(client, podcast.id, "in_progress");
			yield* createComplete(
				client,
				secondEpisode.id,
				schemas.podcastEpisodeEvents.complete,
				"2026-05-05T10:00:00.000Z",
			);
			yield* assertPodcastState(client, podcast.id, "caught_up");

			const detail = yield* executeRyotQLRecipe(
				client,
				podcastDetailRecipe({ episodeLimit: 10, entityId: podcast.id }),
			);
			assertPresent(detail, "Expected podcast detail");
			expect(detail.state).toBe("caught_up");
			expect(detail).not.toHaveProperty("hasProgress");
			expect(detail).not.toHaveProperty("isComplete");
			for (const episode of detail.episodes.items) {
				expect(episode.state).toBe("complete");
				expect(episode).not.toHaveProperty("hasProgress");
				expect(episode).not.toHaveProperty("isComplete");
			}
		}),
	);

	it.live("automatically completes both terminal podcast consumption cycles", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* loadLifecycleSchemas(client);
			const { podcast, episodes } = yield* seedPodcast(client, schemas, {
				episodeCount: 1,
				productionStatus: "Ended",
			});
			const episode = episodes[0];
			assertPresent(episode, "Expected terminal podcast episode");

			yield* createComplete(
				client,
				episode.id,
				schemas.podcastEpisodeEvents.complete,
				"2026-05-05T11:00:00.000Z",
			);
			yield* waitForCompletions(client, podcast.id, 1);
			yield* assertPodcastState(client, podcast.id, "complete");

			yield* createComplete(
				client,
				episode.id,
				schemas.podcastEpisodeEvents.complete,
				"2026-05-05T12:00:00.000Z",
			);
			const parentEvents = yield* waitForCompletions(client, podcast.id, 2);
			expect(parentEvents.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(2);
			yield* assertPodcastState(client, podcast.id, "complete");
		}),
	);

	it.live(
		"derives caught up after authoritative relationship removal without auto-completing",
		() =>
			Effect.gen(function* () {
				const auth = yield* createAuthenticatedClient();
				const schemas = yield* loadLifecycleSchemas(auth.client);
				const suffix = crypto.randomUUID();
				const providerName = `Lifecycle Relationship Provider ${suffix}`;
				const providerSlug = `show.lifecycle-relationship-${suffix}`;
				const showExternalId = `lifecycle-relationship-show-${suffix}`;
				const seasonExternalId = `lifecycle-relationship-season-${suffix}`;
				const firstEpisodeExternalId = `lifecycle-relationship-episode-1-${suffix}`;
				const secondEpisodeExternalId = `lifecycle-relationship-episode-2-${suffix}`;
				const details = (episodeExternalIds: readonly string[]) =>
					fakeProviderDetailsResult({
						properties: { productionStatus: "Ended" },
						name: `Lifecycle Relationship Show ${suffix}`,
						childEntities: [
							{
								name: "Season 1",
								externalId: seasonExternalId,
								properties: { seasonNumber: 1 },
								entitySchemaSlug: "show-season",
								childEntities: episodeExternalIds.map((externalId, index) => ({
									externalId,
									name: `Episode ${index + 1}`,
									entitySchemaSlug: "show-episode" as const,
									properties: { seasonNumber: 1, episodeNumber: index + 1 },
								})),
							},
						],
					});
				const provider = yield* installTestProvider({
					scope: "system",
					name: providerName,
					slug: providerSlug,
					client: auth.client,
					rootEntitySchemaSlug: schemas.showSchemaId,
					details: details([firstEpisodeExternalId, secondEpisodeExternalId]),
				});
				const show = yield* seedMediaEntity({
					properties: {},
					externalId: showExternalId,
					providerId: provider.providerId,
					entitySchemaSlug: schemas.showSchemaId,
					name: `Lifecycle Relationship Show ${suffix}`,
				});
				yield* enableMediaMonitoring(auth.client, show.id);
				yield* triggerCronAndWaitForEntity(auth, show.id);
				const season = yield* getGlobalEntityByProvenance(auth.client, {
					externalId: seasonExternalId,
					providerId: provider.providerId,
					entitySchemaSlug: schemas.showSeasonSchemaId,
				});
				const firstEpisode = yield* getGlobalEntityByProvenance(auth.client, {
					providerId: provider.providerId,
					externalId: firstEpisodeExternalId,
					entitySchemaSlug: schemas.showEpisodeSchemaId,
				});
				const secondEpisode = yield* getGlobalEntityByProvenance(auth.client, {
					providerId: provider.providerId,
					externalId: secondEpisodeExternalId,
					entitySchemaSlug: schemas.showEpisodeSchemaId,
				});
				yield* createComplete(
					auth.client,
					firstEpisode.id,
					schemas.showEpisodeEvents.complete,
					"2026-05-06T01:00:00.000Z",
				);
				yield* assertShowState(auth.client, show.id, "in_progress");

				yield* replaceSandboxScriptCompiledRepresentation(
					auth.client,
					provider.detailsScriptId,
					providerSandboxSource({
						name: providerName,
						operation: "details",
						slug: `${provider.providerSlug}.details`,
						result: details([firstEpisodeExternalId]),
					}),
				);
				yield* triggerCronAndWaitForEntity(auth, show.id);
				const relationships = yield* listAdminGlobalRelationships({
					type: "anchored",
					direction: "outgoing",
					anchorEntityId: EntityId.make(season.id),
					relationshipSchemaSlug: RelationshipSchemaSlug.make(schemas.seasonToEpisodeRelationship),
				});
				expect(relationships.map((relationship) => relationship.targetEntityId)).toEqual([
					firstEpisode.id,
				]);
				expect(relationships.map((relationship) => relationship.targetEntityId)).not.toContain(
					secondEpisode.id,
				);
				yield* assertShowState(auth.client, show.id, "caught_up");
				const parentEvents = yield* listEventsForEntity(auth.client, show.id, undefined, 100);
				expect(parentEvents.some((event) => event.eventSchemaSlug === "complete")).toBe(false);
			}),
	);
});

describe("Media episodic coverage over aired episodes", () => {
	it.live("reads caught up while the remaining episodes are unaired and counts them upcoming", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* loadLifecycleSchemas(client);
			const { show, episodes } = yield* seedShow(client, schemas, {
				productionStatus: "Continuing",
				seasons: [
					{ seasonNumber: 0, episodeCount: 1 },
					{ seasonNumber: 1, episodeCount: 3, publishDates: [AIRED, AIRED, UNAIRED] },
					{ seasonNumber: 2, episodeCount: 2, publishDates: [UNAIRED, UNAIRED] },
				],
			});
			const aired = episodes.filter(({ seasonNumber }) => seasonNumber === 1).slice(0, 2);

			for (const [index, { entity }] of aired.entries()) {
				yield* createComplete(
					client,
					entity.id,
					schemas.showEpisodeEvents.complete,
					`2026-05-07T0${index + 1}:00:00.000Z`,
				);
			}

			yield* assertShowState(client, show.id, "caught_up");
			const summary = yield* readShowSummary(client, show.id);
			expect(summary).toMatchObject({
				nextUp: null,
				airedEpisodes: 2,
				watchedEpisodes: 2,
				upcomingEpisodes: 3,
				inProgressEpisodes: 0,
			});
		}),
	);

	it.live("flips a caught-up show back to in progress when a past-dated episode is added", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* loadLifecycleSchemas(client);
			const fixture = yield* seedShow(client, schemas, {
				productionStatus: "Continuing",
				seasons: [{ seasonNumber: 1, episodeCount: 1 }],
			});
			const episode = fixture.episodes[0]?.entity;
			const season = fixture.seasons[0];
			assertPresent(episode, "Expected the aired episode");
			assertPresent(season, "Expected the regular season");

			yield* createComplete(
				client,
				episode.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-08T01:00:00.000Z",
			);
			yield* assertShowState(client, fixture.show.id, "caught_up");

			const added = yield* seedShowEpisode(schemas, {
				seasonNumber: 1,
				episodeNumber: 2,
				publishDate: AIRED,
				seasonId: season.id,
				suffix: fixture.suffix,
			});
			yield* assertShowState(client, fixture.show.id, "in_progress");
			const summary = yield* readShowSummary(client, fixture.show.id);
			expect(summary.nextUp?.id).toBe(added.id);
		}),
	);

	it.live("counts null and malformed publish dates as aired", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* loadLifecycleSchemas(client);
			const { show, episodes } = yield* seedShow(client, schemas, {
				productionStatus: "Continuing",
				seasons: [{ seasonNumber: 1, episodeCount: 3, publishDates: [AIRED, null, "not-a-date"] }],
			});
			const [first, second, third] = episodes.map(({ entity }) => entity);
			assertPresent(first, "Expected the dated episode");
			assertPresent(second, "Expected the undated episode");
			assertPresent(third, "Expected the malformed episode");

			yield* createComplete(
				client,
				first.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-09T01:00:00.000Z",
			);
			yield* assertShowState(client, show.id, "in_progress");
			expect(yield* readShowSummary(client, show.id)).toMatchObject({
				airedEpisodes: 3,
				upcomingEpisodes: 0,
			});

			yield* createComplete(
				client,
				second.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-09T02:00:00.000Z",
			);
			yield* createComplete(
				client,
				third.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-09T03:00:00.000Z",
			);
			yield* assertShowState(client, show.id, "caught_up");
		}),
	);
});

describe("Media episodic next up and display state", () => {
	it.live("moves next up forward and ignores untracked gaps before the anchor", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* loadLifecycleSchemas(client);
			const { show, episodes } = yield* seedShow(client, schemas, {
				productionStatus: "Continuing",
				seasons: [
					{ seasonNumber: 1, episodeCount: 2 },
					{ seasonNumber: 2, episodeCount: 1 },
				],
			});
			const [first, second, third] = episodes.map(({ entity }) => entity);
			assertPresent(first, "Expected S1E1");
			assertPresent(second, "Expected S1E2");
			assertPresent(third, "Expected S2E1");

			expect((yield* readShowSummary(client, show.id)).nextUp).toBeNull();
			yield* createComplete(
				client,
				first.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-10T01:00:00.000Z",
			);
			expect((yield* readShowSummary(client, show.id)).nextUp?.id).toBe(second.id);
			yield* createComplete(
				client,
				second.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-10T02:00:00.000Z",
			);
			const crossesSeasons = yield* readShowSummary(client, show.id);
			expect(crossesSeasons.nextUp).toMatchObject({ id: third.id, seasonNumber: 2 });

			const gapped = yield* seedShow(client, schemas, {
				productionStatus: "Continuing",
				seasons: [{ seasonNumber: 1, episodeCount: 2 }],
			});
			const gappedLast = gapped.episodes[1]?.entity;
			assertPresent(gappedLast, "Expected the gapped show's last episode");
			yield* createComplete(
				client,
				gappedLast.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-10T03:00:00.000Z",
			);
			expect((yield* readShowSummary(client, gapped.show.id)).nextUp).toBeNull();
		}),
	);

	it.live("prefers the in-progress episode over the next untracked one", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* loadLifecycleSchemas(client);
			const { show, episodes } = yield* seedShow(client, schemas, {
				productionStatus: "Continuing",
				seasons: [{ seasonNumber: 1, episodeCount: 3 }],
			});
			const [first, , third] = episodes.map(({ entity }) => entity);
			assertPresent(first, "Expected E1");
			assertPresent(third, "Expected E3");

			yield* createComplete(
				client,
				first.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-11T01:00:00.000Z",
			);
			yield* createProgress(
				client,
				third.id,
				schemas.showEpisodeEvents.progress,
				"2026-05-11T02:00:00.000Z",
			);
			const summary = yield* readShowSummary(client, show.id);
			expect(summary.nextUp).toMatchObject({ id: third.id, state: "in_progress" });
			expect(summary.inProgressEpisodes).toBe(1);
		}),
	);

	it.live("keeps lifetime progress after completion and resets it for a rewatch", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* loadLifecycleSchemas(client);
			const { show, seasons, episodes } = yield* seedShow(client, schemas, {
				productionStatus: "Continuing",
				seasons: [{ seasonNumber: 1, episodeCount: 2 }],
			});
			const [first, second] = episodes.map(({ entity }) => entity);
			const season = seasons[0];
			assertPresent(first, "Expected E1");
			assertPresent(second, "Expected E2");
			assertPresent(season, "Expected the season");

			yield* createComplete(
				client,
				first.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-12T01:00:00.000Z",
			);
			yield* createComplete(
				client,
				second.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-12T02:00:00.000Z",
			);
			yield* createComplete(
				client,
				show.id,
				schemas.showEvents.complete,
				"2026-05-12T03:00:00.000Z",
			);
			yield* assertShowState(client, show.id, "complete");
			expect(yield* readSeasonStates(client, season.id)).toEqual(["complete", "complete"]);
			expect(yield* readShowSummary(client, show.id)).toMatchObject({
				nextUp: null,
				watchedEpisodes: 2,
			});

			yield* createProgress(
				client,
				first.id,
				schemas.showEpisodeEvents.progress,
				"2026-05-12T04:00:00.000Z",
			);
			expect(yield* readSeasonStates(client, season.id)).toEqual(["in_progress", "untracked"]);
			const rewatching = yield* readShowSummary(client, show.id);
			expect(rewatching).toMatchObject({ watchedEpisodes: 0, inProgressEpisodes: 1 });
			expect(rewatching.nextUp?.id).toBe(first.id);

			yield* createComplete(
				client,
				first.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-12T05:00:00.000Z",
			);
			expect((yield* readShowSummary(client, show.id)).nextUp?.id).toBe(second.id);
		}),
	);

	it.live("offers a podcast's newest untracked episode", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* loadLifecycleSchemas(client);
			const { podcast, episodes } = yield* seedPodcast(client, schemas, {
				episodeCount: 3,
				productionStatus: "Continuing",
				publishDates: [AIRED, AIRED, UNAIRED],
			});
			const [first, second] = episodes;
			assertPresent(first, "Expected episode 1");
			assertPresent(second, "Expected episode 2");

			expect((yield* readPodcastSummary(client, podcast.id)).nextUp?.id).toBe(second.id);
			yield* createComplete(
				client,
				second.id,
				schemas.podcastEpisodeEvents.complete,
				"2026-05-13T01:00:00.000Z",
			);
			const summary = yield* readPodcastSummary(client, podcast.id);
			expect(summary.nextUp?.id).toBe(first.id);
			expect(summary).toMatchObject({ airedEpisodes: 2, watchedEpisodes: 1, upcomingEpisodes: 1 });
		}),
	);
});

const loadMovieLifecycleSchemas = (client: Client) =>
	Effect.gen(function* () {
		const movieSchemaId = yield* getBuiltinEntitySchemaSlug(client, "movie");
		const movieEvents = yield* listEventSchemas(client, movieSchemaId);
		return {
			movieSchemaId,
			movieEvents: {
				onHold: requireEventSchemaBySlug(movieEvents, "on_hold").id,
				backlog: requireEventSchemaBySlug(movieEvents, "backlog").id,
				dropped: requireEventSchemaBySlug(movieEvents, "dropped").id,
				progress: requireEventSchemaBySlug(movieEvents, "progress").id,
				complete: requireEventSchemaBySlug(movieEvents, "complete").id,
			},
		};
	});

const seedMovie = (movieSchemaId: string) => {
	const suffix = crypto.randomUUID();
	return seedMediaEntity({
		userId: null,
		providerId: null,
		properties: { runtime: 139 },
		entitySchemaSlug: movieSchemaId,
		name: `Lifecycle Movie ${suffix}`,
		externalId: `lifecycle-movie-${suffix}`,
	});
};

const readMovieSummary = (client: Client, entityId: string) =>
	Effect.gen(function* () {
		const result = yield* executeRyotQLRecipe(
			client,
			movieRecipes.summaryRecipe({ entityId, collectionLimit: 1 }),
		);
		assertPresent(result.summary, "Expected a movie summary row");
		return result.summary;
	});

describe("Media flat lifecycle query recipes", () => {
	it.live("derives movie state from its own latest signal, with no caught up state", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* loadMovieLifecycleSchemas(client);
			const movie = yield* seedMovie(schemas.movieSchemaId);

			expect((yield* readMovieSummary(client, movie.id)).state).toBe("untracked");

			yield* createEventFixture(client, {
				properties: {},
				entityId: movie.id,
				occurredAt: "2026-06-01T01:00:00.000Z",
				eventSchemaSlug: schemas.movieEvents.backlog,
			});
			expect((yield* readMovieSummary(client, movie.id)).state).toBe("backlog");

			yield* createProgress(
				client,
				movie.id,
				schemas.movieEvents.progress,
				"2026-06-01T02:00:00.000Z",
			);
			const inProgress = yield* readMovieSummary(client, movie.id);
			expect(inProgress.state).toBe("in_progress");
			expect(inProgress.progressPercent).toBe(50);

			yield* createEventFixture(client, {
				entityId: movie.id,
				properties: { progressPercent: 50 },
				occurredAt: "2026-06-01T03:00:00.000Z",
				eventSchemaSlug: schemas.movieEvents.onHold,
			});
			expect((yield* readMovieSummary(client, movie.id)).state).toBe("on_hold");

			yield* createEventFixture(client, {
				entityId: movie.id,
				properties: { progressPercent: 50 },
				occurredAt: "2026-06-01T04:00:00.000Z",
				eventSchemaSlug: schemas.movieEvents.dropped,
			});
			expect((yield* readMovieSummary(client, movie.id)).state).toBe("dropped");

			yield* createComplete(
				client,
				movie.id,
				schemas.movieEvents.complete,
				"2026-06-01T05:00:00.000Z",
			);
			expect((yield* readMovieSummary(client, movie.id)).state).toBe("complete");
		}),
	);

	it.live("reports a rewatch percent but drops the one that preceded the completion", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* loadMovieLifecycleSchemas(client);
			const movie = yield* seedMovie(schemas.movieSchemaId);

			yield* createProgress(
				client,
				movie.id,
				schemas.movieEvents.progress,
				"2026-06-02T01:00:00.000Z",
			);
			yield* createComplete(
				client,
				movie.id,
				schemas.movieEvents.complete,
				"2026-06-02T02:00:00.000Z",
			);

			const completed = yield* readMovieSummary(client, movie.id);
			expect(completed.state).toBe("complete");
			expect(completed.progressPercent).toBeNull();

			yield* createEventFixture(client, {
				entityId: movie.id,
				properties: { progressPercent: 20 },
				occurredAt: "2026-06-02T03:00:00.000Z",
				eventSchemaSlug: schemas.movieEvents.progress,
			});

			const rewatching = yield* readMovieSummary(client, movie.id);
			expect(rewatching.state).toBe("in_progress");
			expect(rewatching.progressPercent).toBe(20);
		}),
	);
});
