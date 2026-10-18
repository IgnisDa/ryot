import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEventTestFixture,
	listEventSchemas,
	requireEventSchemaBySlug,
	waitForCreateEvents,
	waitForEventCount,
} from "~/fixtures/kernel";
import { createExerciseEntityFixture, findFitnessEntitySchema } from "~/fixtures/plugins/fitness";
import {
	createGlobalBookEntityFixture,
	queryInMediaLibraryRelationship,
} from "~/fixtures/plugins/media";
import { describe, expect, it } from "~/support/effect-test";

describe("POST /events with global entities", () => {
	it.live("creates the event and upserts in_library for the user", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { entity, schema } = yield* createGlobalBookEntityFixture(client);

			const eventSchemas = yield* listEventSchemas(client, schema.reference);
			const backlogEventSchema = requireEventSchemaBySlug(eventSchemas, "backlog");

			const createResult = yield* client.call((c) =>
				c.events.create({
					payload: [
						{ properties: {}, entityId: entity.id, eventSchemaSlug: backlogEventSchema.id },
					],
				}),
			);
			const membership = yield* queryInMediaLibraryRelationship(client, entity.id, schema.slug);

			expect((yield* waitForCreateEvents(client, createResult)).count).toBe(1);
			expect(
				membership.data.entity?.type === "rows" ? membership.data.entity.items : [],
			).toHaveLength(1);

			const events = yield* waitForEventCount(client, entity.id, 2);
			expect(events).toHaveLength(2);
			expect(events.map(({ eventSchemaSlug }) => eventSchemaSlug)).toEqual([
				"add-to-media-library",
				"backlog",
			]);
		}),
	);

	it.live("writes valid events around a failing event and upserts membership once", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { entity, schema } = yield* createGlobalBookEntityFixture(client);
			const eventSchemas = yield* listEventSchemas(client, schema.reference);
			const backlog = requireEventSchemaBySlug(eventSchemas, "backlog");
			const complete = requireEventSchemaBySlug(eventSchemas, "complete");

			const result = yield* client.call((c) =>
				c.events.create({
					payload: [
						{ properties: {}, entityId: entity.id, eventSchemaSlug: backlog.id },
						{ properties: {}, entityId: entity.id, eventSchemaSlug: complete.id },
						{ properties: {}, entityId: entity.id, eventSchemaSlug: backlog.id },
					],
				}),
			);
			expect(yield* waitForCreateEvents(client, result)).toMatchObject({
				count: 2,
				failure: { index: 1, reason: { code: "invalid-properties" } },
				outcomes: [
					{ index: 0, status: "written", eventId: expect.any(String) },
					{ index: 1, status: "failed", reason: { code: "invalid-properties" } },
					{ index: 2, status: "written", eventId: expect.any(String) },
				],
			});
			const membership = yield* queryInMediaLibraryRelationship(client, entity.id, schema.slug);
			expect(
				membership.data.entity?.type === "rows" ? membership.data.entity.items : [],
			).toHaveLength(1);
			const events = yield* waitForEventCount(client, entity.id, 3);
			expect(events.map(({ eventSchemaSlug }) => eventSchemaSlug).sort()).toEqual([
				"add-to-media-library",
				"backlog",
				"backlog",
			]);
		}),
	);
});

describe("media membership event exclusions", () => {
	it.live("does not add fitness entities to the media library", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findFitnessEntitySchema(client, "exercise");
			const eventSchemas = yield* listEventSchemas(client, schema.reference);
			const reviewEventSchema = requireEventSchemaBySlug(eventSchemas, "review");
			const { exercise: entity } = yield* createExerciseEntityFixture(client);

			const result = yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: entity.id,
							properties: { rating: 50 },
							eventSchemaSlug: reviewEventSchema.id,
						},
					],
				}),
			);
			expect((yield* waitForCreateEvents(client, result)).count).toBe(1);
			yield* waitForEventCount(client, entity.id, 1);

			const membership = yield* queryInMediaLibraryRelationship(client, entity.id, schema.slug);
			expect(membership.data.entity?.type === "rows" ? membership.data.entity.items : []).toEqual(
				[],
			);
		}),
	);

	it.live("does not add unrelated fixture entities to the media library", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { entityId, eventSchemaSlug, entitySchemaSlug } = yield* createEventTestFixture(client);

			const result = yield* client.call((c) =>
				c.events.create({ payload: [{ entityId, eventSchemaSlug, properties: { rating: 4 } }] }),
			);
			expect((yield* waitForCreateEvents(client, result)).count).toBe(1);
			yield* waitForEventCount(client, entityId, 1);

			const membership = yield* queryInMediaLibraryRelationship(client, entityId, entitySchemaSlug);
			expect(membership.data.entity?.type === "rows" ? membership.data.entity.items : []).toEqual(
				[],
			);
		}),
	);
});
