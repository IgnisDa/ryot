import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createBuiltinMediaLifecycleFixture,
	getBuiltinEntitySchemaId,
	listEventsForEntity,
	listEventSchemas,
	requireEventSchemaBySlug,
	seedMediaEntity,
	waitForEventCount,
	waitForEventWithSchema,
} from "../fixtures";

const isoAt = (day: number) => `2024-01-${String(day).padStart(2, "0")}T00:00:00.000Z`;

describe("Event trigger firing", () => {
	it("logging 100% progress creates a completion event via builtin trigger", async () => {
		const { client } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(client);

		await client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						occurredAt: isoAt(1),
						properties: { progressPercent: 100 },
						eventSchemaId: progressEventSchemaId,
					},
				],
			}),
		);

		const completionEvent = await waitForEventWithSchema(client, entityId, "complete");

		expect(completionEvent.eventSchemaSlug).toBe("complete");
		expect(completionEvent.properties).toMatchObject({
			completedOn: isoAt(1),
			completionMode: "custom_timestamps",
		});
		expect(completionEvent.occurredAt).toBe(isoAt(1));
	}, 45_000);

	it("logging less than 100% progress does not create a completion event", async () => {
		const { client } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(client);

		await client.run((c) =>
			c.events.create({
				payload: [
					{ entityId, properties: { progressPercent: 50 }, eventSchemaId: progressEventSchemaId },
				],
			}),
		);

		await waitForEventCount(client, entityId, 1);

		const events = await listEventsForEntity(client, entityId);
		const completeEvent = events.find((event) => event.eventSchemaSlug === "complete");

		expect(completeEvent).toBeUndefined();
	}, 45_000);

	it("logging 100% progress twice creates two completion events", async () => {
		const { client } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(client);

		await client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						eventSchemaId: progressEventSchemaId,
						properties: { progressPercent: 100 },
					},
				],
			}),
		);

		await waitForEventWithSchema(client, entityId, "complete");

		await client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						properties: { progressPercent: 100 },
						eventSchemaId: progressEventSchemaId,
					},
				],
			}),
		);

		await waitForEventCount(client, entityId, 4);

		const allEvents = await listEventsForEntity(client, entityId);
		const completeEvents = allEvents.filter((event) => event.eventSchemaSlug === "complete");

		expect(completeEvents.length).toBe(2);
	}, 45_000);

	it("logging all anime episodes creates a completion event", async () => {
		const { client } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(client, {
			entitySchemaSlug: "anime",
			properties: { images: [], episodes: 2 },
		});

		await client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						occurredAt: isoAt(1),
						eventSchemaId: progressEventSchemaId,
						properties: { progressPercent: 100, animeEpisode: 1 },
					},
					{
						entityId,
						occurredAt: isoAt(2),
						eventSchemaId: progressEventSchemaId,
						properties: { progressPercent: 100, animeEpisode: 2 },
					},
				],
			}),
		);

		const completeEvent = await waitForEventWithSchema(client, entityId, "complete");

		expect(completeEvent.eventSchemaSlug).toBe("complete");
		expect(completeEvent.properties).toMatchObject({
			completionMode: "custom_timestamps",
			completedOn: isoAt(2),
		});
		expect(completeEvent.occurredAt).toBe(isoAt(2));

		const events = await listEventsForEntity(client, entityId);
		expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(1);
	}, 45_000);

	it("anime with unknown episode count does not create a completion event", async () => {
		const { client } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(client, {
			entitySchemaSlug: "anime",
			properties: { images: [], episodes: null },
		});

		await client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						occurredAt: isoAt(1),
						eventSchemaId: progressEventSchemaId,
						properties: { progressPercent: 100, animeEpisode: 1 },
					},
				],
			}),
		);

		await waitForEventCount(client, entityId, 1);

		const events = await listEventsForEntity(client, entityId);
		expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(0);
	}, 45_000);

	it("logging all manga chapters creates a completion event", async () => {
		const { client } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(client, {
			entitySchemaSlug: "manga",
			properties: { images: [], volumes: null, chapters: 2 },
		});

		await client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						eventSchemaId: progressEventSchemaId,
						properties: { progressPercent: 100, mangaChapter: 1 },
					},
					{
						entityId,
						eventSchemaId: progressEventSchemaId,
						properties: { progressPercent: 100, mangaChapter: 2 },
					},
				],
			}),
		);

		const completeEvent = await waitForEventWithSchema(client, entityId, "complete");

		expect(completeEvent.eventSchemaSlug).toBe("complete");
	}, 45_000);

	it("manga with unknown chapter count does not create a completion event", async () => {
		const { client } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(client, {
			entitySchemaSlug: "manga",
			properties: { images: [], volumes: null, chapters: null },
		});

		await client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						occurredAt: isoAt(1),
						eventSchemaId: progressEventSchemaId,
						properties: { progressPercent: 100, mangaChapter: 1 },
					},
				],
			}),
		);

		await waitForEventCount(client, entityId, 1);

		const events = await listEventsForEntity(client, entityId);
		expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(0);
	}, 45_000);

	it("logging 100% podcast episode progress creates a completion event", async () => {
		const { client } = await createAuthenticatedClient();

		const podcastEpisodeSchemaId = await getBuiltinEntitySchemaId("podcast-episode");
		const eventSchemas = await listEventSchemas(client, podcastEpisodeSchemaId);
		const progressEventSchema = requireEventSchemaBySlug(eventSchemas, "progress");
		const entity = await seedMediaEntity({
			userId: null,
			sandboxScriptId: null,
			name: "Podcast Episode 1",
			entitySchemaId: podcastEpisodeSchemaId,
			externalId: `podcast-episode-${crypto.randomUUID()}`,
			properties: {
				runtime: null,
				episodeNumber: 1,
				publishDate: "2024-01-01",
				description: "First podcast episode",
			},
		});

		await client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId: entity.id,
						properties: { progressPercent: 100 },
						eventSchemaId: progressEventSchema.id,
					},
				],
			}),
		);

		const completeEvent = await waitForEventWithSchema(client, entity.id, "complete");

		expect(completeEvent.eventSchemaSlug).toBe("complete");
	}, 45_000);

	it("logging 100% show episode progress creates a completion event", async () => {
		const { client } = await createAuthenticatedClient();

		const showEpisodeSchemaId = await getBuiltinEntitySchemaId("show-episode");
		const eventSchemas = await listEventSchemas(client, showEpisodeSchemaId);
		const progressEventSchema = requireEventSchemaBySlug(eventSchemas, "progress");
		const entity = await seedMediaEntity({
			userId: null,
			sandboxScriptId: null,
			name: "Show Episode 1",
			entitySchemaId: showEpisodeSchemaId,
			externalId: `show-episode-${crypto.randomUUID()}`,
			properties: {
				runtime: 45,
				seasonNumber: 1,
				episodeNumber: 1,
				publishDate: null,
				description: "First show episode",
			},
		});

		await client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId: entity.id,
						properties: { progressPercent: 100 },
						eventSchemaId: progressEventSchema.id,
					},
				],
			}),
		);

		const completeEvent = await waitForEventWithSchema(client, entity.id, "complete");

		expect(completeEvent.eventSchemaSlug).toBe("complete");
	}, 45_000);

	it("logging 100% progress creates a timestamped completion event via builtin trigger", async () => {
		const { client } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(client, {
			entitySchemaSlug: "movie",
			properties: { images: [] },
		});

		await client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						occurredAt: isoAt(1),
						properties: { progressPercent: 100 },
						eventSchemaId: progressEventSchemaId,
					},
				],
			}),
		);

		const completeEvent = await waitForEventWithSchema(client, entityId, "complete");

		expect(completeEvent.eventSchemaSlug).toBe("complete");
		expect(completeEvent.properties).toMatchObject({
			completedOn: isoAt(1),
			completionMode: "custom_timestamps",
		});
		expect(completeEvent.occurredAt).toBe(isoAt(1));
	}, 45_000);

	it("consumedOn from a progress event is propagated to the auto-generated complete event", async () => {
		const { client } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(client, {
			entitySchemaSlug: "movie",
			properties: { images: [] },
		});

		await client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						occurredAt: isoAt(1),
						eventSchemaId: progressEventSchemaId,
						properties: { progressPercent: 100, consumedOn: "Jellyfin" },
					},
				],
			}),
		);

		const completeEvent = await waitForEventWithSchema(client, entityId, "complete");

		expect(completeEvent.properties).toMatchObject({
			consumedOn: "Jellyfin",
			completedOn: isoAt(1),
			completionMode: "custom_timestamps",
		});
		expect(completeEvent.occurredAt).toBe(isoAt(1));
	}, 45_000);

	it("complete event has no consumedOn when progress event omits it", async () => {
		const { client } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(client, {
			entitySchemaSlug: "movie",
			properties: { images: [] },
		});

		await client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						occurredAt: isoAt(1),
						properties: { progressPercent: 100 },
						eventSchemaId: progressEventSchemaId,
					},
				],
			}),
		);

		const completeEvent = await waitForEventWithSchema(client, entityId, "complete");

		expect(completeEvent.properties).not.toHaveProperty("consumedOn");
		expect(completeEvent.properties).toMatchObject({
			completionMode: "custom_timestamps",
			completedOn: isoAt(1),
		});
		expect(completeEvent.occurredAt).toBe(isoAt(1));
	}, 45_000);

	it("movie completion still fires twice when 100% progress is logged twice", async () => {
		const { client } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(client, {
			entitySchemaSlug: "movie",
			properties: { images: [] },
		});

		await client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						occurredAt: isoAt(1),
						properties: { progressPercent: 100 },
						eventSchemaId: progressEventSchemaId,
					},
				],
			}),
		);

		await waitForEventWithSchema(client, entityId, "complete");

		await client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						occurredAt: isoAt(2),
						properties: { progressPercent: 100 },
						eventSchemaId: progressEventSchemaId,
					},
				],
			}),
		);

		await waitForEventCount(client, entityId, 4);

		const events = await listEventsForEntity(client, entityId);
		expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(2);
	}, 45_000);
});
