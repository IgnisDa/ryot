import { describe, expect, it } from "bun:test";

import {
	clearEntityUserState,
	createAuthenticatedClient,
	createEntity,
	createEntitySchema,
	createGlobalBookEntityFixture,
	createTracker,
	createTrackerWithSchemaAndEntity,
	createTrackerWithSchema,
	findBuiltinSchemaBySlug,
	findBuiltinSchemaWithProviders,
	getEntity,
	getEntitySchema,
	getFirstProviderScriptId,
	insertLibraryMembership,
	listEventSchemas,
	queryInLibraryRelationship,
	queryUserEntityStateCounts,
	requireEventSchemaBySlug,
	waitForEventCount,
} from "../fixtures";
import { createCollection } from "../fixtures/collections";

async function createSchemaWithEnumFields(
	client: Awaited<ReturnType<typeof createAuthenticatedClient>>["client"],
	cookies: string,
) {
	const { trackerId } = await createTracker(client, cookies, {
		name: "Enum Schema Tracker",
	});
	const { schemaId } = await createEntitySchema(client, cookies, {
		trackerId,
		name: "Enum Schema",
		propertiesSchema: {
			fields: {
				status: {
					label: "Status",
					type: "enum" as const,
					description: "Status",
					options: ["draft", "published", "archived"],
				},
				genres: {
					label: "Genres",
					description: "Genres",
					type: "enum-array" as const,
					options: ["fiction", "non-fiction", "mystery"],
				},
			},
		},
	});
	return { schemaId };
}

describe("POST /entities", () => {
	it("creates entity normally when no provenance fields are provided", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(client, cookies);

		const entity = await createEntity(client, cookies, {
			image: null,
			name: "Plain Entity",
			entitySchemaId: schemaId,
			properties: { title: "Plain Entity" },
		});

		expect(entity.id).toBeDefined();
		expect(entity.name).toBe("Plain Entity");
		expect(entity.externalId).toBeNull();
		expect(entity.sandboxScriptId).toBeNull();
	});

	it("creates entity with externalId and sandboxScriptId", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(client, cookies);
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const sandboxScriptId = getFirstProviderScriptId(schema);

		const entity = await createEntity(client, cookies, {
			image: null,
			sandboxScriptId,
			externalId: "ext-001",
			name: "External Entity",
			entitySchemaId: schemaId,
			properties: { title: "External Entity" },
		});

		expect(entity.id).toBeDefined();
		expect(entity.externalId).toBe("ext-001");
		expect(entity.sandboxScriptId).toBe(sandboxScriptId);
	});

	it("returns the existing entity on duplicate externalId + sandboxScriptId", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(client, cookies);
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const sandboxScriptId = getFirstProviderScriptId(schema);

		const first = await createEntity(client, cookies, {
			image: null,
			sandboxScriptId,
			entitySchemaId: schemaId,
			name: "Idempotent Entity",
			externalId: "ext-idem-001",
			properties: { title: "Idempotent Entity" },
		});

		const second = await createEntity(client, cookies, {
			image: null,
			sandboxScriptId,
			entitySchemaId: schemaId,
			name: "Idempotent Entity",
			externalId: "ext-idem-001",
			properties: { title: "Idempotent Entity" },
		});

		expect(second.id).toBe(first.id);
	});

	it("creates an entity for a built-in schema that was previously restricted", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const providerScriptId = getFirstProviderScriptId(schema);

		const entity = await createEntity(client, cookies, {
			image: null,
			properties: {},
			name: "Built-in Book",
			entitySchemaId: schema.id,
			externalId: `ext-builtin-${crypto.randomUUID()}`,
			sandboxScriptId: providerScriptId,
		});

		expect(entity.id).toBeDefined();
		expect(entity.name).toBe("Built-in Book");
		expect(entity.entitySchemaId).toBe(schema.id);
	});

	it("creates a built-in workout entity through the generic entity endpoint", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(client, cookies, "workout");

		const entity = await createEntity(client, cookies, {
			image: null,
			name: "Push Day",
			entitySchemaId: schema.id,
			properties: {
				endedAt: "2026-04-27T11:00:00Z",
				startedAt: "2026-04-27T10:00:00Z",
			},
		});

		expect(entity.id).toBeDefined();
		expect(entity.entitySchemaId).toBe(schema.id);
		expect(entity.properties).toMatchObject({
			endedAt: "2026-04-27T11:00:00Z",
			startedAt: "2026-04-27T10:00:00Z",
		});
	});

	it("returns 400 when only externalId is provided without sandboxScriptId", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(client, cookies);

		const { response, error } = await client.POST("/entities", {
			headers: { Cookie: cookies },
			body: {
				image: null,
				entitySchemaId: schemaId,
				externalId: "ext-partial",
				properties: { title: "Partial" },
				name: "Partial Provenance Entity",
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error.message).toBe(
			"externalId and sandboxScriptId must both be provided or both be omitted",
		);
	});

	it("returns 400 when only sandboxScriptId is provided without externalId", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(client, cookies);
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const sandboxScriptId = getFirstProviderScriptId(schema);

		const { response, error } = await client.POST("/entities", {
			headers: { Cookie: cookies },
			body: {
				image: null,
				sandboxScriptId,
				entitySchemaId: schemaId,
				properties: { title: "Partial" },
				name: "Partial Provenance Entity",
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error.message).toBe(
			"externalId and sandboxScriptId must both be provided or both be omitted",
		);
	});
});

