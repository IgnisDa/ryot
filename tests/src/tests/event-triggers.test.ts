import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createBuiltinMediaLifecycleFixture,
	listEventsForEntity,
	waitForEventCount,
	waitForEventWithSchema,
} from "../fixtures";

const isoAt = (day: number) => `2024-01-${String(day).padStart(2, "0")}T00:00:00.000Z`;

describe("Event trigger firing", () => {
	it("logging 100% progress creates a completion event via builtin trigger", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					occurredAt: isoAt(1),
					properties: { progressPercent: 100 },
					eventSchemaId: progressEventSchemaId,
				},
			],
		});

		const completionEvent = await waitForEventWithSchema(client, cookies, entityId, "complete");

		expect(completionEvent.eventSchemaSlug).toBe("complete");
		expect(completionEvent.properties).toMatchObject({
			completedOn: isoAt(1),
			completionMode: "custom_timestamps",
		});
		expect(completionEvent.occurredAt).toBe(isoAt(1));
	}, 20_000);

	it("logging less than 100% progress does not create a completion event", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{ entityId, properties: { progressPercent: 50 }, eventSchemaId: progressEventSchemaId },
			],
		});

		await waitForEventCount(client, cookies, entityId, 1);

		const events = await listEventsForEntity(client, cookies, entityId);
		const completeEvent = events.find((event) => event.eventSchemaSlug === "complete");

		expect(completeEvent).toBeUndefined();
	}, 20_000);

	it("logging 100% progress twice creates two completion events", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{ entityId, eventSchemaId: progressEventSchemaId, properties: { progressPercent: 100 } },
			],
		});

		await waitForEventWithSchema(client, cookies, entityId, "complete");

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{ entityId, properties: { progressPercent: 100 }, eventSchemaId: progressEventSchemaId },
			],
		});

		await waitForEventCount(client, cookies, entityId, 4);

		const allEvents = await listEventsForEntity(client, cookies, entityId);
		const completeEvents = allEvents.filter((event) => event.eventSchemaSlug === "complete");

		expect(completeEvents.length).toBe(2);
	}, 20_000);

	it("logging one show episode at 100% does not complete a multi-episode show", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
			{
				entitySchemaSlug: "show",
				properties: {
					images: [],
					showSeasons: [
						{
							id: 1,
							overview: null,
							seasonNumber: 1,
							name: "Season 1",
							posterImages: [],
							publishDate: null,
							backdropImages: [],
							episodes: [
								{
									id: 101,
									runtime: null,
									overview: null,
									posterImages: [],
									episodeNumber: 1,
									name: "Episode 1",
									publishDate: null,
								},
								{
									id: 102,
									runtime: null,
									overview: null,
									posterImages: [],
									episodeNumber: 2,
									publishDate: null,
									name: "Episode 2",
								},
							],
						},
					],
				},
			},
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					properties: { showSeason: 1, showEpisode: 1, progressPercent: 100 },
				},
			],
		});

		await waitForEventCount(client, cookies, entityId, 1);

		const events = await listEventsForEntity(client, cookies, entityId);
		expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(0);
	}, 20_000);

	it("logging every regular show episode at 100% creates exactly one completion event", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
			{
				entitySchemaSlug: "show",
				properties: {
					images: [],
					showSeasons: [
						{
							id: 1,
							overview: null,
							seasonNumber: 1,
							name: "Season 1",
							posterImages: [],
							publishDate: null,
							backdropImages: [],
							episodes: [
								{
									id: 101,
									runtime: null,
									overview: null,
									posterImages: [],
									episodeNumber: 1,
									name: "Episode 1",
									publishDate: null,
								},
								{
									id: 102,
									runtime: null,
									overview: null,
									posterImages: [],
									episodeNumber: 2,
									name: "Episode 2",
									publishDate: null,
								},
							],
						},
					],
				},
			},
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					properties: { showSeason: 1, showEpisode: 1, progressPercent: 100 },
				},
			],
		});

		await waitForEventCount(client, cookies, entityId, 1);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					properties: { showSeason: 1, showEpisode: 2, progressPercent: 100 },
				},
			],
		});

		await waitForEventCount(client, cookies, entityId, 3);

		const events = await listEventsForEntity(client, cookies, entityId);
		expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(1);
	}, 20_000);

	it("show completion ignores seasons named Specials", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
			{
				entitySchemaSlug: "show",
				properties: {
					images: [],
					showSeasons: [
						{
							id: 1,
							overview: null,
							seasonNumber: 1,
							posterImages: [],
							name: "Season 1",
							publishDate: null,
							backdropImages: [],
							episodes: [
								{
									id: 101,
									runtime: null,
									overview: null,
									episodeNumber: 1,
									posterImages: [],
									name: "Episode 1",
									publishDate: null,
								},
							],
						},
						{
							id: 2,
							overview: null,
							seasonNumber: 0,
							name: "Specials",
							posterImages: [],
							publishDate: null,
							backdropImages: [],
							episodes: [
								{
									id: 201,
									runtime: null,
									overview: null,
									posterImages: [],
									episodeNumber: 1,
									publishDate: null,
									name: "Special 1",
								},
							],
						},
					],
				},
			},
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					properties: { showSeason: 1, showEpisode: 1, progressPercent: 100 },
				},
			],
		});

		const completeEvent = await waitForEventWithSchema(client, cookies, entityId, "complete");

		expect(completeEvent.eventSchemaSlug).toBe("complete");

		const events = await listEventsForEntity(client, cookies, entityId);
		expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(1);
	}, 20_000);

	it("show with only Specials does not create a completion event", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
			{
				entitySchemaSlug: "show",
				properties: {
					images: [],
					showSeasons: [
						{
							id: 2,
							overview: null,
							seasonNumber: 0,
							posterImages: [],
							name: "Specials",
							publishDate: null,
							backdropImages: [],
							episodes: [
								{
									id: 201,
									runtime: null,
									overview: null,
									posterImages: [],
									episodeNumber: 1,
									name: "Special 1",
									publishDate: null,
								},
							],
						},
					],
				},
			},
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					occurredAt: isoAt(1),
					eventSchemaId: progressEventSchemaId,
					properties: { showSeason: 0, showEpisode: 1, progressPercent: 100 },
				},
			],
		});

		await waitForEventCount(client, cookies, entityId, 1);

		const events = await listEventsForEntity(client, cookies, entityId);
		expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(0);
	}, 20_000);

	it("logging all anime episodes creates a completion event", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
			{ entitySchemaSlug: "anime", properties: { images: [], episodes: 2 } },
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
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
		});

		const completeEvent = await waitForEventWithSchema(client, cookies, entityId, "complete");

		expect(completeEvent.eventSchemaSlug).toBe("complete");
		expect(completeEvent.properties).toMatchObject({
			completionMode: "custom_timestamps",
			completedOn: isoAt(2),
		});
		expect(completeEvent.occurredAt).toBe(isoAt(2));

		const events = await listEventsForEntity(client, cookies, entityId);
		expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(1);
	}, 20_000);

	it("anime with unknown episode count does not create a completion event", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
			{ entitySchemaSlug: "anime", properties: { images: [], episodes: null } },
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					occurredAt: isoAt(1),
					eventSchemaId: progressEventSchemaId,
					properties: { progressPercent: 100, animeEpisode: 1 },
				},
			],
		});

		await waitForEventCount(client, cookies, entityId, 1);

		const events = await listEventsForEntity(client, cookies, entityId);
		expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(0);
	}, 20_000);

	it("logging all manga chapters creates a completion event", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
			{ entitySchemaSlug: "manga", properties: { images: [], volumes: null, chapters: 2 } },
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
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
		});

		const completeEvent = await waitForEventWithSchema(client, cookies, entityId, "complete");

		expect(completeEvent.eventSchemaSlug).toBe("complete");
	}, 20_000);

	it("manga with unknown chapter count does not create a completion event", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
			{ entitySchemaSlug: "manga", properties: { images: [], volumes: null, chapters: null } },
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					occurredAt: isoAt(1),
					eventSchemaId: progressEventSchemaId,
					properties: { progressPercent: 100, mangaChapter: 1 },
				},
			],
		});

		await waitForEventCount(client, cookies, entityId, 1);

		const events = await listEventsForEntity(client, cookies, entityId);
		expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(0);
	}, 20_000);

	it("logging all podcast episodes creates a completion event", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
			{
				entitySchemaSlug: "podcast",
				properties: {
					images: [],
					totalEpisodes: 2,
					episodes: [
						{
							number: 1,
							runtime: null,
							overview: null,
							thumbnail: null,
							id: "episode-1",
							title: "Episode 1",
							publishDate: "2024-01-01",
						},
						{
							number: 2,
							runtime: null,
							overview: null,
							thumbnail: null,
							id: "episode-2",
							title: "Episode 2",
							publishDate: "2024-01-02",
						},
					],
				},
			},
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					properties: { progressPercent: 100, podcastEpisode: 1 },
				},
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					properties: { progressPercent: 100, podcastEpisode: 2 },
				},
			],
		});

		const completeEvent = await waitForEventWithSchema(client, cookies, entityId, "complete");

		expect(completeEvent.eventSchemaSlug).toBe("complete");
	}, 20_000);

	it("logging 100% progress creates a timestamped completion event via builtin trigger", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
			{ entitySchemaSlug: "movie", properties: { images: [] } },
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					occurredAt: isoAt(1),
					properties: { progressPercent: 100 },
					eventSchemaId: progressEventSchemaId,
				},
			],
		});

		const completeEvent = await waitForEventWithSchema(client, cookies, entityId, "complete");

		expect(completeEvent.eventSchemaSlug).toBe("complete");
		expect(completeEvent.properties).toMatchObject({
			completedOn: isoAt(1),
			completionMode: "custom_timestamps",
		});
		expect(completeEvent.occurredAt).toBe(isoAt(1));
	}, 20_000);

	it("consumedOn from a progress event is propagated to the auto-generated complete event", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
			{ entitySchemaSlug: "movie", properties: { images: [] } },
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					occurredAt: isoAt(1),
					eventSchemaId: progressEventSchemaId,
					properties: { progressPercent: 100, consumedOn: "Jellyfin" },
				},
			],
		});

		const completeEvent = await waitForEventWithSchema(client, cookies, entityId, "complete");

		expect(completeEvent.properties).toMatchObject({
			consumedOn: "Jellyfin",
			completedOn: isoAt(1),
			completionMode: "custom_timestamps",
		});
		expect(completeEvent.occurredAt).toBe(isoAt(1));
	}, 20_000);

	it("complete event has no consumedOn when progress event omits it", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
			{ entitySchemaSlug: "movie", properties: { images: [] } },
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					occurredAt: isoAt(1),
					properties: { progressPercent: 100 },
					eventSchemaId: progressEventSchemaId,
				},
			],
		});

		const completeEvent = await waitForEventWithSchema(client, cookies, entityId, "complete");

		expect(completeEvent.properties).not.toHaveProperty("consumedOn");
		expect(completeEvent.properties).toMatchObject({
			completionMode: "custom_timestamps",
			completedOn: isoAt(1),
		});
		expect(completeEvent.occurredAt).toBe(isoAt(1));
	}, 20_000);

	it("movie completion still fires twice when 100% progress is logged twice", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
			{ entitySchemaSlug: "movie", properties: { images: [] } },
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					occurredAt: isoAt(1),
					properties: { progressPercent: 100 },
					eventSchemaId: progressEventSchemaId,
				},
			],
		});

		await waitForEventWithSchema(client, cookies, entityId, "complete");

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					occurredAt: isoAt(2),
					properties: { progressPercent: 100 },
					eventSchemaId: progressEventSchemaId,
				},
			],
		});

		await waitForEventCount(client, cookies, entityId, 4);

		const events = await listEventsForEntity(client, cookies, entityId);
		expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(2);
	}, 20_000);
});
