import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createBuiltinMediaLifecycleFixture,
	waitForEventCount,
} from "../fixtures";

async function pollForEventWithSchema(
	client: Awaited<ReturnType<typeof createAuthenticatedClient>>["client"],
	cookies: string,
	entityId: string,
	eventSchemaSlug: string,
) {
	for (let attempt = 0; attempt < 30; attempt++) {
		const events = await client.GET("/events", {
			headers: { Cookie: cookies },
			params: { query: { entityId } },
		});
		const found = events.data?.data.find((event) => event.eventSchemaSlug === eventSchemaSlug);
		if (found) {
			return found;
		}

		await Bun.sleep(500);
	}

	throw new Error(`Timed out waiting for '${eventSchemaSlug}' event on '${entityId}'`);
}

async function listEventsForEntity(
	client: Awaited<ReturnType<typeof createAuthenticatedClient>>["client"],
	cookies: string,
	entityId: string,
) {
	const result = await client.GET("/events", {
		headers: { Cookie: cookies },
		params: { query: { entityId } },
	});
	return result.data?.data ?? [];
}

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
					eventSchemaId: progressEventSchemaId,
					properties: { progressPercent: 100 },
				},
			],
		});

		const completionEvent = await pollForEventWithSchema(client, cookies, entityId, "complete");

		expect(completionEvent.eventSchemaSlug).toBe("complete");
		expect(completionEvent.properties).toMatchObject({
			completionMode: "just_now",
		});
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
				{
					entityId,
					properties: { progressPercent: 50 },
					eventSchemaId: progressEventSchemaId,
				},
			],
		});

		await waitForEventCount(client, cookies, entityId, 1);

		const events = await client.GET("/events", {
			headers: { Cookie: cookies },
			params: { query: { entityId } },
		});
		const completeEvent = events.data?.data.find((event) => event.eventSchemaSlug === "complete");

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
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					properties: { progressPercent: 100 },
				},
			],
		});

		await pollForEventWithSchema(client, cookies, entityId, "complete");

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					properties: { progressPercent: 100 },
				},
			],
		});

		await waitForEventCount(client, cookies, entityId, 4);

		const allEvents = await client.GET("/events", {
			headers: { Cookie: cookies },
			params: { query: { entityId } },
		});
		const completeEvents = allEvents.data?.data.filter(
			(event) => event.eventSchemaSlug === "complete",
		);

		expect(completeEvents?.length).toBe(2);
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
							name: "Season 1",
							overview: null,
							publishDate: null,
							posterImages: [],
							backdropImages: [],
							seasonNumber: 1,
							episodes: [
								{
									id: 101,
									name: "Episode 1",
									runtime: null,
									overview: null,
									publishDate: null,
									posterImages: [],
									episodeNumber: 1,
								},
								{
									id: 102,
									name: "Episode 2",
									runtime: null,
									overview: null,
									publishDate: null,
									posterImages: [],
									episodeNumber: 2,
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
					properties: {
						progressPercent: 100,
						showSeason: 1,
						showEpisode: 1,
					},
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
							name: "Season 1",
							overview: null,
							publishDate: null,
							posterImages: [],
							backdropImages: [],
							seasonNumber: 1,
							episodes: [
								{
									id: 101,
									name: "Episode 1",
									runtime: null,
									overview: null,
									publishDate: null,
									posterImages: [],
									episodeNumber: 1,
								},
								{
									id: 102,
									name: "Episode 2",
									runtime: null,
									overview: null,
									publishDate: null,
									posterImages: [],
									episodeNumber: 2,
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
					properties: {
						progressPercent: 100,
						showSeason: 1,
						showEpisode: 1,
					},
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
					properties: {
						progressPercent: 100,
						showSeason: 1,
						showEpisode: 2,
					},
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
							name: "Season 1",
							overview: null,
							publishDate: null,
							posterImages: [],
							backdropImages: [],
							seasonNumber: 1,
							episodes: [
								{
									id: 101,
									name: "Episode 1",
									runtime: null,
									overview: null,
									publishDate: null,
									posterImages: [],
									episodeNumber: 1,
								},
							],
						},
						{
							id: 2,
							name: "Specials",
							overview: null,
							publishDate: null,
							posterImages: [],
							backdropImages: [],
							seasonNumber: 0,
							episodes: [
								{
									id: 201,
									name: "Special 1",
									runtime: null,
									overview: null,
									publishDate: null,
									posterImages: [],
									episodeNumber: 1,
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
					properties: {
						progressPercent: 100,
						showSeason: 1,
						showEpisode: 1,
					},
				},
			],
		});

		const completeEvent = await pollForEventWithSchema(client, cookies, entityId, "complete");

		expect(completeEvent.eventSchemaSlug).toBe("complete");

		const events = await listEventsForEntity(client, cookies, entityId);
		expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(1);
	}, 20_000);

	it("logging all anime episodes creates a completion event", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
			{
				entitySchemaSlug: "anime",
				properties: { images: [], episodes: 2 },
			},
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					properties: { progressPercent: 100, animeEpisode: 1 },
				},
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					properties: { progressPercent: 100, animeEpisode: 2 },
				},
			],
		});

		const completeEvent = await pollForEventWithSchema(client, cookies, entityId, "complete");

		expect(completeEvent.eventSchemaSlug).toBe("complete");

		const events = await listEventsForEntity(client, cookies, entityId);
		expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(1);
	}, 20_000);

	it("anime with unknown episode count completes immediately", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
			{
				entitySchemaSlug: "anime",
				properties: { images: [], episodes: null },
			},
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					properties: { progressPercent: 100, animeEpisode: 1 },
				},
			],
		});

		const completeEvent = await pollForEventWithSchema(client, cookies, entityId, "complete");

		expect(completeEvent.eventSchemaSlug).toBe("complete");

		const events = await listEventsForEntity(client, cookies, entityId);
		expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(1);
	}, 20_000);

	it("logging all manga chapters creates a completion event", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
			{
				entitySchemaSlug: "manga",
				properties: { images: [], volumes: null, chapters: 2 },
			},
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

		const completeEvent = await pollForEventWithSchema(client, cookies, entityId, "complete");

		expect(completeEvent.eventSchemaSlug).toBe("complete");
	}, 20_000);

	it("manga with unknown chapter count completes immediately", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
			{
				entitySchemaSlug: "manga",
				properties: { images: [], volumes: null, chapters: null },
			},
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					properties: { progressPercent: 100, mangaChapter: 1 },
				},
			],
		});

		const completeEvent = await pollForEventWithSchema(client, cookies, entityId, "complete");

		expect(completeEvent.eventSchemaSlug).toBe("complete");
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
							id: "episode-1",
							title: "Episode 1",
							publishDate: "2024-01-01",
							number: 1,
							runtime: null,
							overview: null,
							thumbnail: null,
						},
						{
							id: "episode-2",
							title: "Episode 2",
							publishDate: "2024-01-02",
							number: 2,
							runtime: null,
							overview: null,
							thumbnail: null,
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

		const completeEvent = await pollForEventWithSchema(client, cookies, entityId, "complete");

		expect(completeEvent.eventSchemaSlug).toBe("complete");
	}, 20_000);

	it("movie completion still happens immediately at 100% progress", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
			{
				entitySchemaSlug: "movie",
				properties: { images: [] },
			},
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					properties: { progressPercent: 100 },
				},
			],
		});

		const completeEvent = await pollForEventWithSchema(client, cookies, entityId, "complete");

		expect(completeEvent.eventSchemaSlug).toBe("complete");
	}, 20_000);

	it("movie completion still fires twice when 100% progress is logged twice", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			client,
			cookies,
			{
				entitySchemaSlug: "movie",
				properties: { images: [] },
			},
		);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					properties: { progressPercent: 100 },
				},
			],
		});

		await pollForEventWithSchema(client, cookies, entityId, "complete");

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					properties: { progressPercent: 100 },
				},
			],
		});

		await waitForEventCount(client, cookies, entityId, 4);

		const events = await listEventsForEntity(client, cookies, entityId);
		expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(2);
	}, 20_000);
});
