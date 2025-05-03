import { describe, expect, it } from "bun:test";
import { createAuthenticatedClient } from "../fixtures";

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
});
