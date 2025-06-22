import { describe, expect, it } from "bun:test";
import { dayjs } from "@ryot/ts-utils";
import {
	createAuthenticatedClient,
	findBuiltinTracker,
	listEntitySchemas,
	listEventSchemas,
	seedMediaEntity,
	waitForEventCount,
} from "../fixtures";

async function createBuiltInMediaEvent(input: {
	cookies: string;
	entityId: string;
	entitySchemaId: string;
	properties: Record<string, unknown>;
	eventSchemaSlug: "backlog" | "progress" | "complete" | "review";
	client: Awaited<ReturnType<typeof createAuthenticatedClient>>["client"];
}) {
	const eventSchemas = await listEventSchemas(
		input.client,
		input.cookies,
		input.entitySchemaId,
	);
	const eventSchema = eventSchemas.find(
		(item) => item.slug === input.eventSchemaSlug,
	);
	if (!eventSchema) {
		throw new Error(`Missing built-in event schema '${input.eventSchemaSlug}'`);
	}

	const before = await input.client.GET("/events", {
		headers: { Cookie: input.cookies },
		params: { query: { entityId: input.entityId } },
	});
	const beforeCount = before.data?.data.length ?? 0;

	const result = await input.client.POST("/events", {
		headers: { Cookie: input.cookies },
		body: [
			{
				entityId: input.entityId,
				properties: input.properties,
				eventSchemaId: eventSchema.id,
			},
		],
	});

	if (result.response.status !== 200) {
		throw new Error(`Failed to create '${input.eventSchemaSlug}' event`);
	}

	await waitForEventCount(
		input.client,
		input.cookies,
		input.entityId,
		beforeCount + 1,
	);
}

describe("GET /media/overview/continue", () => {
	it("returns continue items with progress", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client, cookies);
		const schemas = await listEntitySchemas(client, cookies, {
			trackerId: builtinTracker.id,
		});
		const bookSchema = schemas.find((item) => item.slug === "book");
		const mangaSchema = schemas.find((item) => item.slug === "manga");
		if (!bookSchema || !mangaSchema) {
			throw new Error("Missing built-in media schemas");
		}
		const bookProvider = bookSchema.providers[0];
		const mangaProvider = mangaSchema.providers[0];
		if (!bookProvider || !mangaProvider) {
			throw new Error("Missing built-in providers");
		}

		const continueBook = await seedMediaEntity({
			userId,
			image: null,
			name: "Continue Book",
			entitySchemaId: bookSchema.id,
			sandboxScriptId: bookProvider.scriptId,
			externalId: `book-${crypto.randomUUID()}`,
			properties: { publishYear: 2021, pages: 320 },
		});
		const unknownTotalManga = await seedMediaEntity({
			userId,
			image: null,
			properties: {},
			name: "Unknown Total Manga",
			entitySchemaId: mangaSchema.id,
			sandboxScriptId: mangaProvider.scriptId,
			externalId: `manga-${crypto.randomUUID()}`,
		});

		await createBuiltInMediaEvent({
			client,
			cookies,
			entityId: continueBook.id,
			eventSchemaSlug: "progress",
			entitySchemaId: bookSchema.id,
			properties: { progressPercent: 25 },
		});
		await createBuiltInMediaEvent({
			client,
			cookies,
			eventSchemaSlug: "progress",
			entityId: unknownTotalManga.id,
			entitySchemaId: mangaSchema.id,
			properties: { progressPercent: 55 },
		});

		const { data, response } = await client.GET("/media/overview/continue", {
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
		expect(data?.data.items.map((item) => item.id)).toEqual([
			unknownTotalManga.id,
			continueBook.id,
		]);
		expect(data?.data.items[0]).toMatchObject({
			id: unknownTotalManga.id,
			labels: { cta: "Log Progress", progress: "55% complete" },
			progress: { totalUnits: null, currentUnits: null, progressPercent: 55 },
		});
		expect(data?.data.items[1]).toMatchObject({
			id: continueBook.id,
			subtitle: { raw: 2021, label: "2021" },
			labels: { cta: "Log Progress", progress: "80 / 320 pages" },
			progress: { totalUnits: 320, currentUnits: 80, progressPercent: 25 },
		});
	});

	it("returns continue dates in UTC format", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client, cookies);
		const schemas = await listEntitySchemas(client, cookies, {
			trackerId: builtinTracker.id,
		});
		const bookSchema = schemas.find((item) => item.slug === "book");
		if (!bookSchema) {
			throw new Error("Missing book schema");
		}
		const bookProvider = bookSchema.providers[0];
		if (!bookProvider) {
			throw new Error("Missing provider");
		}

		const testBook = await seedMediaEntity({
			userId,
			image: null,
			name: "UTC Date Test Book",
			entitySchemaId: bookSchema.id,
			sandboxScriptId: bookProvider.scriptId,
			externalId: `book-utc-${crypto.randomUUID()}`,
			properties: { publishYear: 2024, pages: 300 },
		});

		await createBuiltInMediaEvent({
			client,
			cookies,
			entityId: testBook.id,
			eventSchemaSlug: "progress",
			entitySchemaId: bookSchema.id,
			properties: { progressPercent: 50 },
		});

		const { data, response } = await client.GET("/media/overview/continue", {
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();

		const continueItem = data?.data.items.find(
			(item) => item.id === testBook.id,
		);
		expect(continueItem).toBeDefined();

		const progressAt = (continueItem as { progressAt?: string })?.progressAt;
		if (!progressAt) {
			throw new Error("Expected progressAt");
		}
		expect(typeof progressAt).toBe("string");
		expect(dayjs.utc(progressAt).isValid()).toBe(true);
		expect(dayjs.utc(progressAt).toISOString()).toBe(progressAt);
	});
});

