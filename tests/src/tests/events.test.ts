import { describe, expect, it } from "bun:test";
import {
	createAuthenticatedClient,
	createEntity,
	findBuiltinTracker,
	listEntitySchemas,
	listEventSchemas,
} from "../fixtures";

async function setupEventFixture(
	client: ReturnType<typeof createAuthenticatedClient> extends Promise<infer T>
		? T
		: never,
) {
	const { client: apiClient, cookies } = client;

	const trackerResult = await apiClient.POST("/trackers", {
		headers: { Cookie: cookies },
		body: {
			icon: "book",
			accentColor: "#FF0000",
			name: `Events Test Tracker ${crypto.randomUUID()}`,
		},
	});
	if (trackerResult.response.status !== 200 || !trackerResult.data?.data?.id) {
		throw new Error("Failed to create tracker");
	}
	const trackerId = trackerResult.data.data.id;

	const schemaResult = await apiClient.POST("/entity-schemas", {
		headers: { Cookie: cookies },
		body: {
			trackerId,
			icon: "book",
			name: "Test Item",
			accentColor: "#00FF00",
			slug: `item-${crypto.randomUUID()}`,
			propertiesSchema: { title: { type: "string" as const } },
		},
	});
	if (schemaResult.response.status !== 200 || !schemaResult.data?.data?.id) {
		throw new Error("Failed to create entity schema");
	}
	const entitySchemaId = schemaResult.data.data.id;

	const eventSchemaResult = await apiClient.POST("/event-schemas", {
		headers: { Cookie: cookies },
		body: {
			entitySchemaId,
			name: "Finished",
			slug: `finished-${crypto.randomUUID()}`,
			propertiesSchema: {
				rating: { type: "number" as const, required: true as const },
			},
		},
	});
	if (
		eventSchemaResult.response.status !== 200 ||
		!eventSchemaResult.data?.data?.id
	) {
		throw new Error("Failed to create event schema");
	}
	const eventSchemaId = eventSchemaResult.data.data.id;

	const entityResult = await apiClient.POST("/entities", {
		headers: { Cookie: cookies },
		body: {
			image: null,
			entitySchemaId,
			name: "Test Book",
			properties: { title: "Test" },
		},
	});
	if (entityResult.response.status !== 200 || !entityResult.data?.data?.id) {
		throw new Error("Failed to create entity");
	}
	const entityId = entityResult.data.data.id;

	return { apiClient, cookies, entityId, eventSchemaId };
}

async function setupBuiltinMediaLifecycleFixture(
	client: ReturnType<typeof createAuthenticatedClient> extends Promise<infer T>
		? T
		: never,
) {
	const { client: apiClient, cookies } = client;
	const builtinTracker = await findBuiltinTracker(apiClient, cookies);
	const schemas = await listEntitySchemas(apiClient, cookies, {
		trackerId: builtinTracker.id,
	});
	const bookSchema = schemas.find((schema) => schema.slug === "book");

	if (!bookSchema) {
		throw new Error("Missing built-in book schema");
	}

	const provider = bookSchema.searchProviders[0];
	if (!provider) {
		throw new Error("Missing built-in book search provider");
	}

	const eventSchemas = await listEventSchemas(
		apiClient,
		cookies,
		bookSchema.id,
	);
	const backlogEventSchema = eventSchemas.find(
		(schema) => schema.slug === "backlog",
	);
	if (!backlogEventSchema) {
		throw new Error("Missing built-in backlog event schema");
	}

	const progressEventSchema = eventSchemas.find(
		(schema) => schema.slug === "progress",
	);
	if (!progressEventSchema) {
		throw new Error("Missing built-in progress event schema");
	}

	const completeEventSchema = eventSchemas.find(
		(schema) => schema.slug === "complete",
	);
	if (!completeEventSchema) {
		throw new Error("Missing built-in complete event schema");
	}

	const otherSchema = schemas.find((schema) => schema.slug === "anime");
	if (!otherSchema) {
		throw new Error("Missing built-in anime schema");
	}

	const otherEventSchemas = await listEventSchemas(
		apiClient,
		cookies,
		otherSchema.id,
	);
	const mismatchedBacklogEventSchema = otherEventSchemas.find(
		(schema) => schema.slug === "backlog",
	);
	if (!mismatchedBacklogEventSchema) {
		throw new Error("Missing mismatched backlog event schema");
	}

	const entity = await createEntity(apiClient, cookies, {
		image: null,
		properties: {},
		entitySchemaId: bookSchema.id,
		externalId: `book-${crypto.randomUUID()}`,
		name: `Built-in Book ${crypto.randomUUID()}`,
		detailsSandboxScriptId: provider.detailsScriptId,
	});

	return {
		cookies,
		apiClient,
		entityId: entity.id,
		backlogEventSchemaId: backlogEventSchema.id,
		completeEventSchemaId: completeEventSchema.id,
		progressEventSchemaId: progressEventSchema.id,
		mismatchedEventSchemaId: mismatchedBacklogEventSchema.id,
	};
}