describe("GET /entities/:id — global entity read access", () => {
	it("returns 200 for the importing user and for a second user who never imported", async () => {
		const { userId, client: clientA, cookies: cookiesA } = await createAuthenticatedClient();
		const { entity } = await createGlobalBookEntityFixture(clientA, cookiesA);

		await insertLibraryMembership({ userId, mediaEntityId: entity.id });

		const entityId = entity.id;

		const { response: responseA } = await clientA.GET("/entities/{entityId}", {
			headers: { Cookie: cookiesA },
			params: { path: { entityId } },
		});
		expect(responseA.status).toBe(200);

		const { client: clientB, cookies: cookiesB } = await createAuthenticatedClient();
		const { response: responseB } = await clientB.GET("/entities/{entityId}", {
			headers: { Cookie: cookiesB },
			params: { path: { entityId } },
		});
		expect(responseB.status).toBe(200);
	}, 30_000);
});

describe("POST /entities — enum and enum-array property schema validation", () => {
	it("round-trips enum and enum-array fields in propertiesSchema", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Enum Round-trip Tracker",
		});
		const { schemaId } = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Round-trip Schema",
			propertiesSchema: {
				fields: {
					status: {
						label: "Status",
						type: "enum" as const,
						description: "Status",
						options: ["draft", "published"],
					},
					genres: {
						label: "Genres",
						description: "Genres",
						type: "enum-array" as const,
						options: ["fiction", "mystery"],
					},
				},
			},
		});

		const schema = await getEntitySchema(client, cookies, schemaId);

		expect(schema.propertiesSchema.fields.status).toMatchObject({
			type: "enum",
			label: "Status",
			description: "Status",
			options: ["draft", "published"],
		});
		expect(schema.propertiesSchema.fields.genres).toMatchObject({
			label: "Genres",
			type: "enum-array",
			description: "Genres",
			options: ["fiction", "mystery"],
		});
	});

	it("creates entity with valid enum and enum-array values", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemaId } = await createSchemaWithEnumFields(client, cookies);

		const entity = await createEntity(client, cookies, {
			image: null,
			name: "Fiction Book",
			entitySchemaId: schemaId,
			properties: { status: "published", genres: ["fiction", "mystery"] },
		});

		expect(entity.id).toBeDefined();
		expect(entity.name).toBe("Fiction Book");
	});

	it("returns 400 when enum value is not in options", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemaId } = await createSchemaWithEnumFields(client, cookies);

		const { response, error } = await client.POST("/entities", {
			headers: { Cookie: cookies },
			body: {
				image: null,
				name: "Invalid Status",
				entitySchemaId: schemaId,
				properties: { status: "deleted" },
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error).toBeDefined();
	});

	it("returns 400 when an enum-array item is not in options", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemaId } = await createSchemaWithEnumFields(client, cookies);

		const { response, error } = await client.POST("/entities", {
			headers: { Cookie: cookies },
			body: {
				image: null,
				name: "Invalid Genre",
				entitySchemaId: schemaId,
				properties: { genres: ["fiction", "horror"] },
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error).toBeDefined();
	});
});