describe("GET /media/overview/up-next", () => {
	it("returns up next items with backlog", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client, cookies);
		const schemas = await listEntitySchemas(client, cookies, {
			trackerId: builtinTracker.id,
		});
		const animeSchema = schemas.find((item) => item.slug === "anime");
		if (!animeSchema) {
			throw new Error("Missing anime schema");
		}
		const animeProvider = animeSchema.providers[0];
		if (!animeProvider) {
			throw new Error("Missing provider");
		}

		const upNextAnime = await seedMediaEntity({
			userId,
			image: null,
			name: "Up Next Anime",
			entitySchemaId: animeSchema.id,
			sandboxScriptId: animeProvider.scriptId,
			externalId: `anime-${crypto.randomUUID()}`,
			properties: { publishYear: 2024, episodes: 24 },
		});

		await createBuiltInMediaEvent({
			client,
			cookies,
			properties: {},
			entityId: upNextAnime.id,
			eventSchemaSlug: "backlog",
			entitySchemaId: animeSchema.id,
		});

		const { data, response } = await client.GET("/media/overview/up-next", {
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
		expect(data?.data.items).toEqual([
			expect.objectContaining({
				id: upNextAnime.id,
				labels: { cta: "Start" },
				subtitle: { raw: 2024, label: "2024" },
			}),
		]);
	});

	it("removes items from Up Next after they are completed", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client, cookies);
		const schemas = await listEntitySchemas(client, cookies, {
			trackerId: builtinTracker.id,
		});
		const animeSchema = schemas.find((item) => item.slug === "anime");
		if (!animeSchema) {
			throw new Error("Missing anime schema");
		}
		const animeProvider = animeSchema.providers[0];
		if (!animeProvider) {
			throw new Error("Missing provider");
		}

		const completedAnime = await seedMediaEntity({
			userId,
			image: null,
			name: "Completed Up Next Anime",
			entitySchemaId: animeSchema.id,
			sandboxScriptId: animeProvider.scriptId,
			properties: { publishYear: 2024, episodes: 24 },
			externalId: `anime-completed-${crypto.randomUUID()}`,
		});

		await createBuiltInMediaEvent({
			client,
			cookies,
			properties: {},
			eventSchemaSlug: "backlog",
			entityId: completedAnime.id,
			entitySchemaId: animeSchema.id,
		});
		await createBuiltInMediaEvent({
			client,
			cookies,
			entityId: completedAnime.id,
			eventSchemaSlug: "complete",
			entitySchemaId: animeSchema.id,
			properties: { completionMode: "just_now" },
		});

		const upNextResponse = await client.GET("/media/overview/up-next", {
			headers: { Cookie: cookies },
		});
		expect(upNextResponse.response.status).toBe(200);
		expect(
			upNextResponse.data?.data.items.find(
				(item) => item.id === completedAnime.id,
			),
		).toBeUndefined();

		const reviewResponse = await client.GET("/media/overview/review", {
			headers: { Cookie: cookies },
		});
		expect(reviewResponse.response.status).toBe(200);
		expect(
			reviewResponse.data?.data.items.find(
				(item) => item.id === completedAnime.id,
			),
		).toBeDefined();
	});

	it("preserves UTC midnight without timezone conversion", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client, cookies);
		const schemas = await listEntitySchemas(client, cookies, {
			trackerId: builtinTracker.id,
		});
		const animeSchema = schemas.find((item) => item.slug === "anime");
		if (!animeSchema) {
			throw new Error("Missing anime schema");
		}
		const animeProvider = animeSchema.providers[0];
		if (!animeProvider) {
			throw new Error("Missing provider");
		}

		const testAnime = await seedMediaEntity({
			userId,
			image: null,
			name: "Midnight UTC Anime",
			entitySchemaId: animeSchema.id,
			sandboxScriptId: animeProvider.scriptId,
			properties: { publishYear: 2024, episodes: 12 },
			externalId: `anime-midnight-${crypto.randomUUID()}`,
		});

		await createBuiltInMediaEvent({
			client,
			cookies,
			properties: {},
			entityId: testAnime.id,
			eventSchemaSlug: "backlog",
			entitySchemaId: animeSchema.id,
		});

		const { data, response } = await client.GET("/media/overview/up-next", {
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);

		const upNextItem = data?.data.items.find(
			(item) => item.id === testAnime.id,
		);
		expect(upNextItem).toBeDefined();

		const backlogAt = upNextItem?.backlogAt;
		if (!backlogAt) {
			throw new Error("Expected backlogAt");
		}
		expect(typeof backlogAt).toBe("string");
		expect(dayjs.utc(backlogAt).isValid()).toBe(true);
		expect(dayjs.utc(backlogAt).toISOString()).toBe(backlogAt);
	});
});

