import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createBuiltinMediaLifecycleFixture,
	createEventTestFixture,
	createRuleEventFixture,
	waitForEventCount,
} from "../fixtures";

describe("Events bulk POST", () => {
	it("creates multiple events and returns the count", async () => {
		const { client: apiClient, cookies } = await createAuthenticatedClient();
		const { entityId, eventSchemaId } = await createEventTestFixture(apiClient, cookies);

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
		const { client: apiClient, cookies } = await createAuthenticatedClient();
		const { entityId, eventSchemaId } = await createRuleEventFixture(apiClient, cookies);

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
		const { client: apiClient, cookies } = await createAuthenticatedClient();
		const { entityId, eventSchemaId } = await createEventTestFixture(apiClient, cookies);

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

	it("filters listed events by event schema slug", async () => {
		const { cookies, client: apiClient } = await createAuthenticatedClient();
		const { entityId, completeEventSchemaId, progressEventSchemaId } =
			await createBuiltinMediaLifecycleFixture(apiClient, cookies);

		const createResult = await apiClient.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					properties: { progressPercent: 25 },
				},
				{
					entityId,
					eventSchemaId: completeEventSchemaId,
					properties: { completionMode: "just_now" },
				},
			],
		});

		expect(createResult.response.status).toBe(200);
		expect(createResult.data?.data.count).toBe(2);

		await waitForEventCount(apiClient, cookies, entityId, 2);

		const allEventsResult = await apiClient.GET("/events", {
			headers: { Cookie: cookies },
			params: { query: { entityId } },
		});
		expect(allEventsResult.response.status).toBe(200);
		expect(allEventsResult.data?.data).toHaveLength(2);

		const progressEventsResult = await apiClient.GET("/events", {
			headers: { Cookie: cookies },
			params: { query: { entityId, eventSchemaSlug: "progress" } },
		});
		expect(progressEventsResult.response.status).toBe(200);
		expect(progressEventsResult.data?.data.map((event) => event.eventSchemaSlug)).toEqual([
			"progress",
		]);

		const completeEventsResult = await apiClient.GET("/events", {
			headers: { Cookie: cookies },
			params: { query: { entityId, eventSchemaSlug: "complete" } },
		});
		expect(completeEventsResult.response.status).toBe(200);
		expect(completeEventsResult.data?.data.map((event) => event.eventSchemaSlug)).toEqual([
			"complete",
		]);

		const missingEventsResult = await apiClient.GET("/events", {
			headers: { Cookie: cookies },
			params: { query: { entityId, eventSchemaSlug: "nonexistent" } },
		});
		expect(missingEventsResult.response.status).toBe(200);
		expect(missingEventsResult.data?.data).toEqual([]);
	});

	it("creates repeated built-in backlog events and lists them", async () => {
		const { cookies, client: apiClient } = await createAuthenticatedClient();
		const { entityId, backlogEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			apiClient,
			cookies,
		);

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
		expect(events.map((event) => event.eventSchemaSlug)).toEqual(["backlog", "backlog"]);
		expect(events.map((event) => event.properties)).toEqual([{}, {}]);
	});

	it("creates built-in progress events with rounded values and no completion side effects", async () => {
		const { cookies, client: apiClient } = await createAuthenticatedClient();
		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			apiClient,
			cookies,
		);

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
		expect(events.map((event) => event.eventSchemaSlug)).toEqual(["progress", "progress"]);
		expect(
			events.map((event) => event.properties.progressPercent as number).toSorted((a, b) => a - b),
		).toEqual([25.56, 50.44]);
	});

	it("creates repeated built-in complete events without relying on progress", async () => {
		const { cookies, client: apiClient } = await createAuthenticatedClient();
		const { entityId, completeEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			apiClient,
			cookies,
		);

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
		expect(events.map((event) => event.eventSchemaSlug)).toEqual(["complete", "complete"]);
		expect(events.map((event) => event.properties)).toEqual([
			{
				completionMode: "custom_timestamps",
				completedOn: "2026-03-27T18:30:00Z",
			},
			{ completionMode: "just_now" },
		]);
	});

	it("creates repeated built-in review events before completion exists", async () => {
		const { cookies, client: apiClient } = await createAuthenticatedClient();
		const { entityId, reviewEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			apiClient,
			cookies,
		);

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
		expect(events.map((event) => event.eventSchemaSlug)).toEqual(["review", "review"]);
		expect(events.map((event) => event.properties)).toEqual([
			{ review: "Even better", rating: 5 },
			{ rating: 4 },
		]);
	});
});
