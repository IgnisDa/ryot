import { EntityId } from "@ryot-app/contract/schema/brands";
import { mediaPlugin } from "@ryot-app/media-plugin";
import { animeRecipes } from "@ryot-app/media-plugin/shared/anime-recipes";
import {
	type EpisodicKindConfig,
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
} from "@ryot-app/media-plugin/shared/lifecycle-expressions";
import {
	episodicByLifecycleStateRecipe,
	flatByLifecycleStateRecipe,
} from "@ryot-app/media-plugin/shared/lifecycle-list-recipes";
import { movieRecipes } from "@ryot-app/media-plugin/shared/movie-recipes";
import {
	podcastEpisodesRecipe,
	podcastRecipes,
} from "@ryot-app/media-plugin/shared/podcast-recipes";
import { showRecipes, showSeasonEpisodesRecipe } from "@ryot-app/media-plugin/shared/show-recipes";
import { column, descending, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { Effect } from "effect";

import {
	type Client,
	createAuthenticatedClient,
	createEventFixture,
	executeRyotQL,
	executeRyotQLRecipe,
	fakeProviderDetailsResult,
	getEntity,
	getGlobalEntityByProvenance,
	listAdminGlobalRelationships,
	listEventSchemas,
	listEventsForEntity,
	listRelationshipSchemas,
	pollUntil,
	requireEventSchemaBySlug,
	requireRelationshipSchemaBySlug,
	requireRows,
	requireRyotQLDate,
	requireRyotQLText,
	shippedPluginTestProviders,
} from "~/fixtures/kernel";
import {
	enableMediaMonitoring,
	findMediaEntitySchema,
	insertLibraryMembership,
	seedMediaEntity,
	seedPodcast,
	seedShow,
	seedShowEpisode,
	triggerCronAndWaitForEntity,
} from "~/fixtures/plugins/media";
import { assertPresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";
import { startIsolatedHarness } from "~/support/isolated-harness";

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
type MediaReference = Parameters<typeof showRecipes.summaryRecipe>[0]["reference"];

const localReferenceForEntity = (client: Client, entityId: string) =>
	Effect.gen(function* () {
		const entity = yield* getEntity(client, entityId);
		assertPresent(entity.entitySchemaPluginId, "Expected a plugin-owned media entity");
		const reference: MediaReference = { kind: "local", pluginId: entity.entitySchemaPluginId };
		return reference;
	});

const loadLifecycleSchemas = (client: Client) =>
	Effect.gen(function* () {
		const [show, podcast, showSeason, showEpisode, podcastEpisode] = yield* Effect.all([
			findMediaEntitySchema(client, "show"),
			findMediaEntitySchema(client, "podcast"),
			findMediaEntitySchema(client, "show-season"),
			findMediaEntitySchema(client, "show-episode"),
			findMediaEntitySchema(client, "podcast-episode"),
		]);
		const relationshipSchemas = yield* listRelationshipSchemas(client, {
			owner: show.schema.reference.owner,
			slugs: ["show-to-show-season", "show-season-to-show-episode", "podcast-to-podcast-episode"],
		});
		const [showEvents, showEpisodeEvents, podcastEvents, podcastEpisodeEvents] = yield* Effect.all([
			listEventSchemas(client, show.schema.reference),
			listEventSchemas(client, showEpisode.schema.reference),
			listEventSchemas(client, podcast.schema.reference),
			listEventSchemas(client, podcastEpisode.schema.reference),
		]);
		const reference: MediaReference = { kind: "local", pluginId: show.pluginId };
		return {
			reference,
			showSchemaId: show.schema.id,
			podcastSchemaId: podcast.schema.id,
			showSeasonSchemaId: showSeason.schema.id,
			showEpisodeSchemaId: showEpisode.schema.id,
			podcastEpisodeSchemaId: podcastEpisode.schema.id,
			showToSeasonRelationship: requireRelationshipSchemaBySlug(
				relationshipSchemas,
				"show-to-show-season",
				show.schema.reference.owner,
			).reference,
			seasonToEpisodeRelationship: requireRelationshipSchemaBySlug(
				relationshipSchemas,
				"show-season-to-show-episode",
				show.schema.reference.owner,
			).reference,
			podcastToEpisodeRelationship: requireRelationshipSchemaBySlug(
				relationshipSchemas,
				"podcast-to-podcast-episode",
				podcast.schema.reference.owner,
			).reference,
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

const AIRED = "2020-01-01";
const UNAIRED = "2999-01-01";

type PublishDates = ReadonlyArray<null | string>;

const episodesOf = (count: number, publishDates?: PublishDates) =>
	Array.from({ length: count }, (_, index) => ({
		episodeNumber: index + 1,
		publishDate: publishDates?.[index] ?? AIRED,
	}));

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
		const reference = yield* localReferenceForEntity(client, entityId);
		const result = yield* executeRyotQLRecipe(
			client,
			showRecipes.summaryRecipe({ entityId, reference, collectionLimit: 1 }),
		);
		assertPresent(result.summary, "Expected a show summary row");
		return result.summary;
	});

const readPodcastSummary = (client: Client, entityId: string) =>
	Effect.gen(function* () {
		const reference = yield* localReferenceForEntity(client, entityId);
		const result = yield* executeRyotQLRecipe(
			client,
			podcastRecipes.summaryRecipe({ entityId, reference, collectionLimit: 1 }),
		);
		assertPresent(result.summary, "Expected a podcast summary row");
		return result.summary;
	});

const readSeasonStates = (client: Client, seasonId: string) =>
	Effect.gen(function* () {
		const reference = yield* localReferenceForEntity(client, seasonId);
		const page = yield* executeRyotQLRecipe(
			client,
			showSeasonEpisodesRecipe({ reference, limit: 10, containerId: seasonId }),
		);
		return page.items.map((episode) => episode.state);
	});

const assertEpisodicState = (
	client: Client,
	config: EpisodicKindConfig,
	entityId: string,
	expected: LifecycleState,
) =>
	Effect.gen(function* () {
		const reference = yield* localReferenceForEntity(client, entityId);
		const results = yield* Effect.all(
			lifecycleStates.map((state) =>
				executeRyotQLRecipe(
					client,
					episodicByLifecycleStateRecipe({
						config,
						entityId,
						limit: 1,
						reference,
						states: [state],
					}),
				),
			),
		);
		const memberships = results.flatMap((result, index) =>
			result.items.some((item) => item.id === entityId && item.state === expected)
				? [lifecycleStates[index]]
				: [],
		);
		expect(memberships).toEqual([expected]);
	});

const assertShowState = (client: Client, entityId: string, expected: LifecycleState) =>
	assertEpisodicState(client, showEpisodicKindConfig, entityId, expected);

const assertPodcastState = (client: Client, entityId: string, expected: LifecycleState) =>
	assertEpisodicState(client, podcastEpisodicKindConfig, entityId, expected);

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
		properties: { dateUnknown: true },
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

let harness: undefined | Effect.Success<ReturnType<typeof startIsolatedHarness>>;
let target: Effect.Success<ReturnType<typeof startIsolatedHarness>>["target"];
let media: Effect.Success<ReturnType<typeof shippedPluginTestProviders>>;

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			harness = yield* startIsolatedHarness("Media Lifecycle Query Recipes");
			target = harness.target;
			media = yield* shippedPluginTestProviders(mediaPlugin.metadata.packageId, target);
		}),
	),
);

