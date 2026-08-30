import { EntityId, RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	podcastDetailRecipe,
	podcastsByLifecycleStateRecipe,
	showsByLifecycleStateRecipe,
} from "@ryot-app/media-plugin/query-recipes";
import { showSeasonEpisodesRecipe } from "@ryot-app/media-plugin/shared/show-recipes";
import { column, descending, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { Effect } from "effect";

import {
	adminHeaders,
	createAuthenticatedClient,
	createEventFixture,
	executeRyotQL,
	executeRyotQLRecipe,
	fakeProviderDetailsResult,
	getApiClient,
	getBuiltinEntitySchemaSlug,
	insertGlobalRelationship,
	installTestProvider,
	listEventSchemas,
	listEventsForEntity,
	listRelationshipSchemas,
	providerSandboxSource,
	replaceSandboxScriptCompiledRepresentation,
	requireEventSchemaBySlug,
	requireRelationshipSchemaBySlug,
	requireRows,
	requireRyotQLDate,
	requireRyotQLText,
	type Client,
	waitForEventCount,
} from "~/fixtures/kernel";
import {
	enableMediaMonitoring,
	getGlobalEntityByProvenance,
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
			showSchemaId: getBuiltinEntitySchemaSlug("show"),
			podcastSchemaId: getBuiltinEntitySchemaSlug("podcast"),
			showSeasonSchemaId: getBuiltinEntitySchemaSlug("show-season"),
			showEpisodeSchemaId: getBuiltinEntitySchemaSlug("show-episode"),
			podcastEpisodeSchemaId: getBuiltinEntitySchemaSlug("podcast-episode"),
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
			showEvents: {
				onHold: requireEventSchemaBySlug(showEvents, "on_hold").id,
				backlog: requireEventSchemaBySlug(showEvents, "backlog").id,
				dropped: requireEventSchemaBySlug(showEvents, "dropped").id,
				complete: requireEventSchemaBySlug(showEvents, "complete").id,
			},
			showEpisodeEvents: {
				complete: requireEventSchemaBySlug(showEpisodeEvents, "complete").id,
				progress: requireEventSchemaBySlug(showEpisodeEvents, "progress").id,
			},
			podcastEvents: {
				onHold: requireEventSchemaBySlug(podcastEvents, "on_hold").id,
				dropped: requireEventSchemaBySlug(podcastEvents, "dropped").id,
				backlog: requireEventSchemaBySlug(podcastEvents, "backlog").id,
				complete: requireEventSchemaBySlug(podcastEvents, "complete").id,
			},
			podcastEpisodeEvents: {
				complete: requireEventSchemaBySlug(podcastEpisodeEvents, "complete").id,
				progress: requireEventSchemaBySlug(podcastEpisodeEvents, "progress").id,
			},
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
		};
	});

type LifecycleSchemas = Effect.Success<ReturnType<typeof loadLifecycleSchemas>>;

const seedShow = (
	schemas: LifecycleSchemas,
	input: {
		readonly productionStatus?: string | null;
		readonly seasons: ReadonlyArray<{
			readonly episodeCount: number;
			readonly seasonNumber: number;
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
				const entity = yield* seedMediaEntity({
					userId: null,
					providerId: null,
					entitySchemaSlug: schemas.showEpisodeSchemaId,
					name: `S${seasonInput.seasonNumber}E${episodeNumber} ${suffix}`,
					properties: { episodeNumber, seasonNumber: seasonInput.seasonNumber },
					externalId: `lifecycle-episode-${seasonInput.seasonNumber}-${episodeNumber}-${suffix}`,
				});
				episodes.push({ entity, seasonNumber: seasonInput.seasonNumber });
				yield* insertGlobalRelationship({
					sourceEntityId: season.id,
					targetEntityId: entity.id,
					relationshipSchemaSlug: schemas.seasonToEpisodeRelationship,
				});
			}
		}
		return { episodes, seasons, show };
	});

