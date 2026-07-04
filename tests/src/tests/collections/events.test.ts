import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createCollection,
	createTrackerWithSchemaAndEntity,
	listEventsForEntity,
	waitForEventWithSchema,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("collection events", () => {
	it.live("add-entity-to-collection event is created on first add with correct properties", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const collection = yield* createCollection(client, { name: "Event Test Collection" });
			const { entityId } = yield* createTrackerWithSchemaAndEntity(client);

			const addData = yield* client.call((c) =>
				c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
			);

			const relationshipId = addData.memberOf.id;
			yield* waitForEventWithSchema(client, collection.id, "add-entity-to-collection");

			const events = yield* listEventsForEntity(client, collection.id);
			const addEvents = events.filter((e) => e.eventSchemaSlug === "add-entity-to-collection");

			expect(addEvents).toHaveLength(1);
			expect(addEvents[0]?.properties).toMatchObject({
				entityId,
				relationshipId,
			});
			expect(addEvents[0]?.properties.entitySchemaSlug).toBeDefined();
		}),
	);

	it.live("second add to same collection (upsert) does not create a second event", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const collection = yield* createCollection(client, { name: "Upsert Event Collection" });
			const { entityId } = yield* createTrackerWithSchemaAndEntity(client);

			yield* client.call((c) =>
				c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
			);

			yield* client.call((c) =>
				c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
			);

			yield* waitForEventWithSchema(client, collection.id, "add-entity-to-collection");

			const events = yield* listEventsForEntity(client, collection.id);
			const addEvents = events.filter((e) => e.eventSchemaSlug === "add-entity-to-collection");

			expect(addEvents).toHaveLength(1);
		}),
	);

	it.live("remove-entity-from-collection event is created on remove with correct properties", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const collection = yield* createCollection(client, { name: "Remove Event Collection" });
			const { entityId } = yield* createTrackerWithSchemaAndEntity(client);

			const addData = yield* client.call((c) =>
				c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
			);
			const relationshipId = addData.memberOf.id;

			yield* client.call((c) =>
				c.collections.deleteMembership({ payload: { entityId, collectionId: collection.id } }),
			);

			yield* waitForEventWithSchema(client, collection.id, "remove-entity-from-collection");

			const events = yield* listEventsForEntity(client, collection.id);
			const removeEvents = events.filter(
				(e) => e.eventSchemaSlug === "remove-entity-from-collection",
			);

			expect(removeEvents).toHaveLength(1);
			expect(removeEvents[0]?.properties).toMatchObject({
				entityId,
				relationshipId,
			});
			expect(removeEvents[0]?.properties.entitySchemaSlug).toBeDefined();
		}),
	);

	it.live("removing an entity not in the collection does not create a remove event", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const collection = yield* createCollection(client, {
				name: "No Remove Event Collection",
			});
			const { entityId } = yield* createTrackerWithSchemaAndEntity(client);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.collections.deleteMembership({ payload: { entityId, collectionId: collection.id } }),
				),
			);

			assertTaggedError(error, "NotFound");

			const events = yield* listEventsForEntity(client, collection.id);
			const removeEvents = events.filter(
				(e) => e.eventSchemaSlug === "remove-entity-from-collection",
			);

			expect(removeEvents).toHaveLength(0);
		}),
	);
});