describe("Events bulk POST", () => {
	it("creates multiple events and returns the count", async () => {
		const auth = await createAuthenticatedClient();
		const { apiClient, cookies, entityId, eventSchemaId } =
			await setupEventFixture(auth);

		const result = await apiClient.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					eventSchemaId,
					properties: { rating: 4 },
					occurredAt: "2026-01-01T10:00:00.000Z",
				},
				{
					entityId,
					eventSchemaId,
					properties: { rating: 5 },
					occurredAt: "2026-01-02T10:00:00.000Z",
				},
				{
					entityId,
					eventSchemaId,
					properties: { rating: 3 },
					occurredAt: "2026-01-03T10:00:00.000Z",
				},
			],
		});

		expect(result.response.status).toBe(200);
		expect(result.data?.data.count).toBe(3);
	});

	it("returns zero count for an empty array", async () => {
		const { client: apiClient, cookies } = await createAuthenticatedClient();

		const result = await apiClient.POST("/events", {
			headers: { Cookie: cookies },
			body: [],
		});

		expect(result.response.status).toBe(200);
		expect(result.data?.data.count).toBe(0);
	});

	it("returns 404 when the entity does not exist", async () => {
		const { client: apiClient, cookies } = await createAuthenticatedClient();

		const result = await apiClient.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					properties: {},
					entityId: crypto.randomUUID(),
					eventSchemaId: crypto.randomUUID(),
					occurredAt: "2026-01-01T10:00:00.000Z",
				},
			],
		});

		expect(result.response.status).toBe(404);
	});

	it("persists events and they appear in the list", async () => {
		const auth = await createAuthenticatedClient();
		const { apiClient, cookies, entityId, eventSchemaId } =
			await setupEventFixture(auth);

		await apiClient.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					eventSchemaId,
					properties: { rating: 4 },
					occurredAt: "2026-01-01T10:00:00.000Z",
				},
				{
					entityId,
					eventSchemaId,
					properties: { rating: 5 },
					occurredAt: "2026-01-02T10:00:00.000Z",
				},
			],
		});

		const listResult = await apiClient.GET("/events", {
			headers: { Cookie: cookies },
			params: { query: { entityId } },
		});

		expect(listResult.response.status).toBe(200);
		expect(listResult.data?.data.length).toBe(2);
	});

	it("creates repeated built-in backlog events and lists them", async () => {
		const auth = await createAuthenticatedClient();
		const { apiClient, cookies, entityId, backlogEventSchemaId } =
			await setupBuiltinMediaLifecycleFixture(auth);

		const createResult = await apiClient.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					properties: {},
					eventSchemaId: backlogEventSchemaId,
					occurredAt: "2026-01-01T10:00:00.000Z",
				},
				{
					entityId,
					properties: {},
					eventSchemaId: backlogEventSchemaId,
					occurredAt: "2026-01-02T10:00:00.000Z",
				},
			],
		});

		expect(createResult.response.status).toBe(200);
		expect(createResult.data?.data.count).toBe(2);

		const listResult = await apiClient.GET("/events", {
			headers: { Cookie: cookies },
			params: { query: { entityId } },
		});

		expect(listResult.response.status).toBe(200);
		expect(listResult.data?.data).toHaveLength(2);
		expect(listResult.data?.data.map((event) => event.eventSchemaSlug)).toEqual(
			["backlog", "backlog"],
		);
		expect(listResult.data?.data.map((event) => event.properties)).toEqual([
			{},
			{},
		]);
	});

	it("rejects a built-in backlog event schema from another entity schema", async () => {
		const auth = await createAuthenticatedClient();
		const { apiClient, cookies, entityId, mismatchedEventSchemaId } =
			await setupBuiltinMediaLifecycleFixture(auth);

		const result = await apiClient.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					properties: {},
					eventSchemaId: mismatchedEventSchemaId,
					occurredAt: "2026-01-01T10:00:00.000Z",
				},
			],
		});

		expect(result.response.status).toBe(400);
		expect(result.error?.error?.message).toBe(
			"Event schema does not belong to the entity schema",
		);
	});

	it("creates built-in progress events with rounded values and no completion side effects", async () => {
		const auth = await createAuthenticatedClient();
		const { apiClient, cookies, entityId, progressEventSchemaId } =
			await setupBuiltinMediaLifecycleFixture(auth);

		const createResult = await apiClient.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					occurredAt: "2026-01-01T10:00:00.000Z",
					properties: { progressPercent: 25.555 },
				},
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					occurredAt: "2026-01-02T10:00:00.000Z",
					properties: { progressPercent: 50.444 },
				},
			],
		});

		expect(createResult.response.status).toBe(200);
		expect(createResult.data?.data.count).toBe(2);

		const listResult = await apiClient.GET("/events", {
			headers: { Cookie: cookies },
			params: { query: { entityId } },
		});

		expect(listResult.response.status).toBe(200);
		expect(listResult.data?.data).toHaveLength(2);
		expect(listResult.data?.data.map((event) => event.eventSchemaSlug)).toEqual(
			["progress", "progress"],
		);
		expect(
			listResult.data?.data
				.map((event) => event.properties.progressPercent as number)
				.sort((a, b) => a - b),
		).toEqual([25.56, 50.44]);
	});

	it("creates repeated built-in complete events without relying on progress", async () => {
		const auth = await createAuthenticatedClient();
		const { apiClient, cookies, entityId, completeEventSchemaId } =
			await setupBuiltinMediaLifecycleFixture(auth);

		const createResult = await apiClient.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					properties: {},
					eventSchemaId: completeEventSchemaId,
					occurredAt: "2026-01-03T10:00:00.000Z",
				},
				{
					entityId,
					properties: {},
					eventSchemaId: completeEventSchemaId,
					occurredAt: "2026-01-04T10:00:00.000Z",
				},
			],
		});

		expect(createResult.response.status).toBe(200);
		expect(createResult.data?.data.count).toBe(2);

		const listResult = await apiClient.GET("/events", {
			headers: { Cookie: cookies },
			params: { query: { entityId } },
		});

		expect(listResult.response.status).toBe(200);
		expect(listResult.data?.data).toHaveLength(2);
		expect(listResult.data?.data.map((event) => event.eventSchemaSlug)).toEqual(
			["complete", "complete"],
		);
		expect(listResult.data?.data.map((event) => event.properties)).toEqual([
			{},
			{},
		]);
	});

	it("rejects built-in complete events with non-empty payloads", async () => {
		const auth = await createAuthenticatedClient();
		const { apiClient, cookies, entityId, completeEventSchemaId } =
			await setupBuiltinMediaLifecycleFixture(auth);

		const result = await apiClient.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					properties: { note: "not allowed" },
					eventSchemaId: completeEventSchemaId,
					occurredAt: "2026-01-05T10:00:00.000Z",
				},
			],
		});

		expect(result.response.status).toBe(400);
		expect(result.error?.error?.message).toContain(
			"Event properties validation failed",
		);
	});

	it("rejects built-in progress events outside the accepted range", async () => {
		const auth = await createAuthenticatedClient();
		const { apiClient, cookies, entityId, progressEventSchemaId } =
			await setupBuiltinMediaLifecycleFixture(auth);

		const result = await apiClient.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					properties: { progressPercent: 100 },
					eventSchemaId: progressEventSchemaId,
					occurredAt: "2026-01-01T10:00:00.000Z",
				},
			],
		});

		expect(result.response.status).toBe(400);
		expect(result.error?.error?.message).toBe(
			"Progress percent must be greater than 0 and less than 100",
		);
	});
});
