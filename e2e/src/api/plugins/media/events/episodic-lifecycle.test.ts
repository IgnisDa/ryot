import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createKodiIntegration,
	getBuiltinEntitySchemaSlug,
	insertGlobalRelationship,
	listEventSchemas,
	listEventsForEntity,
	listRelationshipSchemas,
	pollImportRunUntilTerminal,
	postIntegrationWebhookAndWait,
	requireEventSchemaBySlug,
	requireRelationshipSchemaBySlug,
	uploadImportFile,
	waitForEventCount,
	waitForEventWithSchema,
} from "~/fixtures/kernel";
import { seedGlobalShowEpisodeTree, seedMediaEntity } from "~/fixtures/plugins/media";
import { describe, expect, it } from "~/support/effect-test";

describe("Episodic lifecycle sessions", () => {
	it.live("persists a show session on regular episode progress and automatic completion", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { showId, episodeId } = yield* seedGlobalShowEpisodeTree(client, {
				showName: "Regular Episode Session Show",
			});
			const showEpisodeSchemaId = yield* getBuiltinEntitySchemaSlug(client, "show-episode");
			const eventSchemas = yield* listEventSchemas(client, showEpisodeSchemaId);
			const progressEventSchema = requireEventSchemaBySlug(eventSchemas, "progress");

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: episodeId,
							properties: { progressPercent: 100 },
							occurredAt: "2026-04-01T00:00:00.000Z",
							eventSchemaSlug: progressEventSchema.id,
						},
					],
				}),
			);

			const completeEvent = yield* waitForEventWithSchema(client, episodeId, "complete");
			const events = yield* listEventsForEntity(client, episodeId, undefined, 100);
			const progressEvent = events.find((event) => event.eventSchemaSlug === "progress");

			expect(progressEvent?.sessionEntityId).toBe(showId);
			expect(completeEvent.sessionEntityId).toBe(showId);
			expect(completeEvent.occurredAt).toBe("2026-04-01T00:00:00.000Z");
		}),
	);

	it.live("clears the session for a season zero special", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const suffix = crypto.randomUUID();
			const [showSchemaId, seasonSchemaId, episodeSchemaId, relationshipSchemas] =
				yield* Effect.all([
					getBuiltinEntitySchemaSlug(client, "show"),
					getBuiltinEntitySchemaSlug(client, "show-season"),
					getBuiltinEntitySchemaSlug(client, "show-episode"),
					listRelationshipSchemas(client, {
						slugs: ["show-to-show-season", "show-season-to-show-episode"],
					}),
				]);
			const showToSeason = requireRelationshipSchemaBySlug(
				relationshipSchemas,
				"show-to-show-season",
			);
			const seasonToEpisode = requireRelationshipSchemaBySlug(
				relationshipSchemas,
				"show-season-to-show-episode",
			);
			const show = yield* seedMediaEntity({
				providerId: null,
				entitySchemaSlug: showSchemaId,
				name: `Special Session Show ${suffix}`,
				externalId: `special-session-show-${suffix}`,
				properties: { totalSeasons: 0, totalEpisodes: 0 },
			});
			const season = yield* seedMediaEntity({
				providerId: null,
				properties: { seasonNumber: 0 },
				entitySchemaSlug: seasonSchemaId,
				name: `Special Session Season ${suffix}`,
				externalId: `special-session-season-${suffix}`,
			});
			const episode = yield* seedMediaEntity({
				providerId: null,
				entitySchemaSlug: episodeSchemaId,
				name: `Special Session Episode ${suffix}`,
				externalId: `special-session-episode-${suffix}`,
				properties: { seasonNumber: 0, episodeNumber: 1 },
			});
			yield* insertGlobalRelationship({
				sourceEntityId: show.id,
				targetEntityId: season.id,
				relationshipSchemaSlug: showToSeason.id,
			});
			yield* insertGlobalRelationship({
				sourceEntityId: season.id,
				targetEntityId: episode.id,
				relationshipSchemaSlug: seasonToEpisode.id,
			});
			const eventSchemas = yield* listEventSchemas(client, episodeSchemaId);
			const progressEventSchema = requireEventSchemaBySlug(eventSchemas, "progress");

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: episode.id,
							sessionEntityId: show.id,
							properties: { progressPercent: 50 },
							occurredAt: "2026-04-02T00:00:00.000Z",
							eventSchemaSlug: progressEventSchema.id,
						},
					],
				}),
			);

			const progressEvent = yield* waitForEventWithSchema(client, episode.id, "progress");
			expect(progressEvent.sessionEntityId).toBeUndefined();
		}),
	);

	it.live("assigns show and podcast parent lifecycle events to the parent itself", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			for (const entitySchemaSlug of ["show", "podcast"] as const) {
				const schemaId = yield* getBuiltinEntitySchemaSlug(client, entitySchemaSlug);
				const eventSchemas = yield* listEventSchemas(client, schemaId);
				const entity = yield* seedMediaEntity({
					properties: {},
					providerId: null,
					entitySchemaSlug: schemaId,
					name: `Parent Session ${entitySchemaSlug}`,
					externalId: `parent-session-${entitySchemaSlug}-${crypto.randomUUID()}`,
				});
				const entityId = entity.id;
				const onHoldEventSchemaSlug = requireEventSchemaBySlug(eventSchemas, "on_hold").id;
				const backlogEventSchemaSlug = requireEventSchemaBySlug(eventSchemas, "backlog").id;
				const droppedEventSchemaSlug = requireEventSchemaBySlug(eventSchemas, "dropped").id;
				const completeEventSchemaSlug = requireEventSchemaBySlug(eventSchemas, "complete").id;

				yield* client.call((c) =>
					c.events.create({
						payload: [
							{
								entityId,
								properties: {},
								occurredAt: "2026-04-03T00:00:00.000Z",
								eventSchemaSlug: backlogEventSchemaSlug,
							},
							{
								entityId,
								properties: { progressPercent: 25 },
								occurredAt: "2026-04-04T00:00:00.000Z",
								eventSchemaSlug: onHoldEventSchemaSlug,
							},
							{
								entityId,
								properties: { progressPercent: 50 },
								occurredAt: "2026-04-05T00:00:00.000Z",
								eventSchemaSlug: droppedEventSchemaSlug,
							},
							{
								entityId,
								occurredAt: "2026-04-06T00:00:00.000Z",
								eventSchemaSlug: completeEventSchemaSlug,
								properties: { completionMode: "just_now" },
							},
						],
					}),
				);

				const events = yield* waitForEventCount(client, entityId, 5);
				expect(
					Object.fromEntries(events.map((event) => [event.eventSchemaSlug, event.sessionEntityId])),
				).toEqual({
					backlog: entityId,
					dropped: entityId,
					on_hold: entityId,
					complete: entityId,
					"add-to-media-library": undefined,
				});
			}
		}),
	);

	it.live("assigns the parent show session to integration-origin episode progress", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const integration = yield* createKodiIntegration(client);
			const { tmdbId, showId, episodeId } = yield* seedGlobalShowEpisodeTree(client, {
				showName: "Integration Episode Session Show",
			});

			const { run } = yield* postIntegrationWebhookAndWait(client, integration, {
				lot: "show",
				progress: 45,
				identifier: tmdbId,
				show_season_number: 1,
				show_episode_number: 2,
			});
			const progressEvent = yield* waitForEventWithSchema(client, episodeId, "progress");

			expect(run).toMatchObject({ status: "completed", failureReason: null });
			expect(progressEvent.sessionEntityId).toBe(showId);
		}),
	);

	it.live("assigns the parent show session to import-origin episode progress", () =>
		Effect.gen(function* () {
			const { token, client } = yield* createAuthenticatedClient();
			const { tmdbId, showId, episodeId } = yield* seedGlobalShowEpisodeTree(client, {
				showName: "Import Episode Session Show",
			});
			const uploadToken = yield* uploadImportFile(
				token,
				JSON.stringify([
					{
						rating: 0,
						activity: [],
						thoughts: "",
						pinned: false,
						status: "WATCHING",
						content: { type: "tv", tmdbId: Number(tmdbId), title: "Import Episode Session Show" },
						watchedEpisodes: [
							{
								seasonNumber: 1,
								episodeNumber: 2,
								status: "FINISHED",
								createdAt: "2026-04-07T00:00:00.000Z",
							},
						],
					},
				]),
				"watcharr-session.json",
				"application/json",
			);
			const created = yield* client.call((c) =>
				c.imports.createRun({ payload: { uploadToken, source: "watcharr" } }),
			);
			const completedRun = yield* pollImportRunUntilTerminal(client, created.id);
			const progressEvent = yield* waitForEventWithSchema(client, episodeId, "progress");

			expect(completedRun).toMatchObject({ status: "completed", failureReason: null });
			expect(progressEvent.sessionEntityId).toBe(showId);
		}),
	);
});
