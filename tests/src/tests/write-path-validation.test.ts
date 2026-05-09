import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createCollection,
	createEntity,
	createEventTestFixture,
	createTrackerWithSchema,
	createTrackerWithSchemaAndEntity,
	waitForEventCount,
} from "../fixtures";
import { getBackendUrl } from "../setup";
import { assertTaggedError } from "../test-support/assertions";

describe("Entity write path — propertiesSchema validation", () => {
	it("rejects entity creation when a required field is missing", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(client, {
			name: "Required Field Schema",
			propertiesSchema: {
				fields: {
					title: {
						label: "Title",
						type: "string" as const,
						description: "Title of the item",
						validation: { required: true as const },
					},
				},
			},
		});

		const error = await client.runError((c) =>
			c.entities.create({
				payload: { properties: {}, name: "Missing Required", entitySchemaId: schemaId },
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("title: is missing");
	});

	it("rejects entity creation when a field has the wrong type", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(client, {
			name: "Type Check Schema",
			propertiesSchema: {
				fields: {
					count: {
						label: "Count",
						type: "integer" as const,
						description: "An integer count",
						validation: { required: true as const },
					},
				},
			},
		});

		const error = await client.runError((c) =>
			c.entities.create({
				payload: {
					name: "Wrong Type",
					entitySchemaId: schemaId,
					properties: { count: "not-a-number" },
				},
			}),
		);

		assertTaggedError(error, "BadRequest");
	});

	it("ignores undeclared entity properties when the schema does not opt into strict unknown keys", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(client, {
			name: "Strict Schema",
			propertiesSchema: {
				fields: { title: { label: "Title", description: "Title", type: "string" as const } },
			},
		});

		const entity = await createEntity(client, {
			image: null,
			name: "Extra Field",
			entitySchemaId: schemaId,
			properties: { title: "OK", undeclaredField: "should fail" },
		});

		expect(entity.properties).toEqual({ title: "OK" });
	});

	it("accepts entity creation when properties match the schema exactly", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(client, {
			name: "Valid Schema",
			propertiesSchema: {
				fields: {
					rating: { label: "Rating", description: "Rating", type: "integer" as const },
					title: {
						label: "Title",
						description: "Title",
						type: "string" as const,
						validation: { required: true as const },
					},
				},
			},
		});

		const entity = await createEntity(client, {
			image: null,
			name: "Valid Entity",
			entitySchemaId: schemaId,
			properties: { title: "My Item", rating: 4 },
		});

		expect(entity.id).toBeDefined();
		expect(entity.properties).toMatchObject({ title: "My Item", rating: 4 });
	});
});

describe("Event write path — propertiesSchema validation", () => {
	it("rejects event creation when a required field is missing", async () => {
		const { client } = await createAuthenticatedClient();
		const { entityId, eventSchemaId } = await createEventTestFixture(client);

		const error = await client.runError((c) =>
			c.events.create({ payload: [{ entityId, eventSchemaId, properties: {} }] }),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("rating: is missing");
	});

	it("rejects event creation when a field has the wrong type", async () => {
		const { client } = await createAuthenticatedClient();
		const { entityId, eventSchemaId } = await createEventTestFixture(client);

		const error = await client.runError((c) =>
			c.events.create({
				payload: [{ entityId, eventSchemaId, properties: { rating: "not-a-number" } }],
			}),
		);

		assertTaggedError(error, "BadRequest");
	});

	it("ignores undeclared event properties when the schema does not opt into strict unknown keys", async () => {
		const { client } = await createAuthenticatedClient();
		const { entityId, eventSchemaId } = await createEventTestFixture(client);

		const data = await client.run((c) =>
			c.events.create({
				payload: [{ entityId, eventSchemaId, properties: { rating: 4, undeclaredField: "bad" } }],
			}),
		);

		expect(data.count).toBe(1);

		const [event] = await waitForEventCount(client, entityId, 1);
		expect(event?.properties).toEqual({ rating: 4 });
	});

	it("accepts event creation when properties match the schema", async () => {
		const { client } = await createAuthenticatedClient();
		const { entityId, eventSchemaId } = await createEventTestFixture(client);

		const data = await client.run((c) =>
			c.events.create({ payload: [{ entityId, eventSchemaId, properties: { rating: 5 } }] }),
		);

		expect(data.count).toBe(1);
	});
});

describe("Collection entity write path — propertiesSchema validation", () => {
	it("rejects collection creation when description is not a string", async () => {
		const { cookies } = await createAuthenticatedClient();

		const response = await fetch(`${getBackendUrl()}/collections`, {
			method: "POST",
			headers: { Cookie: cookies, "Content-Type": "application/json" },
			body: JSON.stringify({ description: 12345, name: "Invalid Description Type" }),
		});

		expect(response.status).toBe(400);
	});

	it("accepts collection creation with a valid description string", async () => {
		const { client } = await createAuthenticatedClient();
		const collection = await createCollection(client, {
			name: "Valid Collection",
			description: "A perfectly valid description",
		});

		expect(collection.id).toBeDefined();
		expect(collection.properties).toMatchObject({
			description: "A perfectly valid description",
		});
	});

	it("accepts collection creation with a valid membershipPropertiesSchema", async () => {
		const { client } = await createAuthenticatedClient();
		const collection = await createCollection(client, {
			name: "Schema Collection",
			membershipPropertiesSchema: {
				fields: { notes: { type: "string", label: "Notes", description: "Notes" } },
			},
		});

		expect(collection.id).toBeDefined();
		expect(collection.properties.membershipPropertiesSchema).toBeDefined();
	});
});

describe("Collection membership — member-of relationship propertiesSchema validation", () => {
	it("accepts membership add with properties matching the collection schema", async () => {
		const { client } = await createAuthenticatedClient();
		const collection = await createCollection(client, {
			name: "Rated Collection",
			membershipPropertiesSchema: {
				fields: {
					score: {
						label: "Score",
						description: "Score",
						type: "integer" as const,
						validation: { minimum: 1, maximum: 10 },
					},
				},
			},
		});
		const { entityId } = await createTrackerWithSchemaAndEntity(client);

		const data = await client.run((c) =>
			c.collections.createMembership({
				payload: { entityId, collectionId: collection.id, properties: { score: 8 } },
			}),
		);

		expect(data.memberOf.properties).toMatchObject({ score: 8 });
	});

	it("rejects membership add when properties fail the collection's membershipPropertiesSchema", async () => {
		const { client } = await createAuthenticatedClient();
		const collection = await createCollection(client, {
			name: "Strict Score Collection",
			membershipPropertiesSchema: {
				fields: {
					score: {
						label: "Score",
						description: "Score",
						type: "integer" as const,
						validation: { minimum: 1, maximum: 10 },
					},
				},
			},
		});
		const { entityId } = await createTrackerWithSchemaAndEntity(client);

		const error = await client.runError((c) =>
			c.collections.createMembership({
				payload: { entityId, collectionId: collection.id, properties: { score: 999 } },
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("Membership properties validation failed");
	});

	it("accepts membership add with arbitrary properties when no membershipPropertiesSchema is set", async () => {
		const { client } = await createAuthenticatedClient();
		const collection = await createCollection(client, { name: "Open Collection" });
		const { entityId } = await createTrackerWithSchemaAndEntity(client);

		const data = await client.run((c) =>
			c.collections.createMembership({
				payload: {
					entityId,
					collectionId: collection.id,
					properties: { arbitrary: "any-value", number: 42 },
				},
			}),
		);

		expect(data.memberOf.properties).toMatchObject({ arbitrary: "any-value", number: 42 });
	});
});
