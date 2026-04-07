import { describe, expect, it } from "bun:test";
import {
	createAuthenticatedClient,
	createEntity,
	findBuiltinTracker,
	listEntitySchemas,
	listEventSchemas,
	seedMediaEntity,
	waitForEventCount,
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
			propertiesSchema: {
				fields: { title: { type: "string" as const, label: "Title" } },
			},
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
				fields: {
					rating: {
						label: "Rating",
						type: "number" as const,
						validation: { required: true as const },
					},
				},
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

async function setupRuleEventFixture(
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
			name: `Rules Test Tracker ${crypto.randomUUID()}`,
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
			name: "Rule Test Item",
			accentColor: "#00FF00",
			slug: `rule-item-${crypto.randomUUID()}`,
			propertiesSchema: {
				fields: { title: { type: "string" as const, label: "Title" } },
			},
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
			name: "Progress Log",
			slug: `progress-log-${crypto.randomUUID()}`,
			propertiesSchema: {
				fields: {
					progressPercent: {
						type: "number" as const,
						label: "Progress Percent",
					},
					status: {
						type: "string" as const,
						label: "Status",
						validation: { required: true as const },
					},
				},
				rules: [
					{
						path: ["progressPercent"],
						kind: "validation" as const,
						validation: { required: true as const },
						when: {
							path: ["status"],
							value: "completed",
							operator: "eq" as const,
						},
					},
				],
			},
		},
	});
	if (
		eventSchemaResult.response.status !== 200 ||
		!eventSchemaResult.data?.data?.id
	) {
		throw new Error("Failed to create rule event schema");
	}
	const eventSchemaId = eventSchemaResult.data.data.id;

	const entity = await createEntity(apiClient, cookies, {
		image: null,
		entitySchemaId,
		name: "Rule Test Book",
		properties: { title: "Rule Test" },
	});

	return { apiClient, cookies, entityId: entity.id, eventSchemaId };
}