afterAll(() => runPromise(harness?.stop ?? Effect.void));

describe("Media episodic lifecycle query recipes", () => {
	it.live(
		"covers show transitions through interruptions, manual completion, resume, and caught up",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient(target);
				const schemas = yield* loadLifecycleSchemas(client);
				const { show, episodes } = yield* seedShow(client, {
					properties: { productionStatus: "Continuing" },
					seasons: [{ seasonNumber: 1, episodes: episodesOf(2) }],
				});
				const firstEpisode = episodes[0];
				const secondEpisode = episodes[1];
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
			const { client } = yield* createAuthenticatedClient(target);
			const schemas = yield* loadLifecycleSchemas(client);
			const cycles = yield* seedShow(client, {
				properties: { productionStatus: "Ended" },
				seasons: [{ seasonNumber: 1, episodes: episodesOf(2) }],
			});
			const firstEpisode = cycles.episodes[0];
			const secondEpisode = cycles.episodes[1];
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

			const detailFixture = yield* seedShow(client, {
				properties: { productionStatus: "Continuing" },
				seasons: [{ seasonNumber: 1, episodes: episodesOf(1) }],
			});
			const detailEpisode = detailFixture.episodes[0];
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
				showSeasonEpisodesRecipe({
					limit: 10,
					containerId: season.id,
					reference: schemas.reference,
				}),
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
			const { client } = yield* createAuthenticatedClient(target);
			const schemas = yield* loadLifecycleSchemas(client);
			const fixture = yield* seedShow(client, {
				seasons: [{ seasonNumber: 1, episodes: episodesOf(1) }],
			});
			const episode = fixture.episodes[0];
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
			const { client } = yield* createAuthenticatedClient(target);
			const schemas = yield* loadLifecycleSchemas(client);
			const noSeasons = yield* seedShow(client, { seasons: [] });
			const specialsOnly = yield* seedShow(client, {
				properties: { totalSeasons: 1 },
				seasons: [{ seasonNumber: 0, episodes: episodesOf(1) }],
			});
			const emptyRegularSeason = yield* seedShow(client, {
				seasons: [{ seasonNumber: 1, episodes: episodesOf(0) }],
			});
			const mixedRegularSeasons = yield* seedShow(client, {
				seasons: [
					{ seasonNumber: 1, episodes: episodesOf(1) },
					{ seasonNumber: 2, episodes: episodesOf(0) },
				],
			});
			const special = specialsOnly.episodes[0];
			const regularEpisode = mixedRegularSeasons.episodes[0];
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
				showSeasonEpisodesRecipe({
					limit: 10,
					reference: schemas.reference,
					containerId: specialSeason.id,
				}),
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
			const { client } = yield* createAuthenticatedClient(target);
			const schemas = yield* loadLifecycleSchemas(client);
			const { podcast, episodes } = yield* seedPodcast(client, {
				episodes: episodesOf(2),
				properties: { productionStatus: "Continuing" },
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

			const summary = yield* readPodcastSummary(client, podcast.id);
			expect(summary.state).toBe("caught_up");
			const detail = yield* executeRyotQLRecipe(
				client,
				podcastEpisodesRecipe({ limit: 10, containerId: podcast.id, reference: schemas.reference }),
			);
			expect(detail.items.map((episode) => episode.state)).toEqual(["complete", "complete"]);
		}),
	);

	it.live("automatically completes both terminal podcast consumption cycles", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(target);
			const schemas = yield* loadLifecycleSchemas(client);
			const { podcast, episodes } = yield* seedPodcast(client, {
				episodes: episodesOf(1),
				properties: { productionStatus: "Ended" },
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
				const auth = yield* createAuthenticatedClient(target);
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
				const provider = yield* media.attachProvider({
					name: providerName,
					slug: providerSlug,
					rootEntitySchemaSlug: schemas.showSchemaId,
					details: details([firstEpisodeExternalId, secondEpisodeExternalId]),
				});
				const show = yield* seedMediaEntity({
					target,
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

				yield* media.update(provider.providerSlug, { details: details([firstEpisodeExternalId]) });
				yield* triggerCronAndWaitForEntity(auth, show.id);
				const relationships = yield* listAdminGlobalRelationships(
					{
						type: "anchored",
						direction: "outgoing",
						anchorEntityId: EntityId.make(season.id),
						relationshipSchemaSlug: schemas.seasonToEpisodeRelationship.slug,
					},
					target,
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

describe("Media episodic coverage over aired episodes", () => {
	it.live("reads caught up while the remaining episodes are unaired and counts them upcoming", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(target);
			const schemas = yield* loadLifecycleSchemas(client);
			const { show, episodes } = yield* seedShow(client, {
				properties: { totalSeasons: 3, productionStatus: "Continuing" },
				seasons: [
					{ seasonNumber: 0, episodes: episodesOf(1) },
					{ seasonNumber: 1, episodes: episodesOf(3, [AIRED, AIRED, UNAIRED]) },
					{ seasonNumber: 2, episodes: episodesOf(2, [UNAIRED, UNAIRED]) },
				],
			});
			const aired = episodes.filter(({ seasonNumber }) => seasonNumber === 1).slice(0, 2);

			for (const [index, episode] of aired.entries()) {
				yield* createComplete(
					client,
					episode.id,
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
			const { client } = yield* createAuthenticatedClient(target);
			const schemas = yield* loadLifecycleSchemas(client);
			const fixture = yield* seedShow(client, {
				properties: { productionStatus: "Continuing" },
				seasons: [{ seasonNumber: 1, episodes: episodesOf(1) }],
			});
			const episode = fixture.episodes[0];
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

			const added = yield* seedShowEpisode(client, {
				seasonNumber: 1,
				seasonId: season.id,
				suffix: fixture.suffix,
				episode: { episodeNumber: 2, publishDate: AIRED },
			});
			yield* assertShowState(client, fixture.show.id, "in_progress");
			const summary = yield* readShowSummary(client, fixture.show.id);
			expect(summary.nextUp?.id).toBe(added.id);
		}),
	);

	it.live("counts null and malformed publish dates as aired", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(target);
			const schemas = yield* loadLifecycleSchemas(client);
			const { show, episodes } = yield* seedShow(client, {
				properties: { productionStatus: "Continuing" },
				seasons: [{ seasonNumber: 1, episodes: episodesOf(3, [AIRED, null, "not-a-date"]) }],
			});
			const [first, second, third] = episodes;
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
			const { client } = yield* createAuthenticatedClient(target);
			const schemas = yield* loadLifecycleSchemas(client);
			const { show, episodes } = yield* seedShow(client, {
				properties: { productionStatus: "Continuing" },
				seasons: [
					{ seasonNumber: 1, episodes: episodesOf(2) },
					{ seasonNumber: 2, episodes: episodesOf(1) },
				],
			});
			const [first, second, third] = episodes;
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

			const gapped = yield* seedShow(client, {
				properties: { productionStatus: "Continuing" },
				seasons: [{ seasonNumber: 1, episodes: episodesOf(2) }],
			});
			const gappedLast = gapped.episodes[1];
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
			const { client } = yield* createAuthenticatedClient(target);
			const schemas = yield* loadLifecycleSchemas(client);
			const { show, episodes } = yield* seedShow(client, {
				properties: { productionStatus: "Continuing" },
				seasons: [{ seasonNumber: 1, episodes: episodesOf(3) }],
			});
			const [first, , third] = episodes;
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
			const { client } = yield* createAuthenticatedClient(target);
			const schemas = yield* loadLifecycleSchemas(client);
			const { show, seasons, episodes } = yield* seedShow(client, {
				properties: { productionStatus: "Continuing" },
				seasons: [{ seasonNumber: 1, episodes: episodesOf(2) }],
			});
			const [first, second] = episodes;
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

	it.live("keeps a watched special's lifetime state through a rewatch", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(target);
			const schemas = yield* loadLifecycleSchemas(client);
			const { show, seasons, episodes } = yield* seedShow(client, {
				properties: { totalSeasons: 2, productionStatus: "Continuing" },
				seasons: [
					{ seasonNumber: 0, episodes: episodesOf(1) },
					{ seasonNumber: 1, episodes: episodesOf(1) },
				],
			});
			const [special, regular] = episodes;
			const specialSeason = seasons[0];
			assertPresent(special, "Expected the special");
			assertPresent(regular, "Expected E1");
			assertPresent(specialSeason, "Expected the specials season");

			yield* createComplete(
				client,
				special.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-13T01:00:00.000Z",
			);
			yield* createComplete(
				client,
				regular.id,
				schemas.showEpisodeEvents.complete,
				"2026-05-13T02:00:00.000Z",
			);
			yield* createComplete(
				client,
				show.id,
				schemas.showEvents.complete,
				"2026-05-13T03:00:00.000Z",
			);
			yield* createProgress(
				client,
				regular.id,
				schemas.showEpisodeEvents.progress,
				"2026-05-13T04:00:00.000Z",
			);

			expect(yield* readSeasonStates(client, specialSeason.id)).toEqual(["complete"]);
		}),
	);

	it.live("offers a podcast's newest untracked episode", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(target);
			const schemas = yield* loadLifecycleSchemas(client);
			const { podcast, episodes } = yield* seedPodcast(client, {
				properties: { productionStatus: "Continuing" },
				episodes: episodesOf(3, [AIRED, AIRED, UNAIRED]),
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
		const { schema, pluginId } = yield* findMediaEntitySchema(client, "movie");
		const movieEvents = yield* listEventSchemas(client, schema.reference);
		return {
			movieSchemaId: schema.id,
			reference: { pluginId, kind: "local" } satisfies MediaReference,
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
		target,
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
		const reference = yield* localReferenceForEntity(client, entityId);
		const result = yield* executeRyotQLRecipe(
			client,
			movieRecipes.summaryRecipe({ entityId, reference, collectionLimit: 1 }),
		);
		assertPresent(result.summary, "Expected a movie summary row");
		return result.summary;
	});

describe("Media flat lifecycle query recipes", () => {
	it.live("derives movie state from its own latest signal, with no caught up state", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(target);
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
			const { client } = yield* createAuthenticatedClient(target);
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

describe("Media lifecycle list recipes", () => {
	it.live("lists episodic parents with their latest activity and next up", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(target);
			const schemas = yield* loadLifecycleSchemas(client);
			const { show, episodes } = yield* seedShow(client, {
				properties: { productionStatus: "Continuing" },
				seasons: [{ seasonNumber: 1, episodes: episodesOf(2) }],
			});
			const [first, second] = episodes;
			assertPresent(first, "Expected E1");
			assertPresent(second, "Expected E2");
			const { podcast, episodes: podcastEpisodes } = yield* seedPodcast(client, {
				episodes: episodesOf(2),
				properties: { productionStatus: "Continuing" },
			});
			const [, newest] = podcastEpisodes;
			assertPresent(newest, "Expected the newest podcast episode");

			yield* createComplete(
				client,
				first.id,
				schemas.showEpisodeEvents.complete,
				"2026-06-03T01:00:00.000Z",
			);
			yield* createProgress(
				client,
				newest.id,
				schemas.podcastEpisodeEvents.progress,
				"2026-06-03T02:00:00.000Z",
			);

			const shows = yield* executeRyotQLRecipe(
				client,
				episodicByLifecycleStateRecipe({
					limit: 20,
					states: ["in_progress"],
					reference: schemas.reference,
					config: showEpisodicKindConfig,
				}),
			);
			expect(shows.items).toEqual([
				expect.objectContaining({
					id: show.id,
					state: "in_progress",
					latestActivityAt: "2026-06-03T01:00:00.000Z",
					nextUp: expect.objectContaining({ id: second.id, seasonNumber: 1 }),
				}),
			]);

			const podcasts = yield* executeRyotQLRecipe(
				client,
				episodicByLifecycleStateRecipe({
					limit: 20,
					states: ["in_progress"],
					reference: schemas.reference,
					config: podcastEpisodicKindConfig,
				}),
			);
			expect(podcasts.items).toEqual([
				expect.objectContaining({
					id: podcast.id,
					latestActivityAt: "2026-06-03T02:00:00.000Z",
					nextUp: expect.objectContaining({ id: newest.id, seasonNumber: null }),
				}),
			]);

			yield* createEventFixture(client, {
				properties: {},
				entityId: show.id,
				occurredAt: "2026-06-03T03:00:00.000Z",
				eventSchemaSlug: schemas.showEvents.backlog,
			});
			const backlog = yield* executeRyotQLRecipe(
				client,
				episodicByLifecycleStateRecipe({
					limit: 20,
					states: ["backlog"],
					reference: schemas.reference,
					config: showEpisodicKindConfig,
				}),
			);
			expect(backlog.items.map((item) => [item.id, item.latestActivityAt])).toEqual([
				[show.id, "2026-06-03T03:00:00.000Z"],
			]);
		}),
	);

	it.live(
		"derives anime in-progress percent from the cumulative position over total episodes",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient(target);
				const { pluginId, schema: animeSchema } = yield* findMediaEntitySchema(client, "anime");
				const animeEvents = yield* listEventSchemas(client, animeSchema.reference);
				const suffix = crypto.randomUUID();
				const anime = yield* seedMediaEntity({
					target,
					userId: null,
					providerId: null,
					properties: { episodes: 28 },
					entitySchemaSlug: animeSchema.id,
					name: `Position Percent Anime ${suffix}`,
					externalId: `position-percent-anime-${suffix}`,
				});
				yield* insertLibraryMembership(client, { mediaEntityId: anime.id });
				yield* createEventFixture(client, {
					entityId: anime.id,
					properties: { animeEpisode: 12 },
					occurredAt: "2026-06-05T01:00:00.000Z",
					eventSchemaSlug: requireEventSchemaBySlug(animeEvents, "progress").id,
				});

				const reference: MediaReference = { pluginId, kind: "local" };
				const result = yield* executeRyotQLRecipe(
					client,
					animeRecipes.summaryRecipe({ reference, entityId: anime.id, collectionLimit: 1 }),
				);
				assertPresent(result.summary, "Expected an anime summary row");
				expect(result.summary).toMatchObject({ state: "in_progress" });
				expect(result.summary.progressPercent).toBeCloseTo(42.86, 2);

				const inProgress = yield* executeRyotQLRecipe(
					client,
					flatByLifecycleStateRecipe({ limit: 20, reference, states: ["in_progress"] }),
				);
				const listed = inProgress.items.find((item) => item.id === anime.id);
				assertPresent(listed, "Expected the anime in the in-progress list");
				expect(listed.progressPercent).toBeCloseTo(42.86, 2);
				expect(listed.progressPercent).not.toBe(100);
			}),
	);

	it.live("lists flat media across schemas with their recorded position", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(target);
			const schemas = yield* loadMovieLifecycleSchemas(client);
			const { schema: animeSchema } = yield* findMediaEntitySchema(client, "anime");
			const animeEvents = yield* listEventSchemas(client, animeSchema.reference);
			const movie = yield* seedMovie(schemas.movieSchemaId);
			const suffix = crypto.randomUUID();
			const anime = yield* seedMediaEntity({
				target,
				userId: null,
				providerId: null,
				properties: { episodes: 10 },
				entitySchemaSlug: animeSchema.id,
				name: `Lifecycle Anime ${suffix}`,
				externalId: `lifecycle-anime-${suffix}`,
			});
			const backlogged = yield* seedMovie(schemas.movieSchemaId);
			yield* Effect.all([
				insertLibraryMembership(client, { mediaEntityId: movie.id }),
				insertLibraryMembership(client, { mediaEntityId: anime.id }),
				insertLibraryMembership(client, { mediaEntityId: backlogged.id }),
			]);

			yield* createProgress(
				client,
				movie.id,
				schemas.movieEvents.progress,
				"2026-06-04T01:00:00.000Z",
			);
			yield* createEventFixture(client, {
				entityId: anime.id,
				properties: { animeEpisode: 4 },
				occurredAt: "2026-06-04T02:00:00.000Z",
				eventSchemaSlug: requireEventSchemaBySlug(animeEvents, "progress").id,
			});
			yield* createEventFixture(client, {
				properties: {},
				entityId: backlogged.id,
				occurredAt: "2026-06-04T03:00:00.000Z",
				eventSchemaSlug: schemas.movieEvents.backlog,
			});

			const inProgress = yield* executeRyotQLRecipe(
				client,
				flatByLifecycleStateRecipe({
					limit: 20,
					states: ["in_progress"],
					reference: schemas.reference,
				}),
			);
			expect(
				inProgress.items.map((item) => [
					item.id,
					item.progressPercent,
					item.animeEpisode,
					item.latestActivityAt,
				]),
			).toEqual([
				[anime.id, 40, 4, "2026-06-04T02:00:00.000Z"],
				[movie.id, 50, null, "2026-06-04T01:00:00.000Z"],
			]);

			const backlog = yield* executeRyotQLRecipe(
				client,
				flatByLifecycleStateRecipe({
					limit: 20,
					states: ["backlog"],
					reference: schemas.reference,
				}),
			);
			expect(backlog.items.map((item) => [item.id, item.state])).toEqual([
				[backlogged.id, "backlog"],
			]);
		}),
	);
});