describe("GET /media/overview/review", () => {
	it("returns review items with complete", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client, cookies);
		const schemas = await listEntitySchemas(client, cookies, {
			trackerId: builtinTracker.id,
		});
		const animeSchema = schemas.find((item) => item.slug === "anime");
		if (!animeSchema) {
			throw new Error("Missing anime schema");
		}
		const animeProvider = animeSchema.providers[0];
		if (!animeProvider) {
			throw new Error("Missing provider");
		}

		const rateAnime = await seedMediaEntity({
			userId,
			image: null,
			name: "Rate These Anime",
			entitySchemaId: animeSchema.id,
			sandboxScriptId: animeProvider.scriptId,
			externalId: `anime-${crypto.randomUUID()}`,
			properties: { publishYear: 2020, episodes: 12 },
		});

		await createBuiltInMediaEvent({
			client,
			cookies,
			entityId: rateAnime.id,
			eventSchemaSlug: "review",
			entitySchemaId: animeSchema.id,
			properties: { rating: 2, review: "old review" },
		});
		await createBuiltInMediaEvent({
			client,
			cookies,
			entityId: rateAnime.id,
			eventSchemaSlug: "complete",
			entitySchemaId: animeSchema.id,
			properties: {
				completionMode: "custom_timestamps",
				completedOn: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		const { data, response } = await client.GET("/media/overview/review", {
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
		expect(data?.data.items).toEqual([
			expect.objectContaining({
				rating: 2,
				id: rateAnime.id,
				reviewAt: expect.any(String),
				completedAt: expect.stringContaining(dayjs.utc().format("YYYY-MM-DD")),
			}),
		]);
	});
});

describe("GET /media/overview/activity", () => {
	it("returns recent media activity with entity metadata and ratings", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client, cookies);
		const schemas = await listEntitySchemas(client, cookies, {
			trackerId: builtinTracker.id,
		});
		const animeSchema = schemas.find((item) => item.slug === "anime");
		const mangaSchema = schemas.find((item) => item.slug === "manga");
		if (!animeSchema || !mangaSchema) {
			throw new Error("Missing built-in media schemas");
		}
		const animeProvider = animeSchema.providers[0];
		const mangaProvider = mangaSchema.providers[0];
		if (!animeProvider || !mangaProvider) {
			throw new Error("Missing built-in providers");
		}

		const watchedAnime = await seedMediaEntity({
			userId,
			name: "Recent Activity Anime",
			entitySchemaId: animeSchema.id,
			sandboxScriptId: animeProvider.scriptId,
			properties: { publishYear: 2024, episodes: 24 },
			externalId: `anime-activity-${crypto.randomUUID()}`,
			image: { kind: "remote", url: "https://example.com/anime.png" },
		});
		const reviewedManga = await seedMediaEntity({
			userId,
			image: null,
			name: "Recent Activity Manga",
			entitySchemaId: mangaSchema.id,
			sandboxScriptId: mangaProvider.scriptId,
			properties: { publishYear: 2023, chapters: 120 },
			externalId: `manga-activity-${crypto.randomUUID()}`,
		});

		await createBuiltInMediaEvent({
			client,
			cookies,
			entityId: watchedAnime.id,
			eventSchemaSlug: "progress",
			entitySchemaId: animeSchema.id,
			properties: { progressPercent: 50 },
		});
		await createBuiltInMediaEvent({
			client,
			cookies,
			eventSchemaSlug: "review",
			entityId: reviewedManga.id,
			entitySchemaId: mangaSchema.id,
			properties: { rating: 4, review: "Strong finish" },
		});

		const { data, response } = await client.GET("/media/overview/activity", {
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
		const reviewedItem = data?.data.items.find(
			(item) =>
				item.eventSchemaSlug === "review" &&
				item.entity.name === "Recent Activity Manga",
		);
		expect(reviewedItem).toMatchObject({
			rating: 4,
			eventSchemaSlug: "review",
			entity: {
				image: null,
				entitySchemaSlug: "manga",
				name: "Recent Activity Manga",
			},
		});
		expect(data?.data.items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					rating: null,
					eventSchemaSlug: "progress",
					entity: {
						entitySchemaSlug: "anime",
						name: "Recent Activity Anime",
						image: {
							kind: "remote",
							url: "https://example.com/anime.png",
						},
					},
				}),
			]),
		);
		const occurredAt = reviewedItem?.occurredAt;
		if (!occurredAt) {
			throw new Error("Expected occurredAt");
		}
		expect(typeof occurredAt).toBe("string");
		expect(dayjs.utc(occurredAt).isValid()).toBe(true);
		expect(dayjs.utc(occurredAt).toISOString()).toBe(occurredAt);
	});
});

