import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createBuiltinMediaLifecycleFixture,
	getBuiltinEntitySchemaSlug,
	listEventsForEntity,
	listEventSchemas,
	requireEventSchemaBySlug,
	seedMediaEntity,
	waitForEventCount,
	waitForEventWithSchema,
} from "~/fixtures";
import { describe, expect, it } from "~/support/effect-test";

const isoAt = (day: number) => `2024-01-${String(day).padStart(2, "0")}T00:00:00.000Z`;

describe("Event automations", () => {
	it.live("logging 100% progress creates a completion event via the built-in subscription", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { entityId, progressEventSchemaSlug } =
				yield* createBuiltinMediaLifecycleFixture(client);

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId,
							occurredAt: isoAt(1),
							properties: { progressPercent: 100 },
							eventSchemaSlug: progressEventSchemaSlug,
						},
					],
				}),
			);

			const completionEvent = yield* waitForEventWithSchema(client, entityId, "complete");

			expect(completionEvent.eventSchemaSlug).toBe("complete");
			expect(completionEvent.properties).toMatchObject({
				completedOn: isoAt(1),
				completionMode: "custom_timestamps",
			});
			expect(completionEvent.occurredAt).toBe(isoAt(1));
		}),
	);

	it.live("logging less than 100% progress does not create a completion event", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { entityId, progressEventSchemaSlug } =
				yield* createBuiltinMediaLifecycleFixture(client);

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId,
							properties: { progressPercent: 50 },
							eventSchemaSlug: progressEventSchemaSlug,
						},
					],
				}),
			);

			yield* waitForEventCount(client, entityId, 1);

			const events = yield* listEventsForEntity(client, entityId);
			const completeEvent = events.find((event) => event.eventSchemaSlug === "complete");

			expect(completeEvent).toBeUndefined();
		}),
	);

	it.live("logging 100% progress twice creates two completion events", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { entityId, progressEventSchemaSlug } =
				yield* createBuiltinMediaLifecycleFixture(client);

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId,
							eventSchemaSlug: progressEventSchemaSlug,
							properties: { progressPercent: 100 },
						},
					],
				}),
			);

			yield* waitForEventWithSchema(client, entityId, "complete");

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId,
							properties: { progressPercent: 100 },
							eventSchemaSlug: progressEventSchemaSlug,
						},
					],
				}),
			);

			yield* waitForEventCount(client, entityId, 4);

			const allEvents = yield* listEventsForEntity(client, entityId);
			const completeEvents = allEvents.filter((event) => event.eventSchemaSlug === "complete");

			expect(completeEvents.length).toBe(2);
		}),
	);

	it.live("logging all anime episodes creates a completion event", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { entityId, progressEventSchemaSlug } = yield* createBuiltinMediaLifecycleFixture(
				client,
				{
					entitySchemaSlug: "anime",
					properties: { images: [], episodes: 2 },
				},
			);

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId,
							occurredAt: isoAt(1),
							eventSchemaSlug: progressEventSchemaSlug,
							properties: { progressPercent: 100, animeEpisode: 1 },
						},
						{
							entityId,
							occurredAt: isoAt(2),
							eventSchemaSlug: progressEventSchemaSlug,
							properties: { progressPercent: 100, animeEpisode: 2 },
						},
					],
				}),
			);

			const completeEvent = yield* waitForEventWithSchema(client, entityId, "complete");

			expect(completeEvent.eventSchemaSlug).toBe("complete");
			expect(completeEvent.properties).toMatchObject({
				completionMode: "custom_timestamps",
				completedOn: "2024-01-02T00:00:00+00:00",
			});
			expect(completeEvent.occurredAt).toBe(isoAt(2));

			const events = yield* listEventsForEntity(client, entityId);
			expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(1);
		}),
	);

	it.live("anime with unknown episode count does not create a completion event", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { entityId, progressEventSchemaSlug } = yield* createBuiltinMediaLifecycleFixture(
				client,
				{
					entitySchemaSlug: "anime",
					properties: { images: [], episodes: null },
				},
			);

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId,
							occurredAt: isoAt(1),
							eventSchemaSlug: progressEventSchemaSlug,
							properties: { progressPercent: 100, animeEpisode: 1 },
						},
					],
				}),
			);

			yield* waitForEventCount(client, entityId, 1);

			const events = yield* listEventsForEntity(client, entityId);
			expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(0);
		}),
	);

	it.live("logging all manga chapters creates a completion event", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { entityId, progressEventSchemaSlug } = yield* createBuiltinMediaLifecycleFixture(
				client,
				{
					entitySchemaSlug: "manga",
					properties: { images: [], volumes: null, chapters: 2 },
				},
			);

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId,
							eventSchemaSlug: progressEventSchemaSlug,
							properties: { progressPercent: 100, mangaChapter: 1 },
						},
						{
							entityId,
							eventSchemaSlug: progressEventSchemaSlug,
							properties: { progressPercent: 100, mangaChapter: 2 },
						},
					],
				}),
			);

			const completeEvent = yield* waitForEventWithSchema(client, entityId, "complete");

			expect(completeEvent.eventSchemaSlug).toBe("complete");
		}),
	);

	it.live("manga with unknown chapter count does not create a completion event", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { entityId, progressEventSchemaSlug } = yield* createBuiltinMediaLifecycleFixture(
				client,
				{
					entitySchemaSlug: "manga",
					properties: { images: [], volumes: null, chapters: null },
				},
			);

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId,
							occurredAt: isoAt(1),
							eventSchemaSlug: progressEventSchemaSlug,
							properties: { progressPercent: 100, mangaChapter: 1 },
						},
					],
				}),
			);

			yield* waitForEventCount(client, entityId, 1);

			const events = yield* listEventsForEntity(client, entityId);
			expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(0);
		}),
	);

	it.live("logging 100% podcast episode progress creates a completion event", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const podcastEpisodeSchemaId = yield* getBuiltinEntitySchemaSlug("podcast-episode");
			const eventSchemas = yield* listEventSchemas(client, podcastEpisodeSchemaId);
			const progressEventSchema = requireEventSchemaBySlug(eventSchemas, "progress");
			const entity = yield* seedMediaEntity({
				userId: null,
				providerId: null,
				name: "Podcast Episode 1",
				entitySchemaSlug: podcastEpisodeSchemaId,
				externalId: `podcast-episode-${crypto.randomUUID()}`,
				properties: {
					runtime: null,
					episodeNumber: 1,
					publishDate: "2024-01-01",
					description: "First podcast episode",
				},
			});

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: entity.id,
							properties: { progressPercent: 100 },
							eventSchemaSlug: progressEventSchema.id,
						},
					],
				}),
			);

			const completeEvent = yield* waitForEventWithSchema(client, entity.id, "complete");

			expect(completeEvent.eventSchemaSlug).toBe("complete");
		}),
	);

	it.live("logging 100% show episode progress creates a completion event", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const showEpisodeSchemaId = yield* getBuiltinEntitySchemaSlug("show-episode");
			const eventSchemas = yield* listEventSchemas(client, showEpisodeSchemaId);
			const progressEventSchema = requireEventSchemaBySlug(eventSchemas, "progress");
			const entity = yield* seedMediaEntity({
				userId: null,
				providerId: null,
				name: "Show Episode 1",
				entitySchemaSlug: showEpisodeSchemaId,
				externalId: `show-episode-${crypto.randomUUID()}`,
				properties: {
					runtime: 45,
					seasonNumber: 1,
					episodeNumber: 1,
					publishDate: null,
					description: "First show episode",
				},
			});

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: entity.id,
							properties: { progressPercent: 100 },
							eventSchemaSlug: progressEventSchema.id,
						},
					],
				}),
			);

			const completeEvent = yield* waitForEventWithSchema(client, entity.id, "complete");

			expect(completeEvent.eventSchemaSlug).toBe("complete");
		}),
	);

	it.live(
		"logging 100% progress creates a timestamped completion event via the built-in subscription",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();

				const { entityId, progressEventSchemaSlug } = yield* createBuiltinMediaLifecycleFixture(
					client,
					{
						entitySchemaSlug: "movie",
						properties: { images: [] },
					},
				);

				yield* client.call((c) =>
					c.events.create({
						payload: [
							{
								entityId,
								occurredAt: isoAt(1),
								properties: { progressPercent: 100 },
								eventSchemaSlug: progressEventSchemaSlug,
							},
						],
					}),
				);

				const completeEvent = yield* waitForEventWithSchema(client, entityId, "complete");

				expect(completeEvent.eventSchemaSlug).toBe("complete");
				expect(completeEvent.properties).toMatchObject({
					completedOn: isoAt(1),
					completionMode: "custom_timestamps",
				});
				expect(completeEvent.occurredAt).toBe(isoAt(1));
			}),
	);

	it.live(
		"consumedOn from a progress event is propagated to the auto-generated complete event",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();

				const { entityId, progressEventSchemaSlug } = yield* createBuiltinMediaLifecycleFixture(
					client,
					{
						entitySchemaSlug: "movie",
						properties: { images: [] },
					},
				);

				yield* client.call((c) =>
					c.events.create({
						payload: [
							{
								entityId,
								occurredAt: isoAt(1),
								eventSchemaSlug: progressEventSchemaSlug,
								properties: { progressPercent: 100, consumedOn: "Jellyfin" },
							},
						],
					}),
				);

				const completeEvent = yield* waitForEventWithSchema(client, entityId, "complete");

				expect(completeEvent.properties).toMatchObject({
					consumedOn: "Jellyfin",
					completedOn: isoAt(1),
					completionMode: "custom_timestamps",
				});
				expect(completeEvent.occurredAt).toBe(isoAt(1));
			}),
	);

	it.live("complete event has no consumedOn when progress event omits it", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { entityId, progressEventSchemaSlug } = yield* createBuiltinMediaLifecycleFixture(
				client,
				{
					entitySchemaSlug: "movie",
					properties: { images: [] },
				},
			);

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId,
							occurredAt: isoAt(1),
							properties: { progressPercent: 100 },
							eventSchemaSlug: progressEventSchemaSlug,
						},
					],
				}),
			);

			const completeEvent = yield* waitForEventWithSchema(client, entityId, "complete");

			expect(completeEvent.properties).not.toHaveProperty("consumedOn");
			expect(completeEvent.properties).toMatchObject({
				completionMode: "custom_timestamps",
				completedOn: isoAt(1),
			});
			expect(completeEvent.occurredAt).toBe(isoAt(1));
		}),
	);

	it.live("movie completion still fires twice when 100% progress is logged twice", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { entityId, progressEventSchemaSlug } = yield* createBuiltinMediaLifecycleFixture(
				client,
				{
					entitySchemaSlug: "movie",
					properties: { images: [] },
				},
			);

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId,
							occurredAt: isoAt(1),
							properties: { progressPercent: 100 },
							eventSchemaSlug: progressEventSchemaSlug,
						},
					],
				}),
			);

			yield* waitForEventWithSchema(client, entityId, "complete");

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId,
							occurredAt: isoAt(2),
							properties: { progressPercent: 100 },
							eventSchemaSlug: progressEventSchemaSlug,
						},
					],
				}),
			);

			yield* waitForEventCount(client, entityId, 4);

			const events = yield* listEventsForEntity(client, entityId);
			expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(2);
		}),
	);
});
