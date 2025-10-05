import { describe, expect, it } from "bun:test";

import { sortBy } from "@ryot/ts-utils/lodash";

import {
	createAuthenticatedClient,
	createBuiltinMediaLifecycleFixture,
	createEventTestFixture,
	createRuleEventFixture,
	waitForEventCount,
} from "../fixtures";
import { assertTaggedError, requireNumber, requireObjectRecord } from "../test-support/assertions";

const getProgressPercent = (properties: unknown) =>
	requireNumber(
		requireObjectRecord(properties, "Expected event properties to be an object").progressPercent,
		"Expected progressPercent to be a number",
	);

describe("Events bulk POST", () => {
	it("creates multiple events and returns the count", async () => {
		const { client: apiClient, cookies } = await createAuthenticatedClient();
		const { entityId, eventSchemaId } = await createEventTestFixture(apiClient, cookies);

		const result = await apiClient.run(
			(c) =>
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
			{ Cookie: cookies },
		);

		expect(result.count).toBe(3);
	});

	it("returns zero count for an empty array", async () => {
		const { client: apiClient, cookies } = await createAuthenticatedClient();

		const result = await apiClient.run((c) => c.events.create({ payload: [] }), {
			Cookie: cookies,
		});

		expect(result.count).toBe(0);
	});

	it("enforces conditional required rules end to end", async () => {
		const { client: apiClient, cookies } = await createAuthenticatedClient();
		const { entityId, eventSchemaId } = await createRuleEventFixture(apiClient, cookies);

		const optionalResult = await apiClient.run(
			(c) =>
				c.events.create({
					payload: [{ entityId, eventSchemaId, properties: { status: "draft" } }],
				}),
			{ Cookie: cookies },
		);
		expect(optionalResult.count).toBe(1);

		const rejectedError = await apiClient.runError(
			(c) =>
				c.events.create({
					payload: [{ entityId, eventSchemaId, properties: { status: "completed" } }],
				}),
			{ Cookie: cookies },
		);
		assertTaggedError(rejectedError, "BadRequest");

		const acceptedResult = await apiClient.run(
			(c) =>
				c.events.create({
					payload: [
						{
							entityId,
							eventSchemaId,
							properties: { status: "completed", progressPercent: 75 },
						},
					],
				}),
			{ Cookie: cookies },
		);
		expect(acceptedResult.count).toBe(1);

		const events = await waitForEventCount(apiClient, cookies, entityId, 2);
		expect(events.map((event) => event.properties)).toEqual([
			{ progressPercent: 75, status: "completed" },
			{ status: "draft" },
		]);
	});

	it("returns 404 when listing events for a non-existent entity", async () => {
		const { client: apiClient, cookies } = await createAuthenticatedClient();

		const error = await apiClient.runError(
			(c) => c.events.list({ urlParams: { entityId: crypto.randomUUID() } }),
			{ Cookie: cookies },
		);

		assertTaggedError(error, "NotFound");
	});

	it("persists events and they appear in the list", async () => {
		const { client: apiClient, cookies } = await createAuthenticatedClient();
		const { entityId, eventSchemaId } = await createEventTestFixture(apiClient, cookies);

		await apiClient.run(
			(c) =>
				c.events.create({
					payload: [
						{ entityId, eventSchemaId, properties: { rating: 4 } },
						{ entityId, eventSchemaId, properties: { rating: 5 } },
					],
				}),
			{ Cookie: cookies },
		);

		const events = await waitForEventCount(apiClient, cookies, entityId, 2);
		expect(events.length).toBe(2);
	});

	it("filters listed events by event schema slug", async () => {
		const { cookies, client: apiClient } = await createAuthenticatedClient();
		const { entityId, completeEventSchemaId, progressEventSchemaId } =
			await createBuiltinMediaLifecycleFixture(apiClient, cookies);

		const createResult = await apiClient.run(
			(c) =>
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
			{ Cookie: cookies },
		);

		expect(createResult.count).toBe(2);

		await waitForEventCount(apiClient, cookies, entityId, 2);

		const allEvents = await apiClient.run((c) => c.events.list({ urlParams: { entityId } }), {
			Cookie: cookies,
		});
		expect(allEvents).toHaveLength(2);

		const progressEvents = await apiClient.run(
			(c) => c.events.list({ urlParams: { entityId, eventSchemaSlug: "progress" } }),
			{ Cookie: cookies },
		);
		expect(progressEvents.map((event) => event.eventSchemaSlug)).toEqual(["progress"]);

		const completeEvents = await apiClient.run(
			(c) => c.events.list({ urlParams: { entityId, eventSchemaSlug: "complete" } }),
			{ Cookie: cookies },
		);
		expect(completeEvents.map((event) => event.eventSchemaSlug)).toEqual(["complete"]);

		const missingEvents = await apiClient.run(
			(c) => c.events.list({ urlParams: { entityId, eventSchemaSlug: "nonexistent" } }),
			{ Cookie: cookies },
		);
		expect(missingEvents).toEqual([]);
	});

	it("creates repeated built-in backlog events and lists them", async () => {
		const { cookies, client: apiClient } = await createAuthenticatedClient();
		const { entityId, backlogEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			apiClient,
			cookies,
		);

		const createResult = await apiClient.run(
			(c) =>
				c.events.create({
					payload: [
						{ entityId, properties: {}, eventSchemaId: backlogEventSchemaId },
						{ entityId, properties: {}, eventSchemaId: backlogEventSchemaId },
					],
				}),
			{ Cookie: cookies },
		);

		expect(createResult.count).toBe(2);

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

		const createResult = await apiClient.run(
			(c) =>
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
			{ Cookie: cookies },
		);

		expect(createResult.count).toBe(2);

		const events = await waitForEventCount(apiClient, cookies, entityId, 2);
		expect(events).toHaveLength(2);
		expect(events.map((event) => event.eventSchemaSlug)).toEqual(["progress", "progress"]);
		expect(sortBy(events.map((event) => getProgressPercent(event.properties)))).toEqual([
			25.56, 50.44,
		]);
	});

	it("creates repeated built-in complete events without relying on progress", async () => {
		const { cookies, client: apiClient } = await createAuthenticatedClient();
		const { entityId, completeEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			apiClient,
			cookies,
		);

		const createResult = await apiClient.run(
			(c) =>
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
			{ Cookie: cookies },
		);

		expect(createResult.count).toBe(2);

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

	it("persists timeSpent on a complete event and returns it", async () => {
		const { cookies, client: apiClient } = await createAuthenticatedClient();
		const { entityId, completeEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			apiClient,
			cookies,
		);

		const createResult = await apiClient.run(
			(c) =>
				c.events.create({
					payload: [
						{
							entityId,
							eventSchemaId: completeEventSchemaId,
							properties: { completionMode: "just_now", timeSpent: 120 },
						},
					],
				}),
			{ Cookie: cookies },
		);

		expect(createResult.count).toBe(1);

		const events = await waitForEventCount(apiClient, cookies, entityId, 1);
		expect(events).toHaveLength(1);
		expect(events[0]?.eventSchemaSlug).toBe("complete");
		expect(events[0]?.properties).toMatchObject({ completionMode: "just_now", timeSpent: 120 });
	});

	it("accepts a complete event without timeSpent (optional field)", async () => {
		const { cookies, client: apiClient } = await createAuthenticatedClient();
		const { entityId, completeEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			apiClient,
			cookies,
		);

		const createResult = await apiClient.run(
			(c) =>
				c.events.create({
					payload: [
						{
							entityId,
							eventSchemaId: completeEventSchemaId,
							properties: { completionMode: "unknown" },
						},
					],
				}),
			{ Cookie: cookies },
		);

		expect(createResult.count).toBe(1);
	});

	it("rejects a complete event with a negative timeSpent", async () => {
		const { cookies, client: apiClient } = await createAuthenticatedClient();
		const { entityId, completeEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			apiClient,
			cookies,
		);

		const error = await apiClient.runError(
			(c) =>
				c.events.create({
					payload: [
						{
							entityId,
							eventSchemaId: completeEventSchemaId,
							properties: { completionMode: "just_now", timeSpent: -10 },
						},
					],
				}),
			{ Cookie: cookies },
		);

		assertTaggedError(error, "BadRequest");
	});

	it("creates repeated built-in review events before completion exists", async () => {
		const { cookies, client: apiClient } = await createAuthenticatedClient();
		const { entityId, reviewEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			apiClient,
			cookies,
		);

		const createResult = await apiClient.run(
			(c) =>
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
			{ Cookie: cookies },
		);

		expect(createResult.count).toBe(2);

		const events = await waitForEventCount(apiClient, cookies, entityId, 2);
		expect(events).toHaveLength(2);
		expect(events.map((event) => event.eventSchemaSlug)).toEqual(["review", "review"]);
		expect(events.map((event) => event.properties)).toEqual([
			{ text: "Even better", rating: 5 },
			{ rating: 4 },
		]);
	});

	it("persists timeSpent on a dropped event and returns it", async () => {
		const { cookies, client: apiClient } = await createAuthenticatedClient();
		const { entityId, droppedEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			apiClient,
			cookies,
		);

		const createResult = await apiClient.run(
			(c) =>
				c.events.create({
					payload: [
						{
							entityId,
							eventSchemaId: droppedEventSchemaId,
							properties: { progressPercent: 40, timeSpent: 90 },
						},
					],
				}),
			{ Cookie: cookies },
		);

		expect(createResult.count).toBe(1);

		const events = await waitForEventCount(apiClient, cookies, entityId, 1);
		expect(events[0]?.eventSchemaSlug).toBe("dropped");
		expect(events[0]?.properties).toMatchObject({ progressPercent: 40, timeSpent: 90 });
	});

	it("persists timeSpent on an on_hold event and returns it", async () => {
		const { cookies, client: apiClient } = await createAuthenticatedClient();
		const { entityId, onHoldEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			apiClient,
			cookies,
		);

		const createResult = await apiClient.run(
			(c) =>
				c.events.create({
					payload: [
						{
							entityId,
							eventSchemaId: onHoldEventSchemaId,
							properties: { progressPercent: 60, timeSpent: 45 },
						},
					],
				}),
			{ Cookie: cookies },
		);

		expect(createResult.count).toBe(1);

		const events = await waitForEventCount(apiClient, cookies, entityId, 1);
		expect(events[0]?.eventSchemaSlug).toBe("on_hold");
		expect(events[0]?.properties).toMatchObject({ progressPercent: 60, timeSpent: 45 });
	});

	it("rejects a dropped event with a negative timeSpent", async () => {
		const { cookies, client: apiClient } = await createAuthenticatedClient();
		const { entityId, droppedEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			apiClient,
			cookies,
		);

		const error = await apiClient.runError(
			(c) =>
				c.events.create({
					payload: [
						{
							entityId,
							eventSchemaId: droppedEventSchemaId,
							properties: { progressPercent: 50, timeSpent: -5 },
						},
					],
				}),
			{ Cookie: cookies },
		);

		assertTaggedError(error, "BadRequest");
	});

	it("creates built-in dropped events with rounded progress values", async () => {
		const { cookies, client: apiClient } = await createAuthenticatedClient();
		const { entityId, droppedEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			apiClient,
			cookies,
		);

		const createResult = await apiClient.run(
			(c) =>
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
			{ Cookie: cookies },
		);

		expect(createResult.count).toBe(2);

		const events = await waitForEventCount(apiClient, cookies, entityId, 2);
		expect(events).toHaveLength(2);
		expect(events.map((event) => event.eventSchemaSlug)).toEqual(["dropped", "dropped"]);
		expect(sortBy(events.map((event) => getProgressPercent(event.properties)))).toEqual([
			33.33, 66.67,
		]);
	});

	it("creates built-in on_hold events with rounded progress values", async () => {
		const { cookies, client: apiClient } = await createAuthenticatedClient();
		const { entityId, onHoldEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			apiClient,
			cookies,
		);

		const createResult = await apiClient.run(
			(c) =>
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
			{ Cookie: cookies },
		);

		expect(createResult.count).toBe(2);

		const events = await waitForEventCount(apiClient, cookies, entityId, 2);
		expect(events).toHaveLength(2);
		expect(events.map((event) => event.eventSchemaSlug)).toEqual(["on_hold", "on_hold"]);
		expect(sortBy(events.map((event) => getProgressPercent(event.properties)))).toEqual([
			45.56, 75.44,
		]);
	});

	it("creates dropped and on_hold events with episodic media fields for shows", async () => {
		const { cookies, client: apiClient } = await createAuthenticatedClient();
		const { entityId, droppedEventSchemaId, onHoldEventSchemaId } =
			await createBuiltinMediaLifecycleFixture(apiClient, cookies, {
				entitySchemaSlug: "show",
			});

		const createResult = await apiClient.run(
			(c) =>
				c.events.create({
					payload: [
						{
							entityId,
							eventSchemaId: droppedEventSchemaId,
							properties: { progressPercent: 50, showSeason: 2, showEpisode: 5 },
						},
						{
							entityId,
							eventSchemaId: onHoldEventSchemaId,
							properties: { progressPercent: 75, showSeason: 3, showEpisode: 10 },
						},
					],
				}),
			{ Cookie: cookies },
		);

		expect(createResult.count).toBe(2);

		const events = await waitForEventCount(apiClient, cookies, entityId, 2);
		expect(events).toHaveLength(2);
		expect(sortBy(events.map((event) => event.eventSchemaSlug))).toEqual(["dropped", "on_hold"]);
		const sortedEvents = sortBy(events, (event) => event.eventSchemaSlug);
		expect(sortedEvents.map((event) => event.properties)).toEqual([
			{ progressPercent: 50, showSeason: 2, showEpisode: 5 },
			{ progressPercent: 75, showSeason: 3, showEpisode: 10 },
		]);
	});
});