describe("GET /media/overview/week", () => {
	it("returns seven Monday through Sunday buckets with event counts", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client, cookies);
		const schemas = await listEntitySchemas(client, cookies, {
			trackerId: builtinTracker.id,
		});
		const bookSchema = schemas.find((item) => item.slug === "book");
		if (!bookSchema) {
			throw new Error("Missing built-in book schema");
		}
		const bookProvider = bookSchema.providers[0];
		if (!bookProvider) {
			throw new Error("Missing built-in provider");
		}

		const weeklyBook = await seedMediaEntity({
			userId,
			image: null,
			name: "Weekly Activity Book",
			entitySchemaId: bookSchema.id,
			sandboxScriptId: bookProvider.scriptId,
			properties: { publishYear: 2025, pages: 280 },
			externalId: `book-week-${crypto.randomUUID()}`,
		});

		await createBuiltInMediaEvent({
			client,
			cookies,
			properties: {},
			entityId: weeklyBook.id,
			eventSchemaSlug: "backlog",
			entitySchemaId: bookSchema.id,
		});
		await createBuiltInMediaEvent({
			client,
			cookies,
			entityId: weeklyBook.id,
			eventSchemaSlug: "progress",
			entitySchemaId: bookSchema.id,
			properties: { progressPercent: 10 },
		});
		await createBuiltInMediaEvent({
			client,
			cookies,
			entityId: weeklyBook.id,
			eventSchemaSlug: "review",
			entitySchemaId: bookSchema.id,
			properties: { rating: 5, review: "Excellent" },
		});

		const { data, response } = await client.GET("/media/overview/week", {
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);
		expect(data?.data.count).toBe(7);
		expect(data?.data.items.map((item) => item.dayLabel)).toEqual([
			"Mon",
			"Tue",
			"Wed",
			"Thu",
			"Fri",
			"Sat",
			"Sun",
		]);
		expect(data?.data.items.reduce((sum, item) => sum + item.count, 0)).toBe(3);
	});
});

