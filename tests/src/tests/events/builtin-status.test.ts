import { sortBy } from "@ryot/ts-utils/lodash";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createBuiltinMediaLifecycleFixture,
	findBuiltinSchemaBySlug,
	getFirstProviderScriptId,
	listEventSchemas,
	requireEventSchemaBySlug,
	seedMediaEntity,
	waitForEventCount,
} from "~/fixtures";
import { requireNumber, requireObjectRecord } from "~/support/assertions";
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

			expect(createResult.count).toBe(2);

			const events = yield* waitForEventCount(apiClient, entityId, 2);
			expect(events).toHaveLength(2);
			expect(events.map((event) => event.eventSchemaSlug)).toEqual(["backlog", "backlog"]);
			expect(events.map((event) => event.properties)).toEqual([{}, {}]);
		}),
	);

	it.live(
		"creates built-in progress events with rounded values and no completion side effects",
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
								eventSchemaSlug: progressEventSchemaSlug,
								properties: { progressPercent: 25.555 },
							},
							{
								entityId,
								eventSchemaSlug: progressEventSchemaSlug,
								properties: { progressPercent: 50.444 },
							},
						],
					}),
				);

				expect(createResult.count).toBe(2);

				const events = yield* waitForEventCount(apiClient, entityId, 2);
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
						{
							entityId,
							eventSchemaSlug: completeEventSchemaSlug,
							properties: { completionMode: "just_now" },
						},
						{
							entityId,
							eventSchemaSlug: completeEventSchemaSlug,
							properties: {
								completionMode: "custom_timestamps",
								completedOn: "2026-03-27T18:30:00Z",
							},
						},
					],
				}),
			);

			expect(createResult.count).toBe(2);

			const events = yield* waitForEventCount(apiClient, entityId, 2);
			expect(events).toHaveLength(2);
			expect(events.map((event) => event.eventSchemaSlug)).toEqual(["complete", "complete"]);
			expect(events.map((event) => event.properties)).toEqual([
				{
					completionMode: "custom_timestamps",
					completedOn: "2026-03-27T18:30:00Z",
				},
				{ completionMode: "just_now" },
			]);
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
						{
							entityId,
							eventSchemaSlug: completeEventSchemaSlug,
							properties: { completionMode: "just_now", timeSpent: 120 },
						},
					],
				}),
			);

			expect(createResult.count).toBe(1);

			const events = yield* waitForEventCount(apiClient, entityId, 1);
			expect(events).toHaveLength(1);
			expect(events[0]?.eventSchemaSlug).toBe("complete");
			expect(events[0]?.properties).toMatchObject({ completionMode: "just_now", timeSpent: 120 });
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
							eventSchemaSlug: completeEventSchemaSlug,
							properties: { completionMode: "unknown" },
						},
					],
				}),
			);

			expect(createResult.count).toBe(1);
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
						{
							entityId,
							eventSchemaSlug: completeEventSchemaSlug,
							properties: { completionMode: "just_now", timeSpent: -10 },
						},
					],
				}),
			);

			expect(result).toMatchObject({
				count: 0,
				outcomes: [],
				failure: { index: 0, reason: { kind: "bad_request" } },
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
						{
							entityId,
							properties: { rating: 4 },
							eventSchemaSlug: reviewEventSchemaSlug,
						},
						{
							entityId,
							eventSchemaSlug: reviewEventSchemaSlug,
							properties: { text: "Even better", rating: 5 },
						},
					],
				}),
			);

			expect(createResult.count).toBe(2);

			const events = yield* waitForEventCount(apiClient, entityId, 2);
			expect(events).toHaveLength(2);
			expect(events.map((event) => event.eventSchemaSlug)).toEqual(["review", "review"]);
			expect(events.map((event) => event.properties)).toEqual([
				{ text: "Even better", rating: 5 },
				{ rating: 4 },
			]);
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
							properties: { progressPercent: 40, timeSpent: 90 },
						},
					],
				}),
			);

			expect(createResult.count).toBe(1);

			const events = yield* waitForEventCount(apiClient, entityId, 1);
			expect(events[0]?.eventSchemaSlug).toBe("dropped");
			expect(events[0]?.properties).toMatchObject({ progressPercent: 40, timeSpent: 90 });
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
							properties: { progressPercent: 60, timeSpent: 45 },
						},
					],
				}),
			);

			expect(createResult.count).toBe(1);

			const events = yield* waitForEventCount(apiClient, entityId, 1);
			expect(events[0]?.eventSchemaSlug).toBe("on_hold");
			expect(events[0]?.properties).toMatchObject({ progressPercent: 60, timeSpent: 45 });
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
							properties: { progressPercent: 50, timeSpent: -5 },
						},
					],
				}),
			);

			expect(result).toMatchObject({
				count: 0,
				outcomes: [],
				failure: { index: 0, reason: { kind: "bad_request" } },
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

			expect(createResult.count).toBe(2);

			const events = yield* waitForEventCount(apiClient, entityId, 2);
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

			expect(createResult.count).toBe(2);

			const events = yield* waitForEventCount(apiClient, entityId, 2);
			expect(events).toHaveLength(2);
			expect(events.map((event) => event.eventSchemaSlug)).toEqual(["on_hold", "on_hold"]);
			expect(sortBy(events.map((event) => getProgressPercent(event.properties)))).toEqual([
				45.56, 75.44,
			]);
		}),
	);

	it.live("creates dropped and on_hold events without positional episode fields for shows", () =>
		Effect.gen(function* () {
			const { client: apiClient } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(apiClient, "show");
			const eventSchemas = yield* listEventSchemas(apiClient, schema.id);
			const droppedEventSchema = requireEventSchemaBySlug(eventSchemas, "dropped");
			const onHoldEventSchema = requireEventSchemaBySlug(eventSchemas, "on_hold");
			const entity = yield* seedMediaEntity({
				userId: null,
				entitySchemaSlug: schema.id,
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

			const createResult = yield* apiClient.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: entity.id,
							properties: { progressPercent: 50 },
							eventSchemaSlug: droppedEventSchema.id,
						},
						{
							entityId: entity.id,
							properties: { progressPercent: 75 },
							eventSchemaSlug: onHoldEventSchema.id,
						},
					],
				}),
			);

			expect(createResult.count).toBe(2);

			const events = yield* waitForEventCount(apiClient, entity.id, 2);
			expect(events).toHaveLength(2);
			expect(sortBy(events.map((event) => event.eventSchemaSlug))).toEqual(["dropped", "on_hold"]);
			const sortedEvents = sortBy(events, (event) => event.eventSchemaSlug);
			expect(sortedEvents.map((event) => event.properties)).toEqual([
				{ progressPercent: 50 },
				{ progressPercent: 75 },
			]);
		}),
	);
});
