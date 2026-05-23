import { describe, expect, it } from "bun:test";

import { sortBy } from "@ryot/ts-utils/lodash";

import {
	createAuthenticatedClient,
	createBuiltinMediaLifecycleFixture,
	findBuiltinSchemaBySlug,
	getFirstProviderScriptId,
	listEventSchemas,
	requireEventSchemaBySlug,
	seedMediaEntity,
	waitForEventCount,
} from "../fixtures";
import { assertTaggedError, requireNumber, requireObjectRecord } from "../test-support/assertions";

const getProgressPercent = (properties: unknown) =>
	requireNumber(
		requireObjectRecord(properties, "Expected event properties to be an object").progressPercent,
		"Expected progressPercent to be a number",
	);

describe("Events built-in status schemas", () => {
	it("creates repeated built-in backlog events and lists them", async () => {
		const { client: apiClient } = await createAuthenticatedClient();
		const { entityId, backlogEventSchemaId } = await createBuiltinMediaLifecycleFixture(apiClient);

		const createResult = await apiClient.run((c) =>
			c.events.create({
				payload: [
					{ entityId, properties: {}, eventSchemaId: backlogEventSchemaId },
					{ entityId, properties: {}, eventSchemaId: backlogEventSchemaId },
				],
			}),
		);

		expect(createResult.count).toBe(2);

		const events = await waitForEventCount(apiClient, entityId, 2);
		expect(events).toHaveLength(2);
		expect(events.map((event) => event.eventSchemaSlug)).toEqual(["backlog", "backlog"]);
		expect(events.map((event) => event.properties)).toEqual([{}, {}]);
	});

	it("creates built-in progress events with rounded values and no completion side effects", async () => {
		const { client: apiClient } = await createAuthenticatedClient();
		const { entityId, progressEventSchemaId } = await createBuiltinMediaLifecycleFixture(apiClient);

		const createResult = await apiClient.run((c) =>
			c.events.create({
				payload: [
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
			}),
		);

		expect(createResult.count).toBe(2);

		const events = await waitForEventCount(apiClient, entityId, 2);
		expect(events).toHaveLength(2);
		expect(events.map((event) => event.eventSchemaSlug)).toEqual(["progress", "progress"]);
		expect(sortBy(events.map((event) => getProgressPercent(event.properties)))).toEqual([
			25.56, 50.44,
		]);
	});

	it("creates repeated built-in complete events without relying on progress", async () => {
		const { client: apiClient } = await createAuthenticatedClient();
		const { entityId, completeEventSchemaId } = await createBuiltinMediaLifecycleFixture(apiClient);

		const createResult = await apiClient.run((c) =>
			c.events.create({
				payload: [
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
			}),
		);

		expect(createResult.count).toBe(2);

		const events = await waitForEventCount(apiClient, entityId, 2);
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

	it("persists timeSpent on a complete event and returns it", async () => {
		const { client: apiClient } = await createAuthenticatedClient();
		const { entityId, completeEventSchemaId } = await createBuiltinMediaLifecycleFixture(apiClient);

		const createResult = await apiClient.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						eventSchemaId: completeEventSchemaId,
						properties: { completionMode: "just_now", timeSpent: 120 },
					},
				],
			}),
		);

		expect(createResult.count).toBe(1);

		const events = await waitForEventCount(apiClient, entityId, 1);
		expect(events).toHaveLength(1);
		expect(events[0]?.eventSchemaSlug).toBe("complete");
		expect(events[0]?.properties).toMatchObject({ completionMode: "just_now", timeSpent: 120 });
	});

	it("accepts a complete event without timeSpent (optional field)", async () => {
		const { client: apiClient } = await createAuthenticatedClient();
		const { entityId, completeEventSchemaId } = await createBuiltinMediaLifecycleFixture(apiClient);

		const createResult = await apiClient.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						eventSchemaId: completeEventSchemaId,
						properties: { completionMode: "unknown" },
					},
				],
			}),
		);

		expect(createResult.count).toBe(1);
	});

	it("rejects a complete event with a negative timeSpent", async () => {
		const { client: apiClient } = await createAuthenticatedClient();
		const { entityId, completeEventSchemaId } = await createBuiltinMediaLifecycleFixture(apiClient);

		const error = await apiClient.runError((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						eventSchemaId: completeEventSchemaId,
						properties: { completionMode: "just_now", timeSpent: -10 },
					},
				],
			}),
		);

		assertTaggedError(error, "BadRequest");
	});

	it("creates repeated built-in review events before completion exists", async () => {
		const { client: apiClient } = await createAuthenticatedClient();
		const { entityId, reviewEventSchemaId } = await createBuiltinMediaLifecycleFixture(apiClient);

		const createResult = await apiClient.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						properties: { rating: 4 },
						eventSchemaId: reviewEventSchemaId,
					},
					{
						entityId,
						eventSchemaId: reviewEventSchemaId,
						properties: { text: "Even better", rating: 5 },
					},
				],
			}),
		);

		expect(createResult.count).toBe(2);

		const events = await waitForEventCount(apiClient, entityId, 2);
		expect(events).toHaveLength(2);
		expect(events.map((event) => event.eventSchemaSlug)).toEqual(["review", "review"]);
		expect(events.map((event) => event.properties)).toEqual([
			{ text: "Even better", rating: 5 },
			{ rating: 4 },
		]);
	});

	it("persists timeSpent on a dropped event and returns it", async () => {
		const { client: apiClient } = await createAuthenticatedClient();
		const { entityId, droppedEventSchemaId } = await createBuiltinMediaLifecycleFixture(apiClient);

		const createResult = await apiClient.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						eventSchemaId: droppedEventSchemaId,
						properties: { progressPercent: 40, timeSpent: 90 },
					},
				],
			}),
		);

		expect(createResult.count).toBe(1);

		const events = await waitForEventCount(apiClient, entityId, 1);
		expect(events[0]?.eventSchemaSlug).toBe("dropped");
		expect(events[0]?.properties).toMatchObject({ progressPercent: 40, timeSpent: 90 });
	});

	it("persists timeSpent on an on_hold event and returns it", async () => {
		const { client: apiClient } = await createAuthenticatedClient();
		const { entityId, onHoldEventSchemaId } = await createBuiltinMediaLifecycleFixture(apiClient);

		const createResult = await apiClient.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						eventSchemaId: onHoldEventSchemaId,
						properties: { progressPercent: 60, timeSpent: 45 },
					},
				],
			}),
		);

		expect(createResult.count).toBe(1);

		const events = await waitForEventCount(apiClient, entityId, 1);
		expect(events[0]?.eventSchemaSlug).toBe("on_hold");
		expect(events[0]?.properties).toMatchObject({ progressPercent: 60, timeSpent: 45 });
	});

	it("rejects a dropped event with a negative timeSpent", async () => {
		const { client: apiClient } = await createAuthenticatedClient();
		const { entityId, droppedEventSchemaId } = await createBuiltinMediaLifecycleFixture(apiClient);

		const error = await apiClient.runError((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						eventSchemaId: droppedEventSchemaId,
						properties: { progressPercent: 50, timeSpent: -5 },
					},
				],
			}),
		);

		assertTaggedError(error, "BadRequest");
	});

	it("creates built-in dropped events with rounded progress values", async () => {
		const { client: apiClient } = await createAuthenticatedClient();
		const { entityId, droppedEventSchemaId } = await createBuiltinMediaLifecycleFixture(apiClient);

		const createResult = await apiClient.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						eventSchemaId: droppedEventSchemaId,
						properties: { progressPercent: 33.333 },
					},
					{
						entityId,
						eventSchemaId: droppedEventSchemaId,
						properties: { progressPercent: 66.666 },
					},
				],
			}),
		);

		expect(createResult.count).toBe(2);

		const events = await waitForEventCount(apiClient, entityId, 2);
		expect(events).toHaveLength(2);
		expect(events.map((event) => event.eventSchemaSlug)).toEqual(["dropped", "dropped"]);
		expect(sortBy(events.map((event) => getProgressPercent(event.properties)))).toEqual([
			33.33, 66.67,
		]);
	});

	it("creates built-in on_hold events with rounded progress values", async () => {
		const { client: apiClient } = await createAuthenticatedClient();
		const { entityId, onHoldEventSchemaId } = await createBuiltinMediaLifecycleFixture(apiClient);

		const createResult = await apiClient.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						eventSchemaId: onHoldEventSchemaId,
						properties: { progressPercent: 45.555 },
					},
					{
						entityId,
						eventSchemaId: onHoldEventSchemaId,
						properties: { progressPercent: 75.444 },
					},
				],
			}),
		);

		expect(createResult.count).toBe(2);

		const events = await waitForEventCount(apiClient, entityId, 2);
		expect(events).toHaveLength(2);
		expect(events.map((event) => event.eventSchemaSlug)).toEqual(["on_hold", "on_hold"]);
		expect(sortBy(events.map((event) => getProgressPercent(event.properties)))).toEqual([
			45.56, 75.44,
		]);
	});

	it("creates dropped and on_hold events without positional episode fields for shows", async () => {
		const { client: apiClient } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(apiClient, "show");
		const eventSchemas = await listEventSchemas(apiClient, schema.id);
		const droppedEventSchema = requireEventSchemaBySlug(eventSchemas, "dropped");
		const onHoldEventSchema = requireEventSchemaBySlug(eventSchemas, "on_hold");
		const entity = await seedMediaEntity({
			image: null,
			userId: null,
			entitySchemaId: schema.id,
			name: `Show Events ${crypto.randomUUID()}`,
			externalId: `show-events-${crypto.randomUUID()}`,
			sandboxScriptId: getFirstProviderScriptId(schema),
			properties: {
				genres: [],
				images: [],
				isNsfw: null,
				sourceUrl: null,
				description: null,
				publishDate: null,
				publishYear: null,
				totalSeasons: null,
				totalEpisodes: null,
				providerRating: null,
				productionStatus: null,
			},
		});

		const createResult = await apiClient.run((c) =>
			c.events.create({
				payload: [
					{
						entityId: entity.id,
						properties: { progressPercent: 50 },
						eventSchemaId: droppedEventSchema.id,
					},
					{
						entityId: entity.id,
						properties: { progressPercent: 75 },
						eventSchemaId: onHoldEventSchema.id,
					},
				],
			}),
		);

		expect(createResult.count).toBe(2);

		const events = await waitForEventCount(apiClient, entity.id, 2);
		expect(events).toHaveLength(2);
		expect(sortBy(events.map((event) => event.eventSchemaSlug))).toEqual(["dropped", "on_hold"]);
		const sortedEvents = sortBy(events, (event) => event.eventSchemaSlug);
		expect(sortedEvents.map((event) => event.properties)).toEqual([
			{ progressPercent: 50 },
			{ progressPercent: 75 },
		]);
	});
});