describe("GET /media/overview/library", () => {
	it("returns library statistics with counts by status", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client, cookies);
		const schemas = await listEntitySchemas(client, cookies, {
			trackerId: builtinTracker.id,
		});
		const bookSchema = schemas.find((item) => item.slug === "book");
		const mangaSchema = schemas.find((item) => item.slug === "manga");
		if (!bookSchema || !mangaSchema) {
			throw new Error("Missing built-in media schemas");
		}
		const bookProvider = bookSchema.providers[0];
		const mangaProvider = mangaSchema.providers[0];
		if (!bookProvider || !mangaProvider) {
			throw new Error("Missing built-in providers");
		}

		// Create entities in different states
		const backlogBook = await seedMediaEntity({
			userId,
			image: null,
			name: "Backlog Book",
			entitySchemaId: bookSchema.id,
			sandboxScriptId: bookProvider.scriptId,
			properties: { publishYear: 2021, pages: 320 },
			externalId: `book-backlog-${crypto.randomUUID()}`,
		});

		const inProgressManga = await seedMediaEntity({
			userId,
			image: null,
			name: "In Progress Manga",
			entitySchemaId: mangaSchema.id,
			sandboxScriptId: mangaProvider.scriptId,
			properties: { publishYear: 2023, chapters: 100 },
			externalId: `manga-progress-${crypto.randomUUID()}`,
		});

		const completedBook = await seedMediaEntity({
			userId,
			image: null,
			name: "Completed Book",
			entitySchemaId: bookSchema.id,
			sandboxScriptId: bookProvider.scriptId,
			properties: { publishYear: 2020, pages: 250 },
			externalId: `book-complete-${crypto.randomUUID()}`,
		});

		// Add events
		await createBuiltInMediaEvent({
			client,
			cookies,
			properties: {},
			entityId: backlogBook.id,
			eventSchemaSlug: "backlog",
			entitySchemaId: bookSchema.id,
		});

		await createBuiltInMediaEvent({
			client,
			cookies,
			eventSchemaSlug: "progress",
			entityId: inProgressManga.id,
			entitySchemaId: mangaSchema.id,
			properties: { progressPercent: 30 },
		});

		await createBuiltInMediaEvent({
			client,
			cookies,
			entityId: completedBook.id,
			eventSchemaSlug: "complete",
			entitySchemaId: bookSchema.id,
			properties: { completionMode: "just_now" },
		});

		// Review the completed book
		await createBuiltInMediaEvent({
			client,
			cookies,
			eventSchemaSlug: "review",
			entityId: completedBook.id,
			entitySchemaId: bookSchema.id,
			properties: { rating: 4, review: "Great read" },
		});

		const { data, response } = await client.GET("/media/overview/library", {
			headers: { Cookie: cookies },
		});

		expect(data?.data).toBeDefined();
		expect(data?.data.total).toBe(3);
		expect(response.status).toBe(200);
		expect(data?.data.inBacklog).toBe(1);
		expect(data?.data.completed).toBe(1);
		expect(data?.data.avgRating).toBe(4);
		expect(data?.data.inProgress).toBe(1);
		expect(data?.data.entityTypeCounts).toMatchObject({ book: 2, manga: 1 });
	});

	it("returns null avgRating when no reviews exist", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client, cookies);
		const schemas = await listEntitySchemas(client, cookies, {
			trackerId: builtinTracker.id,
		});
		const bookSchema = schemas.find((item) => item.slug === "book");
		if (!bookSchema) {
			throw new Error("Missing book schema");
		}
		const bookProvider = bookSchema.providers[0];
		if (!bookProvider) {
			throw new Error("Missing provider");
		}

		const backlogBook = await seedMediaEntity({
			userId,
			image: null,
			name: "Backlog Only Book",
			entitySchemaId: bookSchema.id,
			sandboxScriptId: bookProvider.scriptId,
			properties: { publishYear: 2021, pages: 320 },
			externalId: `book-backlog-${crypto.randomUUID()}`,
		});

		await createBuiltInMediaEvent({
			client,
			cookies,
			properties: {},
			entityId: backlogBook.id,
			eventSchemaSlug: "backlog",
			entitySchemaId: bookSchema.id,
		});

		const { data, response } = await client.GET("/media/overview/library", {
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);
		expect(data?.data.avgRating).toBeNull();
		expect(data?.data.total).toBe(1);
	});

	it("returns library stats without tracker scoping", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { data, response } = await client.GET("/media/overview/library", {
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
		expect(typeof data?.data.total).toBe("number");
		expect(typeof data?.data.inBacklog).toBe("number");
		expect(typeof data?.data.inProgress).toBe("number");
		expect(typeof data?.data.completed).toBe("number");
	});
});
