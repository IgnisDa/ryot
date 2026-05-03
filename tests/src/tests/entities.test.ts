import { describe, expect, it } from "bun:test";
import {
	createAuthenticatedClient,
	createEntity,
	createEntitySchema,
	createTracker,
	createTrackerWithSchema,
	findBuiltinSchemaBySlug,
	findBuiltinSchemaWithProviders,
	getEntitySchema,
	getFirstProviderScriptId,
	insertLibraryMembership,
	seedMediaEntity,
} from "../fixtures";

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

	it("returns 400 for a built-in schema even when provenance fields are provided", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const providerScriptId = getFirstProviderScriptId(schema);

		const { response, error } = await client.POST("/entities", {
			headers: { Cookie: cookies },
			body: {
				image: null,
				properties: {},
				name: "Built-in Book",
				entitySchemaId: schema.id,
				externalId: "ext-builtin-test",
				sandboxScriptId: providerScriptId,
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error?.message).toBe(
			"Built-in entity schemas do not support manual entity creation",
		);
	});

	it("creates a built-in workout entity through the generic entity endpoint", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(
			client,
			cookies,
			"workout",
		);

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
		expect(error?.error?.message).toBe(
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
		expect(error?.error?.message).toBe(
			"externalId and sandboxScriptId must both be provided or both be omitted",
		);
	});
});

describe("GET /entities/:id — global entity read access", () => {
	it("returns 200 for the importing user and for a second user who never imported", async () => {
		const {
			userId,
			client: clientA,
			cookies: cookiesA,
		} = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(clientA, cookiesA);
		const providerScriptId = getFirstProviderScriptId(schema);

		const entity = await seedMediaEntity({
			image: null,
			userId: null,
			properties: {},
			entitySchemaId: schema.id,
			sandboxScriptId: providerScriptId,
			externalId: `global-book-${crypto.randomUUID()}`,
			name: `Global Built-in Book ${crypto.randomUUID()}`,
		});

		await insertLibraryMembership({ userId, mediaEntityId: entity.id });

		const entityId = entity.id;

		const { response: responseA } = await clientA.GET("/entities/{entityId}", {
			headers: { Cookie: cookiesA },
			params: { path: { entityId } },
		});
		expect(responseA.status).toBe(200);

		const { client: clientB, cookies: cookiesB } =
			await createAuthenticatedClient();
		const { response: responseB } = await clientB.GET("/entities/{entityId}", {
			headers: { Cookie: cookiesB },
			params: { path: { entityId } },
		});
		expect(responseB.status).toBe(200);
	}, 30_000);
});

describe("POST /entities — enum and enum-array property schema validation", () => {
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
						options: ["draft", "published", "archived"],
					},
					genres: {
						label: "Genres",
						type: "enum-array" as const,
						options: ["fiction", "non-fiction", "mystery"],
					},
				},
			},
		});
		return { schemaId };
	}

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
						options: ["draft", "published"],
					},
					genres: {
						label: "Genres",
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
			options: ["draft", "published"],
		});
		expect(schema.propertiesSchema.fields.genres).toMatchObject({
			type: "enum-array",
			label: "Genres",
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
