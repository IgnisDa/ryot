import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	listEventSchemas,
	requireEventSchemaBySlug,
	waitForCreateEvents,
	waitForEventCount,
} from "~/fixtures/kernel";
import {
	createBuiltinMediaLifecycleFixture,
	findMediaEntitySchema,
	seedMediaEntity,
} from "~/fixtures/plugins/media";
import { assertPresent, requireNumber, requireObjectRecord } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const getProgressPercent = (properties: unknown) =>
	requireNumber(
		requireObjectRecord(properties, "Expected event properties to be an object").progressPercent,
		"Expected progressPercent to be a number",
	);

describe("Events built-in status schemas", () => {
	it.live("creates repeated built-in backlog events and lists them", () =>
		Effect.gen(function* () {
			const { client: apiClient } = yield* createAuthenticatedClient();
			const { entityId, backlogEventSchemaSlug } =
				yield* createBuiltinMediaLifecycleFixture(apiClient);

			const createResult = yield* apiClient.call((c) =>
				c.events.create({
					payload: [
						{ entityId, properties: {}, eventSchemaSlug: backlogEventSchemaSlug },
						{ entityId, properties: {}, eventSchemaSlug: backlogEventSchemaSlug },
					],
				}),
			);

			expect((yield* waitForCreateEvents(apiClient, createResult)).count).toBe(2);

			const allEvents = yield* waitForEventCount(apiClient, entityId, 3);
			const events = allEvents.filter((event) => event.eventSchemaSlug === "backlog");
			expect(events).toHaveLength(2);
			expect(events.map((event) => event.eventSchemaSlug)).toEqual(["backlog", "backlog"]);
			expect(events.map((event) => event.properties)).toEqual([{}, {}]);
		}),
	);

	it.live(
		"creates built-in progress events with normalized values and no completion side effects",
		() =>
			Effect.gen(function* () {
				const { client: apiClient } = yield* createAuthenticatedClient();
				const { entityId, progressEventSchemaSlug } =
					yield* createBuiltinMediaLifecycleFixture(apiClient);

				const createResult = yield* apiClient.call((c) =>
					c.events.create({
						payload: [
							{
								entityId,
								properties: { progressPercent: 25.555 },
								eventSchemaSlug: progressEventSchemaSlug,
							},
							{
								entityId,
								properties: { progressPercent: 50.444 },
								eventSchemaSlug: progressEventSchemaSlug,
							},
						],
					}),
				);

				expect((yield* waitForCreateEvents(apiClient, createResult)).count).toBe(2);

				const allEvents = yield* waitForEventCount(apiClient, entityId, 3);
				expect(allEvents.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(0);
				const events = allEvents.filter((event) => event.eventSchemaSlug === "progress");
				expect(events).toHaveLength(2);
				expect(events.map((event) => event.eventSchemaSlug)).toEqual(["progress", "progress"]);
				expect(sortBy(events.map((event) => getProgressPercent(event.properties)))).toEqual([
					25.56, 50.44,
				]);
			}),
	);

	it.live("creates repeated built-in complete events without relying on progress", () =>
		Effect.gen(function* () {
			const { client: apiClient } = yield* createAuthenticatedClient();
			const { entityId, completeEventSchemaSlug } =
				yield* createBuiltinMediaLifecycleFixture(apiClient);

			const createResult = yield* apiClient.call((c) =>
				c.events.create({
					payload: [
						{ entityId, properties: {}, eventSchemaSlug: completeEventSchemaSlug },
						{
							entityId,
							properties: { dateUnknown: true },
							eventSchemaSlug: completeEventSchemaSlug,
						},
					],
				}),
			);

			expect((yield* waitForCreateEvents(apiClient, createResult)).count).toBe(2);

			const allEvents = yield* waitForEventCount(apiClient, entityId, 3);
			const events = allEvents.filter((event) => event.eventSchemaSlug === "complete");
			expect(events).toHaveLength(2);
			expect(events.map((event) => event.eventSchemaSlug)).toEqual(["complete", "complete"]);
			expect(events.map((event) => event.properties)).toEqual(
				expect.arrayContaining([{ dateUnknown: true }, {}]),
			);
		}),
	);

	it.live("persists timeSpent on a complete event and returns it", () =>
		Effect.gen(function* () {
			const { client: apiClient } = yield* createAuthenticatedClient();
			const { entityId, completeEventSchemaSlug } =
				yield* createBuiltinMediaLifecycleFixture(apiClient);

			const createResult = yield* apiClient.call((c) =>
				c.events.create({
					payload: [
						{ entityId, properties: { timeSpent: 120 }, eventSchemaSlug: completeEventSchemaSlug },
					],
				}),
			);

			expect((yield* waitForCreateEvents(apiClient, createResult)).count).toBe(1);

			const allEvents = yield* waitForEventCount(apiClient, entityId, 2);
			const events = allEvents.filter((event) => event.eventSchemaSlug === "complete");
			expect(events).toHaveLength(1);
			expect(events[0]?.eventSchemaSlug).toBe("complete");
			expect(events[0]?.properties).toMatchObject({ timeSpent: 120 });
		}),
	);

	it.live("accepts a complete event without timeSpent (optional field)", () =>
		Effect.gen(function* () {
			const { client: apiClient } = yield* createAuthenticatedClient();
			const { entityId, completeEventSchemaSlug } =
				yield* createBuiltinMediaLifecycleFixture(apiClient);

			const createResult = yield* apiClient.call((c) =>
				c.events.create({
					payload: [
						{
							entityId,
							properties: { dateUnknown: true },
							eventSchemaSlug: completeEventSchemaSlug,
						},
					],
				}),
			);

			expect((yield* waitForCreateEvents(apiClient, createResult)).count).toBe(1);
		}),
	);

	it.live("rejects a complete event with a negative timeSpent", () =>
		Effect.gen(function* () {
			const { client: apiClient } = yield* createAuthenticatedClient();
			const { entityId, completeEventSchemaSlug } =
				yield* createBuiltinMediaLifecycleFixture(apiClient);

			const result = yield* apiClient.call((c) =>
				c.events.create({
					payload: [
						{ entityId, properties: { timeSpent: -10 }, eventSchemaSlug: completeEventSchemaSlug },
					],
				}),
			);

			expect(result).toMatchObject({
				count: 0,
				failure: { index: 0, reason: { code: "invalid-properties" } },
				outcomes: [{ index: 0, status: "failed", reason: { code: "invalid-properties" } }],
			});
		}),
	);

	it.live("creates repeated built-in review events before completion exists", () =>
		Effect.gen(function* () {
			const { client: apiClient } = yield* createAuthenticatedClient();
			const { entityId, reviewEventSchemaSlug } =
				yield* createBuiltinMediaLifecycleFixture(apiClient);

			const createResult = yield* apiClient.call((c) =>
				c.events.create({
					payload: [
						{ entityId, properties: { rating: 4 }, eventSchemaSlug: reviewEventSchemaSlug },
						{
							entityId,
							eventSchemaSlug: reviewEventSchemaSlug,
							properties: { rating: 5, text: "Even better" },
						},
					],
				}),
			);

			expect((yield* waitForCreateEvents(apiClient, createResult)).count).toBe(2);

			const allEvents = yield* waitForEventCount(apiClient, entityId, 3);
			const events = allEvents.filter((event) => event.eventSchemaSlug === "review");
			expect(events).toHaveLength(2);
			expect(events.map((event) => event.eventSchemaSlug)).toEqual(["review", "review"]);
			expect(events.map((event) => event.properties)).toEqual(
				expect.arrayContaining([{ rating: 5, text: "Even better" }, { rating: 4 }]),
			);
		}),
	);

	it.live("persists timeSpent on a dropped event and returns it", () =>
		Effect.gen(function* () {
			const { client: apiClient } = yield* createAuthenticatedClient();
			const { entityId, droppedEventSchemaSlug } =
				yield* createBuiltinMediaLifecycleFixture(apiClient);

			const createResult = yield* apiClient.call((c) =>
				c.events.create({
					payload: [
						{
							entityId,
							eventSchemaSlug: droppedEventSchemaSlug,
							properties: { timeSpent: 90, progressPercent: 40 },
						},
					],
				}),
			);

			expect((yield* waitForCreateEvents(apiClient, createResult)).count).toBe(1);

			const allEvents = yield* waitForEventCount(apiClient, entityId, 2);
			const droppedEvent = allEvents.find((event) => event.eventSchemaSlug === "dropped");
			expect(droppedEvent?.eventSchemaSlug).toBe("dropped");
			expect(droppedEvent?.properties).toMatchObject({ timeSpent: 90, progressPercent: 40 });
		}),
	);

	it.live("persists timeSpent on an on_hold event and returns it", () =>
		Effect.gen(function* () {
			const { client: apiClient } = yield* createAuthenticatedClient();
			const { entityId, onHoldEventSchemaSlug } =
				yield* createBuiltinMediaLifecycleFixture(apiClient);

			const createResult = yield* apiClient.call((c) =>
				c.events.create({
					payload: [
						{
							entityId,
							eventSchemaSlug: onHoldEventSchemaSlug,
							properties: { timeSpent: 45, progressPercent: 60 },
						},
					],
				}),
			);

			expect((yield* waitForCreateEvents(apiClient, createResult)).count).toBe(1);

			const allEvents = yield* waitForEventCount(apiClient, entityId, 2);
			const onHoldEvent = allEvents.find((event) => event.eventSchemaSlug === "on_hold");
			expect(onHoldEvent?.eventSchemaSlug).toBe("on_hold");
			expect(onHoldEvent?.properties).toMatchObject({ timeSpent: 45, progressPercent: 60 });
		}),
	);

	it.live("accepts progress, dropped and on_hold events without progressPercent", () =>
		Effect.gen(function* () {
			const { client: apiClient } = yield* createAuthenticatedClient();
			const { entityId, onHoldEventSchemaSlug, droppedEventSchemaSlug, progressEventSchemaSlug } =
				yield* createBuiltinMediaLifecycleFixture(apiClient);

			const createResult = yield* apiClient.call((c) =>
				c.events.create({
					payload: [
						{ entityId, properties: {}, eventSchemaSlug: progressEventSchemaSlug },
						{ entityId, properties: {}, eventSchemaSlug: droppedEventSchemaSlug },
						{ entityId, properties: {}, eventSchemaSlug: onHoldEventSchemaSlug },
					],
				}),
			);

			expect((yield* waitForCreateEvents(apiClient, createResult)).count).toBe(3);
			const allEvents = yield* waitForEventCount(apiClient, entityId, 4);
			for (const slug of ["progress", "dropped", "on_hold"]) {
				const event = allEvents.find((candidate) => candidate.eventSchemaSlug === slug);
				expect(event?.properties).toEqual({});
			}
		}),
	);

	it.live("rejects a dropped event with a negative timeSpent", () =>
		Effect.gen(function* () {
			const { client: apiClient } = yield* createAuthenticatedClient();
			const { entityId, droppedEventSchemaSlug } =
				yield* createBuiltinMediaLifecycleFixture(apiClient);

			const result = yield* apiClient.call((c) =>
				c.events.create({
					payload: [
						{
							entityId,
							eventSchemaSlug: droppedEventSchemaSlug,
							properties: { timeSpent: -5, progressPercent: 50 },
						},
					],
				}),
			);

			expect(result).toMatchObject({
				count: 0,
				failure: { index: 0, reason: { code: "invalid-properties" } },
				outcomes: [{ index: 0, status: "failed", reason: { code: "invalid-properties" } }],
			});
		}),
	);

	it.live("creates built-in dropped events with rounded progress values", () =>
		Effect.gen(function* () {
			const { client: apiClient } = yield* createAuthenticatedClient();
			const { entityId, droppedEventSchemaSlug } =
				yield* createBuiltinMediaLifecycleFixture(apiClient);

			const createResult = yield* apiClient.call((c) =>
				c.events.create({
					payload: [
						{
							entityId,
							eventSchemaSlug: droppedEventSchemaSlug,
							properties: { progressPercent: 33.333 },
						},
						{
							entityId,
							eventSchemaSlug: droppedEventSchemaSlug,
							properties: { progressPercent: 66.666 },
						},
					],
				}),
			);

			expect((yield* waitForCreateEvents(apiClient, createResult)).count).toBe(2);

			const allEvents = yield* waitForEventCount(apiClient, entityId, 3);
			const events = allEvents.filter((event) => event.eventSchemaSlug === "dropped");
			expect(events).toHaveLength(2);
			expect(events.map((event) => event.eventSchemaSlug)).toEqual(["dropped", "dropped"]);
			expect(sortBy(events.map((event) => getProgressPercent(event.properties)))).toEqual([
				33.33, 66.67,
			]);
		}),
	);

	it.live("creates built-in on_hold events with rounded progress values", () =>
		Effect.gen(function* () {
			const { client: apiClient } = yield* createAuthenticatedClient();
			const { entityId, onHoldEventSchemaSlug } =
				yield* createBuiltinMediaLifecycleFixture(apiClient);

			const createResult = yield* apiClient.call((c) =>
				c.events.create({
					payload: [
						{
							entityId,
							eventSchemaSlug: onHoldEventSchemaSlug,
							properties: { progressPercent: 45.555 },
						},
						{
							entityId,
							eventSchemaSlug: onHoldEventSchemaSlug,
							properties: { progressPercent: 75.444 },
						},
					],
				}),
			);

			expect((yield* waitForCreateEvents(apiClient, createResult)).count).toBe(2);

			const allEvents = yield* waitForEventCount(apiClient, entityId, 3);
			const events = allEvents.filter((event) => event.eventSchemaSlug === "on_hold");
			expect(events).toHaveLength(2);
			expect(events.map((event) => event.eventSchemaSlug)).toEqual(["on_hold", "on_hold"]);
			expect(sortBy(events.map((event) => getProgressPercent(event.properties)))).toEqual([
				45.56, 75.44,
			]);
		}),
	);

	it.live("accepts dropped and on_hold events without progressPercent for shows", () =>
		Effect.gen(function* () {
			const { client: apiClient } = yield* createAuthenticatedClient();
			const { schema } = yield* findMediaEntitySchema(apiClient, "show");
			const eventSchemas = yield* listEventSchemas(apiClient, schema.reference);
			const droppedEventSchema = requireEventSchemaBySlug(eventSchemas, "dropped");
			const onHoldEventSchema = requireEventSchemaBySlug(eventSchemas, "on_hold");
			const providerId = schema.providers[0]?.providerId;
			assertPresent(providerId, "Expected a provider for the show schema");
			const entity = yield* seedMediaEntity({
				providerId,
				userId: null,
				entitySchemaSlug: schema.id,
				name: `Show Events ${crypto.randomUUID()}`,
				externalId: `show-events-${crypto.randomUUID()}`,
				properties: {
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

			const createResult = yield* apiClient.call((c) =>
				c.events.create({
					payload: [
						{ properties: {}, entityId: entity.id, eventSchemaSlug: droppedEventSchema.id },
						{ properties: {}, entityId: entity.id, eventSchemaSlug: onHoldEventSchema.id },
					],
				}),
			);

			expect((yield* waitForCreateEvents(apiClient, createResult)).count).toBe(2);

			const allEvents = yield* waitForEventCount(apiClient, entity.id, 3);
			const events = allEvents.filter((event) => event.eventSchemaSlug !== "add-to-media-library");
			expect(events).toHaveLength(2);
			expect(sortBy(events.map((event) => event.eventSchemaSlug))).toEqual(["dropped", "on_hold"]);
			const sortedEvents = sortBy(events, (event) => event.eventSchemaSlug);
			expect(sortedEvents.map((event) => event.properties)).toEqual([{}, {}]);
		}),
	);
});
