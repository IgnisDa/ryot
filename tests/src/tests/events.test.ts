import { describe, expect, it } from "bun:test";

import { EntityId } from "@ryot/app-backend/schema/brands";

import {
	createAuthenticatedClient,
	createBuiltinMediaLifecycleFixture,
	createEventTestFixture,
	createRuleEventFixture,
	waitForEventCount,
} from "../fixtures";
import { assertTaggedError } from "../test-support/assertions";

describe("Events bulk POST", () => {
	it("creates multiple events and returns the count", async () => {
		const { client: apiClient } = await createAuthenticatedClient();
		const { entityId, eventSchemaId } = await createEventTestFixture(apiClient);

		const result = await apiClient.run((c) =>
			c.events.create({
				payload: [
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
			}),
		);

		expect(result.count).toBe(3);
	});

	it("returns zero count for an empty array", async () => {
		const { client: apiClient } = await createAuthenticatedClient();

		const result = await apiClient.run((c) => c.events.create({ payload: [] }));

		expect(result.count).toBe(0);
	});

	it("enforces conditional required rules end to end", async () => {
		const { client: apiClient } = await createAuthenticatedClient();
		const { entityId, eventSchemaId } = await createRuleEventFixture(apiClient);

		const optionalResult = await apiClient.run((c) =>
			c.events.create({
				payload: [{ entityId, eventSchemaId, properties: { status: "draft" } }],
			}),
		);
		expect(optionalResult.count).toBe(1);

		const rejectedError = await apiClient.runError((c) =>
			c.events.create({
				payload: [{ entityId, eventSchemaId, properties: { status: "completed" } }],
			}),
		);
		assertTaggedError(rejectedError, "BadRequest");

		const acceptedResult = await apiClient.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						eventSchemaId,
						properties: { status: "completed", progressPercent: 75 },
					},
				],
			}),
		);
		expect(acceptedResult.count).toBe(1);

		const events = await waitForEventCount(apiClient, entityId, 2);
		expect(events.map((event) => event.properties)).toEqual([
			{ progressPercent: 75, status: "completed" },
			{ status: "draft" },
		]);
	});

	it("returns 404 when listing events for a non-existent entity", async () => {
		const { client: apiClient } = await createAuthenticatedClient();

		const error = await apiClient.runError((c) =>
			c.events.list({ urlParams: { entityId: EntityId.make(crypto.randomUUID()) } }),
		);

		assertTaggedError(error, "NotFound");
	});

	it("persists events and they appear in the list", async () => {
		const { client: apiClient } = await createAuthenticatedClient();
		const { entityId, eventSchemaId } = await createEventTestFixture(apiClient);

		await apiClient.run((c) =>
			c.events.create({
				payload: [
					{ entityId, eventSchemaId, properties: { rating: 4 } },
					{ entityId, eventSchemaId, properties: { rating: 5 } },
				],
			}),
		);

		const events = await waitForEventCount(apiClient, entityId, 2);
		expect(events.length).toBe(2);
	});

	it("filters listed events by event schema slug", async () => {
		const { client: apiClient } = await createAuthenticatedClient();
		const { entityId, completeEventSchemaId, progressEventSchemaId } =
			await createBuiltinMediaLifecycleFixture(apiClient);

		const createResult = await apiClient.run((c) =>
			c.events.create({
				payload: [
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
			}),
		);

		expect(createResult.count).toBe(2);

		await waitForEventCount(apiClient, entityId, 2);

		const allEvents = await apiClient.run((c) => c.events.list({ urlParams: { entityId } }));
		expect(allEvents).toHaveLength(2);

		const progressEvents = await apiClient.run((c) =>
			c.events.list({ urlParams: { entityId, eventSchemaSlug: "progress" } }),
		);
		expect(progressEvents.map((event) => event.eventSchemaSlug)).toEqual(["progress"]);

		const completeEvents = await apiClient.run((c) =>
			c.events.list({ urlParams: { entityId, eventSchemaSlug: "complete" } }),
		);
		expect(completeEvents.map((event) => event.eventSchemaSlug)).toEqual(["complete"]);

		const missingEvents = await apiClient.run((c) =>
			c.events.list({ urlParams: { entityId, eventSchemaSlug: "nonexistent" } }),
		);
		expect(missingEvents).toEqual([]);
	});
});
