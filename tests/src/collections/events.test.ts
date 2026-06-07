import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createCollection,
	createTrackerWithSchemaAndEntity,
	listEventsForEntity,
	waitForEventWithSchema,
} from "../fixtures";
import { assertTaggedError } from "../test-support/assertions";

describe("collection events", () => {
	it("add-entity-to-collection event is created on first add with correct properties", async () => {
		const { client } = await createAuthenticatedClient();

		const collection = await createCollection(client, { name: "Event Test Collection" });
		const { entityId } = await createTrackerWithSchemaAndEntity(client);

		const addData = await client.run((c) =>
			c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
		);

		const relationshipId = addData.memberOf.id;
		await waitForEventWithSchema(client, collection.id, "add-entity-to-collection");

		const events = await listEventsForEntity(client, collection.id);
		const addEvents = events.filter((e) => e.eventSchemaSlug === "add-entity-to-collection");

		expect(addEvents).toHaveLength(1);
		expect(addEvents[0]?.properties).toMatchObject({
			entityId,
			relationshipId,
		});
		expect(addEvents[0]?.properties.entitySchemaSlug).toBeDefined();
	});

	it("second add to same collection (upsert) does not create a second event", async () => {
		const { client } = await createAuthenticatedClient();

		const collection = await createCollection(client, { name: "Upsert Event Collection" });
		const { entityId } = await createTrackerWithSchemaAndEntity(client);

		await client.run((c) =>
			c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
		);

		await client.run((c) =>
			c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
		);

		await waitForEventWithSchema(client, collection.id, "add-entity-to-collection");

		const events = await listEventsForEntity(client, collection.id);
		const addEvents = events.filter((e) => e.eventSchemaSlug === "add-entity-to-collection");

		expect(addEvents).toHaveLength(1);
	});

	it("remove-entity-from-collection event is created on remove with correct properties", async () => {
		const { client } = await createAuthenticatedClient();

		const collection = await createCollection(client, { name: "Remove Event Collection" });
		const { entityId } = await createTrackerWithSchemaAndEntity(client);

		const addData = await client.run((c) =>
			c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
		);
		const relationshipId = addData.memberOf.id;

		await client.run((c) =>
			c.collections.deleteMembership({ payload: { entityId, collectionId: collection.id } }),
		);

		await waitForEventWithSchema(client, collection.id, "remove-entity-from-collection");

		const events = await listEventsForEntity(client, collection.id);
		const removeEvents = events.filter(
			(e) => e.eventSchemaSlug === "remove-entity-from-collection",
		);

		expect(removeEvents).toHaveLength(1);
		expect(removeEvents[0]?.properties).toMatchObject({
			entityId,
			relationshipId,
		});
		expect(removeEvents[0]?.properties.entitySchemaSlug).toBeDefined();
	});

	it("removing an entity not in the collection does not create a remove event", async () => {
		const { client } = await createAuthenticatedClient();

		const collection = await createCollection(client, {
			name: "No Remove Event Collection",
		});
		const { entityId } = await createTrackerWithSchemaAndEntity(client);

		const error = await client.runError((c) =>
			c.collections.deleteMembership({ payload: { entityId, collectionId: collection.id } }),
		);

		assertTaggedError(error, "NotFound");

		const events = await listEventsForEntity(client, collection.id);
		const removeEvents = events.filter(
			(e) => e.eventSchemaSlug === "remove-entity-from-collection",
		);

		expect(removeEvents).toHaveLength(0);
	});
});
