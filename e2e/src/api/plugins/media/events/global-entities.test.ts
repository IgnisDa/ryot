import { EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { anyOf, objectContaining } from "@ryot-app/testing/matchers";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEventTestFixture,
	listEventSchemas,
	requireEventSchemaBySlug,
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

			expect(createResult.count).toBe(1);
			expect(
				membership.data.entity?.type === "rows" ? membership.data.entity.items : [],
			).toHaveLength(1);

			const events = yield* waitForEventCount(client, entity.id, 2);
			expect(events).toHaveLength(2);
			expect(events.map(({ eventSchemaSlug }) => eventSchemaSlug)).toEqual([
				EventSchemaSlug.make("add-to-media-library"),
				EventSchemaSlug.make("backlog"),
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
						{ entityId: entity.id, eventSchemaSlug: complete.id, properties: { timeSpent: -1 } },
						{ properties: {}, entityId: entity.id, eventSchemaSlug: backlog.id },
					],
				}),
			);
			expect(result).toEqual<unknown>(
				objectContaining({
					count: 2,
					failure: objectContaining({
						index: 1,
						reason: objectContaining({ code: "invalid-properties" }),
					}),
					outcomes: [
						objectContaining({ index: 0, status: "written", eventId: anyOf(String) }),
						objectContaining({
							index: 1,
							status: "failed",
							reason: objectContaining({ code: "invalid-properties" }),
						}),
						objectContaining({ index: 2, status: "written", eventId: anyOf(String) }),
					],
				}),
			);
			const membership = yield* queryInMediaLibraryRelationship(client, entity.id, schema.slug);
			expect(
				membership.data.entity?.type === "rows" ? membership.data.entity.items : [],
			).toHaveLength(1);
			const events = yield* waitForEventCount(client, entity.id, 3);
			expect(events.map(({ eventSchemaSlug }) => eventSchemaSlug).sort()).toEqual([
				EventSchemaSlug.make("add-to-media-library"),
				EventSchemaSlug.make("backlog"),
				EventSchemaSlug.make("backlog"),
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
			expect(result.count).toBe(1);
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
			expect(result.count).toBe(1);
			yield* waitForEventCount(client, entityId, 1);

			const membership = yield* queryInMediaLibraryRelationship(client, entityId, entitySchemaSlug);
			expect(membership.data.entity?.type === "rows" ? membership.data.entity.items : []).toEqual(
				[],
			);
		}),
	);
});
