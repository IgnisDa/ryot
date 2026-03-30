import { describe, expect, it } from "bun:test";
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

describe("GET /media/overview", () => {
	it("returns built-in media sections with latest-event semantics", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client, cookies);
		const schemas = await listEntitySchemas(client, cookies, {
			trackerId: builtinTracker.id,
		});
		const bookSchema = schemas.find((item) => item.slug === "book");
		const animeSchema = schemas.find((item) => item.slug === "anime");
		const mangaSchema = schemas.find((item) => item.slug === "manga");
		if (!bookSchema || !animeSchema || !mangaSchema) {
			throw new Error("Missing built-in media schemas");
		}
		const bookProvider = bookSchema.providers[0];
		const animeProvider = animeSchema.providers[0];
		const mangaProvider = mangaSchema.providers[0];
		if (!bookProvider || !animeProvider || !mangaProvider) {
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
		const upNextAnime = await createEntity(client, cookies, {
			image: null,
			name: "Up Next Anime",
			entitySchemaId: animeSchema.id,
			externalId: `anime-${crypto.randomUUID()}`,
			properties: { publishYear: 2024, episodes: 24 },
			sandboxScriptId: animeProvider.scriptId,
		});
		const unknownTotalManga = await createEntity(client, cookies, {
			image: null,
			properties: {},
			name: "Unknown Total Manga",
			entitySchemaId: mangaSchema.id,
			externalId: `manga-${crypto.randomUUID()}`,
			sandboxScriptId: mangaProvider.scriptId,
		});
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
			entityId: continueBook.id,
			eventSchemaSlug: "progress",
			entitySchemaId: bookSchema.id,
			properties: { progressPercent: 25 },
		});
		await createBuiltInMediaEvent({
			client,
			cookies,
			properties: {},
			entityId: upNextAnime.id,
			eventSchemaSlug: "backlog",
			entitySchemaId: animeSchema.id,
		});
		await createBuiltInMediaEvent({
			client,
			cookies,
			eventSchemaSlug: "progress",
			entityId: unknownTotalManga.id,
			entitySchemaId: mangaSchema.id,
			properties: { progressPercent: 55 },
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

		const { data, response } = await client.GET("/media/overview", {
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
		expect(data?.data.continue.items.map((item) => item.id)).toEqual([
			unknownTotalManga.id,
			continueBook.id,
		]);
		expect(data?.data.continue.items[0]).toMatchObject({
			id: unknownTotalManga.id,
			labels: { cta: "Log Progress", progress: "55% complete" },
			progress: { totalUnits: null, currentUnits: null, progressPercent: 55 },
		});
		expect(data?.data.continue.items[1]).toMatchObject({
			id: continueBook.id,
			subtitle: { raw: 2021, label: "2021" },
			labels: { cta: "Log Progress", progress: "80 / 320 pages" },
			progress: { totalUnits: 320, currentUnits: 80, progressPercent: 25 },
		});

		expect(data?.data.upNext.items).toEqual([
			expect.objectContaining({
				id: upNextAnime.id,
				labels: { cta: "Start" },
				subtitle: { raw: 2024, label: "2024" },
			}),
		]);

		expect(data?.data.rateThese.items).toEqual([
			expect.objectContaining({
				rating: 2,
				id: rateAnime.id,
				reviewAt: expect.any(String),
				completedAt: expect.stringContaining("2026-04-05"),
			}),
		]);
	});

	it("returns the overview without tracker scoping", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { data, response } = await client.GET("/media/overview", {
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
	});

	describe("UTC date handling", () => {
		it("returns media overview dates in UTC format", async () => {
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

			const { data, response } = await client.GET("/media/overview", {
				headers: { Cookie: cookies },
			});

			expect(response.status).toBe(200);
			expect(data?.data).toBeDefined();

			const continueItem = data?.data.continue.items.find(
				(item) => item.id === testBook.id,
			);
			expect(continueItem).toBeDefined();

			const progressAt = (continueItem as { progressAt?: string })?.progressAt;
			expect(typeof progressAt).toBe("string");
			expect(progressAt).toMatch(
				/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
			);
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

			const { data, response } = await client.GET("/media/overview", {
				headers: { Cookie: cookies },
			});

			expect(response.status).toBe(200);

			const upNextItem = data?.data.upNext.items.find(
				(item) => item.id === testAnime.id,
			);
			expect(upNextItem).toBeDefined();

			const backlogAt = (upNextItem as { backlogAt?: string })?.backlogAt;
			expect(typeof backlogAt).toBe("string");
			expect(backlogAt).toMatch(
				/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
			);
		});
	});
});
