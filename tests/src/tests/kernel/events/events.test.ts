import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createBuiltinMediaLifecycleFixture,
	createEventTestFixture,
	createRuleEventFixture,
	listEventsForEntity,
	waitForEventCount,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("Events bulk POST", () => {
	it.live("requires a scope when listing events", () =>
		Effect.gen(function* () {
			const { client: apiClient } = yield* createAuthenticatedClient();

			const error = yield* Effect.flip(apiClient.call((c) => c.events.list({ query: {} })));

			assertTaggedError(error, "BadRequest");
		}),
	);

	it.live("creates multiple events and returns the count", () =>
		Effect.gen(function* () {
			const { client: apiClient } = yield* createAuthenticatedClient();
			const { entityId, eventSchemaSlug } = yield* createEventTestFixture(apiClient);

			const result = yield* apiClient.call((c) =>
				c.events.create({
					payload: [
						{
							entityId,
							eventSchemaSlug,
							properties: { rating: 4 },
						},
						{
							entityId,
							eventSchemaSlug,
							properties: { rating: 5 },
						},
						{
							entityId,
							eventSchemaSlug,
							properties: { rating: 3 },
						},
					],
				}),
			);

			expect(result.count).toBe(3);
		}),
	);

	it.live("returns zero count for an empty array", () =>
		Effect.gen(function* () {
			const { client: apiClient } = yield* createAuthenticatedClient();

			const result = yield* apiClient.call((c) => c.events.create({ payload: [] }));

			expect(result.count).toBe(0);
		}),
	);

	it.live("enforces conditional required rules end to end", () =>
		Effect.gen(function* () {
			const { client: apiClient } = yield* createAuthenticatedClient();
			const { entityId, eventSchemaSlug } = yield* createRuleEventFixture(apiClient);

			const optionalResult = yield* apiClient.call((c) =>
				c.events.create({
					payload: [{ entityId, eventSchemaSlug, properties: { status: "draft" } }],
				}),
			);
			expect(optionalResult.count).toBe(1);

			const rejectedResult = yield* apiClient.call((c) =>
				c.events.create({
					payload: [{ entityId, eventSchemaSlug, properties: { status: "completed" } }],
				}),
			);
			expect(rejectedResult).toMatchObject({
				count: 0,
				outcomes: [],
				failure: { index: 0, reason: { kind: "bad_request" } },
			});

			const acceptedResult = yield* apiClient.call((c) =>
				c.events.create({
					payload: [
						{
							entityId,
							eventSchemaSlug,
							properties: { status: "completed", progressPercent: 75 },
						},
					],
				}),
			);
			expect(acceptedResult.count).toBe(1);

			const events = yield* waitForEventCount(apiClient, entityId, 2);
			expect(events.map((event) => event.properties)).toEqual([
				{ progressPercent: 75, status: "completed" },
				{ status: "draft" },
			]);
		}),
	);

	it.live("persists events and they appear in the list", () =>
		Effect.gen(function* () {
			const { client: apiClient } = yield* createAuthenticatedClient();
			const { entityId, eventSchemaSlug } = yield* createEventTestFixture(apiClient);

			yield* apiClient.call((c) =>
				c.events.create({
					payload: [
						{ entityId, eventSchemaSlug, properties: { rating: 4 } },
						{ entityId, eventSchemaSlug, properties: { rating: 5 } },
					],
				}),
			);

			const events = yield* waitForEventCount(apiClient, entityId, 2);
			expect(events.length).toBe(2);
		}),
	);

	it.live("filters listed events by event schema slug", () =>
		Effect.gen(function* () {
			const { client: apiClient } = yield* createAuthenticatedClient();
			const { entityId, completeEventSchemaSlug, progressEventSchemaSlug } =
				yield* createBuiltinMediaLifecycleFixture(apiClient);

			const createResult = yield* apiClient.call((c) =>
				c.events.create({
					payload: [
						{
							entityId,
							eventSchemaSlug: progressEventSchemaSlug,
							properties: { progressPercent: 25 },
						},
						{
							entityId,
							eventSchemaSlug: completeEventSchemaSlug,
							properties: { completionMode: "just_now" },
						},
					],
				}),
			);

			expect(createResult.count).toBe(2);

			yield* waitForEventCount(apiClient, entityId, 2);

			const allEvents = yield* listEventsForEntity(apiClient, entityId);
			expect(allEvents).toHaveLength(2);

			const progressEvents = yield* listEventsForEntity(apiClient, entityId, {
				eventSchemaSlug: "progress",
			});
			expect(progressEvents.map((event) => event.eventSchemaSlug)).toEqual(["progress"]);

			const completeEvents = yield* listEventsForEntity(apiClient, entityId, {
				eventSchemaSlug: "complete",
			});
			expect(completeEvents.map((event) => event.eventSchemaSlug)).toEqual(["complete"]);

			const missingEvents = yield* listEventsForEntity(apiClient, entityId, {
				eventSchemaSlug: "nonexistent",
			});
			expect(missingEvents).toEqual([]);
		}),
	);
});