describe("DELETE /entities/:id/user-state", () => {
	it("clears only the caller's user-scoped state for a global entity", async () => {
		const userA = await createAuthenticatedClient();
		const userB = await createAuthenticatedClient();
		const { entity, schema } = await createGlobalBookEntityFixture(userA.client, userA.cookies);

		const eventSchemas = await listEventSchemas(userA.client, userA.cookies, schema.id);
		const reviewEventSchema = requireEventSchemaBySlug(eventSchemas, "review");

		const createUserAReview = await userA.client.POST("/events", {
			headers: { Cookie: userA.cookies },
			body: [
				{
					entityId: entity.id,
					eventSchemaId: reviewEventSchema.id,
					properties: { rating: 4, text: "User A review" },
				},
			],
		});
		expect(createUserAReview.response.status).toBe(200);

		const collection = await createCollection(userA.client, userA.cookies, {
			name: `User A Collection ${crypto.randomUUID()}`,
		});
		const addToCollection = await userA.client.POST("/collections/memberships", {
			headers: { Cookie: userA.cookies },
			body: { entityId: entity.id, collectionId: collection.id },
		});
		expect(addToCollection.response.status).toBe(200);

		const createUserBReview = await userB.client.POST("/events", {
			headers: { Cookie: userB.cookies },
			body: [
				{
					entityId: entity.id,
					eventSchemaId: reviewEventSchema.id,
					properties: { rating: 5, text: "User B review" },
				},
			],
		});
		expect(createUserBReview.response.status).toBe(200);
		await waitForEventCount(userA.client, userA.cookies, entity.id, 1);
		await waitForEventCount(userB.client, userB.cookies, entity.id, 1);

		await insertLibraryMembership({ userId: userB.userId, mediaEntityId: entity.id });

		expect(await queryUserEntityStateCounts({ userId: userA.userId, entityId: entity.id })).toEqual(
			{ eventCount: 1, relationshipCount: 2 },
		);
		expect(await queryUserEntityStateCounts({ userId: userB.userId, entityId: entity.id })).toEqual(
			{ eventCount: 1, relationshipCount: 1 },
		);

		const result = await clearEntityUserState(userA.client, userA.cookies, entity.id);

		expect(result).toEqual({
			entityId: entity.id,
			deletedEventsCount: 1,
			deletedRelationshipsCount: 2,
		});
		expect(await queryUserEntityStateCounts({ userId: userA.userId, entityId: entity.id })).toEqual(
			{ eventCount: 0, relationshipCount: 0 },
		);
		expect(await queryUserEntityStateCounts({ userId: userB.userId, entityId: entity.id })).toEqual(
			{ eventCount: 1, relationshipCount: 1 },
		);

		const userAMembership = await queryInLibraryRelationship(entity.id, userA.email);
		const userBMembership = await queryInLibraryRelationship(entity.id, userB.email);
		expect(userAMembership.rowCount).toBe(0);
		expect(userBMembership.rowCount).toBe(1);
	});

	it("clears collection user-state without deleting the collection entity row", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const collection = await createCollection(client, cookies, {
			name: `Collection User State ${crypto.randomUUID()}`,
		});
		const { entityId } = await createTrackerWithSchemaAndEntity(client, cookies);

		const addToCollection = await client.POST("/collections/memberships", {
			headers: { Cookie: cookies },
			body: { entityId, collectionId: collection.id },
		});
		expect(addToCollection.response.status).toBe(200);

		const collectionEventSchemas = await listEventSchemas(
			client,
			cookies,
			collection.entitySchemaId,
		);
		const reviewEventSchema = requireEventSchemaBySlug(collectionEventSchemas, "review");
		const createCollectionReview = await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId: collection.id,
					eventSchemaId: reviewEventSchema.id,
					properties: { rating: 3, text: "Collection review" },
				},
			],
		});
		expect(createCollectionReview.response.status).toBe(200);
		await waitForEventCount(client, cookies, collection.id, 2);

		expect(await queryUserEntityStateCounts({ userId, entityId: collection.id })).toEqual({
			eventCount: 2,
			relationshipCount: 1,
		});

		const result = await clearEntityUserState(client, cookies, collection.id);

		expect(result).toEqual({
			entityId: collection.id,
			deletedEventsCount: 2,
			deletedRelationshipsCount: 1,
		});
		expect(await queryUserEntityStateCounts({ userId, entityId: collection.id })).toEqual({
			eventCount: 0,
			relationshipCount: 0,
		});

		const persistedCollection = await getEntity(client, cookies, collection.id);
		expect(persistedCollection.id).toBe(collection.id);
	});

	it("rejects unauthenticated requests", async () => {
		const { client } = await createAuthenticatedClient();

		const { response } = await client.DELETE("/entities/{entityId}/user-state", {
			params: { path: { entityId: "entity_1" } },
		});

		expect(response.status).toBe(401);
	});
});