async function setupBuiltinMediaLifecycleFixture(
	client: ReturnType<typeof createAuthenticatedClient> extends Promise<infer T>
		? T
		: never,
) {
	const { client: apiClient, cookies, userId } = client;
	const builtinTracker = await findBuiltinTracker(apiClient, cookies);
	const schemas = await listEntitySchemas(apiClient, cookies, {
		trackerId: builtinTracker.id,
	});
	const bookSchema = schemas.find((schema) => schema.slug === "book");

	if (!bookSchema) {
		throw new Error("Missing built-in book schema");
	}

	const provider = bookSchema.providers[0];
	if (!provider) {
		throw new Error("Missing built-in book provider");
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

	const reviewEventSchema = eventSchemas.find(
		(schema) => schema.slug === "review",
	);
	if (!reviewEventSchema) {
		throw new Error("Missing built-in review event schema");
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

	const entity = await seedMediaEntity({
		userId,
		image: null,
		properties: {},
		entitySchemaId: bookSchema.id,
		externalId: `book-${crypto.randomUUID()}`,
		name: `Built-in Book ${crypto.randomUUID()}`,
		sandboxScriptId: provider.scriptId,
	});

	return {
		cookies,
		apiClient,
		entityId: entity.id,
		reviewEventSchemaId: reviewEventSchema.id,
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
				},
				{
					entityId,
					eventSchemaId,
					properties: { rating: 5 },
				},
				{
					entityId,
					eventSchemaId,
					properties: { rating: 3 },
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

	it("enforces conditional required rules end to end", async () => {
		const auth = await createAuthenticatedClient();
		const { apiClient, cookies, entityId, eventSchemaId } =
			await setupRuleEventFixture(auth);

		const optionalResult = await apiClient.POST("/events", {
			headers: { Cookie: cookies },
			body: [{ entityId, eventSchemaId, properties: { status: "draft" } }],
		});
		expect(optionalResult.response.status).toBe(200);
		expect(optionalResult.data?.data.count).toBe(1);

		const rejectedResult = await apiClient.POST("/events", {
			headers: { Cookie: cookies },
			body: [{ entityId, eventSchemaId, properties: { status: "completed" } }],
		});
		expect(rejectedResult.response.status).toBe(200);
		expect(rejectedResult.data?.data.count).toBe(1);

		const acceptedResult = await apiClient.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					eventSchemaId,
					properties: { status: "completed", progressPercent: 75 },
				},
			],
		});
		expect(acceptedResult.response.status).toBe(200);
		expect(acceptedResult.data?.data.count).toBe(1);

		const events = await waitForEventCount(apiClient, cookies, entityId, 2);
		expect(events.map((event) => event.properties)).toEqual([
			{ progressPercent: 75, status: "completed" },
			{ status: "draft" },
		]);
	});

	it("returns 404 when listing events for a non-existent entity", async () => {
		const { client: apiClient, cookies } = await createAuthenticatedClient();

		const result = await apiClient.GET("/events", {
			headers: { Cookie: cookies },
			params: { query: { entityId: crypto.randomUUID() } },
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
				{ entityId, eventSchemaId, properties: { rating: 4 } },
				{ entityId, eventSchemaId, properties: { rating: 5 } },
			],
		});

		const events = await waitForEventCount(apiClient, cookies, entityId, 2);
		expect(events.length).toBe(2);
	});

	it("creates repeated built-in backlog events and lists them", async () => {
		const auth = await createAuthenticatedClient();
		const { apiClient, cookies, entityId, backlogEventSchemaId } =
			await setupBuiltinMediaLifecycleFixture(auth);

		const createResult = await apiClient.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{ entityId, properties: {}, eventSchemaId: backlogEventSchemaId },
				{ entityId, properties: {}, eventSchemaId: backlogEventSchemaId },
			],
		});

		expect(createResult.response.status).toBe(200);
		expect(createResult.data?.data.count).toBe(2);

		const events = await waitForEventCount(apiClient, cookies, entityId, 2);
		expect(events).toHaveLength(2);
		expect(events.map((event) => event.eventSchemaSlug)).toEqual([
			"backlog",
			"backlog",
		]);
		expect(events.map((event) => event.properties)).toEqual([{}, {}]);
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
					properties: { progressPercent: 25.555 },
				},
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					properties: { progressPercent: 50.444 },
				},
			],
		});

		expect(createResult.response.status).toBe(200);
		expect(createResult.data?.data.count).toBe(2);

		const events = await waitForEventCount(apiClient, cookies, entityId, 2);
		expect(events).toHaveLength(2);
		expect(events.map((event) => event.eventSchemaSlug)).toEqual([
			"progress",
			"progress",
		]);
		expect(
			events
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
					eventSchemaId: completeEventSchemaId,
					properties: { completionMode: "just_now" },
				},
				{
					entityId,
					eventSchemaId: completeEventSchemaId,
					properties: {
						completionMode: "custom_timestamps",
						completedOn: "2026-03-27T18:30:00Z",
					},
				},
			],
		});

		expect(createResult.response.status).toBe(200);
		expect(createResult.data?.data.count).toBe(2);

		const events = await waitForEventCount(apiClient, cookies, entityId, 2);
		expect(events).toHaveLength(2);
		expect(events.map((event) => event.eventSchemaSlug)).toEqual([
			"complete",
			"complete",
		]);
		expect(events.map((event) => event.properties)).toEqual([
			{
				completionMode: "custom_timestamps",
				completedOn: "2026-03-27T18:30:00Z",
			},
			{ completionMode: "just_now" },
		]);
	});

	it("creates repeated built-in review events before completion exists", async () => {
		const auth = await createAuthenticatedClient();
		const { apiClient, cookies, entityId, reviewEventSchemaId } =
			await setupBuiltinMediaLifecycleFixture(auth);

		const createResult = await apiClient.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					properties: { rating: 4 },
					eventSchemaId: reviewEventSchemaId,
				},
				{
					entityId,
					eventSchemaId: reviewEventSchemaId,
					properties: { review: "Even better", rating: 5 },
				},
			],
		});

		expect(createResult.response.status).toBe(200);
		expect(createResult.data?.data.count).toBe(2);

		const events = await waitForEventCount(apiClient, cookies, entityId, 2);
		expect(events).toHaveLength(2);
		expect(events.map((event) => event.eventSchemaSlug)).toEqual([
			"review",
			"review",
		]);
		expect(events.map((event) => event.properties)).toEqual([
			{ review: "Even better", rating: 5 },
			{ rating: 4 },
		]);
	});
});