const seedPodcast = (
	schemas: LifecycleSchemas,
	input: { readonly episodeCount: number; readonly productionStatus?: string | null },
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
		const episodes: SeededMediaEntity[] = [];
		for (let episodeNumber = 1; episodeNumber <= input.episodeCount; episodeNumber += 1) {
			const episode = yield* seedMediaEntity({
				userId: null,
				providerId: null,
				properties: { episodeNumber },
				entitySchemaSlug: schemas.podcastEpisodeSchemaId,
				name: `Podcast Episode ${episodeNumber} ${suffix}`,
				externalId: `lifecycle-podcast-episode-${episodeNumber}-${suffix}`,
			});
			episodes.push(episode);
			yield* insertGlobalRelationship({
				sourceEntityId: podcast.id,
				targetEntityId: episode.id,
				relationshipSchemaSlug: schemas.podcastToEpisodeRelationship,
			});
		}
		return { episodes, podcast };
	});

const assertShowState = (client: Client, entityId: string, expected: LifecycleState) =>
	Effect.gen(function* () {
		const results = yield* Effect.all(
			lifecycleStates.map((state) =>
				executeRyotQLRecipe(client, showsByLifecycleStateRecipe({ entityId, limit: 1, state })),
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
				executeRyotQLRecipe(client, podcastsByLifecycleStateRecipe({ entityId, limit: 1, state })),
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
				const { episodes, show } = yield* seedShow(schemas, {
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
			const cycles = yield* seedShow(schemas, {
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
			yield* waitForEventCount(client, cycles.show.id, 1);
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
			const parentEvents = yield* waitForEventCount(client, cycles.show.id, 2);
			expect(parentEvents.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(2);
			yield* assertShowState(client, cycles.show.id, "complete");

			const detailFixture = yield* seedShow(schemas, {
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
				showSeasonEpisodesRecipe({ seasonId: season.id, episodeLimit: 10 }),
			);
			assertPresent(detail, "Expected season episodes");
			const episode = detail.episodes.items[0];
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
			const fixture = yield* seedShow(schemas, { seasons: [{ seasonNumber: 1, episodeCount: 1 }] });
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
			const noSeasons = yield* seedShow(schemas, { seasons: [] });
			const specialsOnly = yield* seedShow(schemas, {
				seasons: [{ seasonNumber: 0, episodeCount: 1 }],
			});
			const emptyRegularSeason = yield* seedShow(schemas, {
				seasons: [{ seasonNumber: 1, episodeCount: 0 }],
			});
			const mixedRegularSeasons = yield* seedShow(schemas, {
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
				showSeasonEpisodesRecipe({ seasonId: specialSeason.id, episodeLimit: 10 }),
			);
			assertPresent(specialDetail, "Expected specials season episodes");
			const specialEpisode = specialDetail.episodes.items[0];
			assertPresent(specialEpisode, "Expected special episode detail");
			expect(specialEpisode.state).toBe("complete");

			yield* createComplete(
				client,
				regularEpisode.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-04T02:00:00.000Z",
			);
			yield* assertShowState(client, mixedRegularSeasons.show.id, "in_progress");
		}),
	);

	it.live("applies interruption, manual completion, caught-up, and rewatch rules to podcasts", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* loadLifecycleSchemas(client);
			const { episodes, podcast } = yield* seedPodcast(schemas, {
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
				podcastDetailRecipe({ entityId: podcast.id, episodeLimit: 10 }),
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
			const { episodes, podcast } = yield* seedPodcast(schemas, {
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
			yield* waitForEventCount(client, podcast.id, 1);
			yield* assertPodcastState(client, podcast.id, "complete");

			yield* createComplete(
				client,
				episode.id,
				schemas.podcastEpisodeEvents.complete,
				"2026-05-05T12:00:00.000Z",
			);
			const parentEvents = yield* waitForEventCount(client, podcast.id, 2);
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
						name: `Lifecycle Relationship Show ${suffix}`,
						properties: { productionStatus: "Ended" },
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
					client: auth.client,
					slug: providerSlug,
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
				const relationships = yield* getApiClient().call(
					(c) =>
						c.testSupport.listGlobalRelationships({
							payload: {
								type: "anchored",
								direction: "outgoing",
								anchorEntityId: EntityId.make(season.id),
								relationshipSchemaSlug: RelationshipSchemaSlug.make(
									schemas.seasonToEpisodeRelationship,
								),
							},
						}),
					adminHeaders(),
				);
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
