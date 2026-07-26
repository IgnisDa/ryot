import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	createEventTestFixture,
	createGlobalBookEntityFixture,
	findBuiltinSchemaBySlug,
	listEventSchemas,
	requireEventSchemaBySlug,
	queryInLibraryRelationship,
	waitForEventCount,
} from "~/fixtures";
import { describe, expect, it } from "~/support/effect-test";

describe("POST /events with global entities", () => {
	it.live("creates the event and upserts in_library for the user", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { entity, schema } = yield* createGlobalBookEntityFixture(client);

			const eventSchemas = yield* listEventSchemas(client, schema.id);
			const backlogEventSchema = requireEventSchemaBySlug(eventSchemas, "backlog");

			const createResult = yield* client.call((c) =>
				c.events.create({
					payload: [
						{ properties: {}, entityId: entity.id, eventSchemaSlug: backlogEventSchema.id },
					],
				}),
			);
			const membership = yield* queryInLibraryRelationship(client, entity.id, schema.slug);

			expect(createResult.count).toBe(1);
			expect(
				membership.data.entity?.type === "rows" ? membership.data.entity.items : [],
			).toHaveLength(1);

			const events = yield* waitForEventCount(client, entity.id, 1);
			expect(events).toHaveLength(1);
			expect(events[0]?.eventSchemaSlug).toBe("backlog");
		}),
	);
});

describe("media membership event exclusions", () => {
	it.live("does not add fitness entities to the media library", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(client, "exercise");
			const eventSchemas = yield* listEventSchemas(client, schema.id);
			const reviewEventSchema = requireEventSchemaBySlug(eventSchemas, "review");
			const entity = yield* createEntity(client, {
				name: "Event exercise",
				entitySchemaSlug: schema.id,
				properties: { muscles: [] },
			});

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

			const membership = yield* queryInLibraryRelationship(client, entity.id, schema.slug);
			expect(membership.data.entity?.type === "rows" ? membership.data.entity.items : []).toEqual(
				[],
			);
		}),
	);

	it.live("does not add unrelated fixture entities to the media library", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { entityId, entitySchemaSlug, eventSchemaSlug } = yield* createEventTestFixture(client);

			const result = yield* client.call((c) =>
				c.events.create({ payload: [{ entityId, eventSchemaSlug, properties: { rating: 4 } }] }),
			);
			expect(result.count).toBe(1);
			yield* waitForEventCount(client, entityId, 1);

			const membership = yield* queryInLibraryRelationship(client, entityId, entitySchemaSlug);
			expect(membership.data.entity?.type === "rows" ? membership.data.entity.items : []).toEqual(
				[],
			);
		}),
	);
});
