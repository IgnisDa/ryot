import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createCollection,
	createEntity,
	createEventTestFixture,
	createTrackerWithSchema,
	createTrackerWithSchemaAndEntity,
} from "../fixtures";

describe("Entity write path — propertiesSchema validation", () => {
	it("rejects entity creation when a required field is missing", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(client, cookies, {
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

		const { response, error } = await client.POST("/entities", {
			headers: { Cookie: cookies },
			body: { image: null, properties: {}, name: "Missing Required", entitySchemaId: schemaId },
		});

		expect(response.status).toBe(400);
		expect(error?.error.message).toContain("Entity payload is invalid");
	});

	it("rejects entity creation when a field has the wrong type", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(client, cookies, {
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

		const { response } = await client.POST("/entities", {
			headers: { Cookie: cookies },
			body: {
				image: null,
				name: "Wrong Type",
				entitySchemaId: schemaId,
				properties: { count: "not-a-number" },
			},
		});

		expect(response.status).toBe(400);
	});

	it("rejects entity creation with properties not declared in the schema", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(client, cookies, {
			name: "Strict Schema",
			propertiesSchema: {
				fields: { title: { label: "Title", description: "Title", type: "string" as const } },
			},
		});

		const { response } = await client.POST("/entities", {
			headers: { Cookie: cookies },
			body: {
				image: null,
				name: "Extra Field",
				entitySchemaId: schemaId,
				properties: { title: "OK", undeclaredField: "should fail" },
			},
		});

		expect(response.status).toBe(400);
	});

	it("accepts entity creation when properties match the schema exactly", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(client, cookies, {
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

		const entity = await createEntity(client, cookies, {
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
		const { client, cookies } = await createAuthenticatedClient();
		const { entityId, eventSchemaId } = await createEventTestFixture(client, cookies);

		const { response, error } = await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [{ entityId, eventSchemaId, properties: {} }],
		});

		expect(response.status).toBe(400);
		expect(error?.error.message).toContain("Event payload is invalid");
	});

	it("rejects event creation when a field has the wrong type", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { entityId, eventSchemaId } = await createEventTestFixture(client, cookies);

		const { response } = await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [{ entityId, eventSchemaId, properties: { rating: "not-a-number" } }],
		});

		expect(response.status).toBe(400);
	});

	it("rejects event creation with unknown properties", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { entityId, eventSchemaId } = await createEventTestFixture(client, cookies);

		const { response } = await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [{ entityId, eventSchemaId, properties: { rating: 4, undeclaredField: "bad" } }],
		});

		expect(response.status).toBe(400);
	});

	it("accepts event creation when properties match the schema", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { entityId, eventSchemaId } = await createEventTestFixture(client, cookies);

		const { response, data } = await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [{ entityId, eventSchemaId, properties: { rating: 5 } }],
		});

		expect(response.status).toBe(200);
		expect(data?.data.count).toBe(1);
	});
});

describe("Collection entity write path — propertiesSchema validation", () => {
	it("rejects collection creation when description is not a string", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { response } = await client.POST("/collections", {
			headers: { Cookie: cookies },
			body: {
				name: "Invalid Description Type",
				// oxlint-disable-next-line no-unsafe-type-assertion
				description: 12345 as unknown as string,
			},
		});

		expect(response.status).toBe(400);
	});

	it("accepts collection creation with a valid description string", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const collection = await createCollection(client, cookies, {
			name: "Valid Collection",
			description: "A perfectly valid description",
		});

		expect(collection.id).toBeDefined();
		expect(collection.properties).toMatchObject({
			description: "A perfectly valid description",
		});
	});

	it("accepts collection creation with a valid membershipPropertiesSchema", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const collection = await createCollection(client, cookies, {
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
		const { client, cookies } = await createAuthenticatedClient();
		const collection = await createCollection(client, cookies, {
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
		const { entityId } = await createTrackerWithSchemaAndEntity(client, cookies);

		const { data, response } = await client.POST("/collections/memberships", {
			headers: { Cookie: cookies },
			body: { entityId, collectionId: collection.id, properties: { score: 8 } },
		});

		expect(response.status).toBe(200);
		expect(data?.data.memberOf.properties).toMatchObject({ score: 8 });
	});

	it("rejects membership add when properties fail the collection's membershipPropertiesSchema", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const collection = await createCollection(client, cookies, {
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
		const { entityId } = await createTrackerWithSchemaAndEntity(client, cookies);

		const { response, error } = await client.POST("/collections/memberships", {
			headers: { Cookie: cookies },
			body: { entityId, collectionId: collection.id, properties: { score: 999 } },
		});

		expect(response.status).toBe(400);
		expect(error?.error.message).toContain("Membership properties validation failed");
	});

	it("accepts membership add with arbitrary properties when no membershipPropertiesSchema is set", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const collection = await createCollection(client, cookies, { name: "Open Collection" });
		const { entityId } = await createTrackerWithSchemaAndEntity(client, cookies);

		const { data, response } = await client.POST("/collections/memberships", {
			headers: { Cookie: cookies },
			body: {
				entityId,
				collectionId: collection.id,
				properties: { arbitrary: "any-value", number: 42 },
			},
		});

		expect(response.status).toBe(200);
		expect(data?.data.memberOf.properties).toMatchObject({ arbitrary: "any-value", number: 42 });
	});
});
