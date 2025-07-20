import { describe, expect, it } from "bun:test";
import { dayjs } from "@ryot/ts-utils/dayjs";
import {
	createAuthenticatedClient,
	createEntity,
	findBuiltinTracker,
	listEntitySchemas,
	listEventSchemas,
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
}

describe("GET /media/overview/continue", () => {
	it("returns continue items with progress", async () => {
		const { client, cookies } = await createAuthenticatedClient();
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

		const continueBook = await createEntity(client, cookies, {
			image: null,
			name: "Continue Book",
			entitySchemaId: bookSchema.id,
			externalId: `book-${crypto.randomUUID()}`,
			properties: { publishYear: 2021, pages: 320 },
			sandboxScriptId: bookProvider.scriptId,
		});
		const unknownTotalManga = await createEntity(client, cookies, {
			image: null,
			properties: {},
			name: "Unknown Total Manga",
			entitySchemaId: mangaSchema.id,
			externalId: `manga-${crypto.randomUUID()}`,
			sandboxScriptId: mangaProvider.scriptId,
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

	it("returns continue section without tracker scoping", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { data, response } = await client.GET("/media/overview/continue", {
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
	});

	it("returns continue dates in UTC format", async () => {
		const { client, cookies } = await createAuthenticatedClient();
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

		const testBook = await createEntity(client, cookies, {
			image: null,
			name: "UTC Date Test Book",
			entitySchemaId: bookSchema.id,
			externalId: `book-utc-${crypto.randomUUID()}`,
			properties: { publishYear: 2024, pages: 300 },
			sandboxScriptId: bookProvider.scriptId,
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
		const { client, cookies } = await createAuthenticatedClient();
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

		const upNextAnime = await createEntity(client, cookies, {
			image: null,
			name: "Up Next Anime",
			entitySchemaId: animeSchema.id,
			externalId: `anime-${crypto.randomUUID()}`,
			properties: { publishYear: 2024, episodes: 24 },
			sandboxScriptId: animeProvider.scriptId,
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

	it("returns up next section without tracker scoping", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { data, response } = await client.GET("/media/overview/up-next", {
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
	});

	it("preserves UTC midnight without timezone conversion", async () => {
		const { client, cookies } = await createAuthenticatedClient();
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

		const testAnime = await createEntity(client, cookies, {
			image: null,
			name: "Midnight UTC Anime",
			entitySchemaId: animeSchema.id,
			properties: { publishYear: 2024, episodes: 12 },
			externalId: `anime-midnight-${crypto.randomUUID()}`,
			sandboxScriptId: animeProvider.scriptId,
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
		const { client, cookies } = await createAuthenticatedClient();
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

		const rateAnime = await createEntity(client, cookies, {
			image: null,
			name: "Rate These Anime",
			entitySchemaId: animeSchema.id,
			externalId: `anime-${crypto.randomUUID()}`,
			properties: { publishYear: 2020, episodes: 12 },
			sandboxScriptId: animeProvider.scriptId,
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
				completedOn: "2026-04-05T10:00:00.000Z",
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
				completedAt: expect.stringContaining("2026-04-05"),
			}),
		]);
	});

	it("returns review section without tracker scoping", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { data, response } = await client.GET("/media/overview/review", {
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
	});
});

describe("GET /media/overview/activity", () => {
	it("returns recent media activity with entity metadata and ratings", async () => {
		const { client, cookies } = await createAuthenticatedClient();
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

		const watchedAnime = await createEntity(client, cookies, {
			name: "Recent Activity Anime",
			entitySchemaId: animeSchema.id,
			sandboxScriptId: animeProvider.scriptId,
			properties: { publishYear: 2024, episodes: 24 },
			externalId: `anime-activity-${crypto.randomUUID()}`,
			image: { kind: "remote", url: "https://example.com/anime.png" },
		});
		const reviewedManga = await createEntity(client, cookies, {
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
		const { client, cookies } = await createAuthenticatedClient();
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

		const weeklyBook = await createEntity(client, cookies, {
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
