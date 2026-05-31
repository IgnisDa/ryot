import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createEntity,
	createEntitySchema,
	createGlobalBookEntityFixture,
	createTracker,
	createTrackerWithSchema,
	findBuiltinSchemaBySlug,
	findBuiltinSchemaWithProviders,
	getEntity,
	getEntitySchema,
	getFirstProviderScriptId,
	insertLibraryMembership,
} from "../fixtures";
import { assertTaggedError } from "../test-support/assertions";

async function createSchemaWithEnumFields(
	client: Awaited<ReturnType<typeof createAuthenticatedClient>>["client"],
) {
	const { trackerId } = await createTracker(client, {
		name: "Enum Schema Tracker",
	});
	const { schemaId } = await createEntitySchema(client, {
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
		const { client } = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(client);

		const entity = await createEntity(client, {
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
		const { client } = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(client);
		const { schema } = await findBuiltinSchemaWithProviders(client);
		const sandboxScriptId = getFirstProviderScriptId(schema);

		const entity = await createEntity(client, {
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
		const { client } = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(client);
		const { schema } = await findBuiltinSchemaWithProviders(client);
		const sandboxScriptId = getFirstProviderScriptId(schema);

		const first = await createEntity(client, {
			image: null,
			sandboxScriptId,
			entitySchemaId: schemaId,
			name: "Idempotent Entity",
			externalId: "ext-idem-001",
			properties: { title: "Idempotent Entity" },
		});

		const second = await createEntity(client, {
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
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client);
		const providerScriptId = getFirstProviderScriptId(schema);

		const entity = await createEntity(client, {
			image: null,
			properties: {},
			name: "Built-in Book",
			entitySchemaId: schema.id,
			sandboxScriptId: providerScriptId,
			externalId: `ext-builtin-${crypto.randomUUID()}`,
		});

		expect(entity.id).toBeDefined();
		expect(entity.name).toBe("Built-in Book");
		expect(entity.entitySchemaId).toBe(schema.id);
	});

	it("creates a built-in workout entity through the generic entity endpoint", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(client, "workout");

		const entity = await createEntity(client, {
			image: null,
			name: "Push Day",
			entitySchemaId: schema.id,
			properties: { endedAt: "2026-04-27T11:00:00Z", startedAt: "2026-04-27T10:00:00Z" },
		});

		expect(entity.id).toBeDefined();
		expect(entity.entitySchemaId).toBe(schema.id);
		expect(entity.properties).toMatchObject({
			endedAt: "2026-04-27T11:00:00Z",
			startedAt: "2026-04-27T10:00:00Z",
		});
	});

	it("returns 400 when only externalId is provided without sandboxScriptId", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(client);

		const error = await client.runError((c) =>
			c.entities.create({
				payload: {
					entitySchemaId: schemaId,
					externalId: "ext-partial",
					properties: { title: "Partial" },
					name: "Partial Provenance Entity",
				},
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toBe(
			"externalId and sandboxScriptId must both be provided or both be omitted",
		);
	});

	it("returns 400 when only sandboxScriptId is provided without externalId", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(client);
		const { schema } = await findBuiltinSchemaWithProviders(client);
		const sandboxScriptId = getFirstProviderScriptId(schema);

		const error = await client.runError((c) =>
			c.entities.create({
				payload: {
					sandboxScriptId,
					entitySchemaId: schemaId,
					properties: { title: "Partial" },
					name: "Partial Provenance Entity",
				},
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toBe(
			"externalId and sandboxScriptId must both be provided or both be omitted",
		);
	});
});

describe("GET /entities/:id — global entity read access", () => {
	it("returns 200 for the importing user and for a second user who never imported", async () => {
		const { userId, client: clientA } = await createAuthenticatedClient();
		const { entity } = await createGlobalBookEntityFixture(clientA);

		await insertLibraryMembership(clientA, { userId, mediaEntityId: entity.id });
		const entityA = await getEntity(clientA, entity.id);
		expect(entityA.id).toBe(entity.id);

		const { client: clientB } = await createAuthenticatedClient();
		const entityB = await getEntity(clientB, entity.id);
		expect(entityB.id).toBe(entity.id);
	}, 30_000);
});

describe("POST /entities — enum and enum-array property schema validation", () => {
	it("round-trips enum and enum-array fields in propertiesSchema", async () => {
		const { client } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, {
			name: "Enum Round-trip Tracker",
		});
		const { schemaId } = await createEntitySchema(client, {
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

		const schema = await getEntitySchema(client, schemaId);

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
		const { client } = await createAuthenticatedClient();
		const { schemaId } = await createSchemaWithEnumFields(client);

		const entity = await createEntity(client, {
			image: null,
			name: "Fiction Book",
			entitySchemaId: schemaId,
			properties: { status: "published", genres: ["fiction", "mystery"] },
		});

		expect(entity.id).toBeDefined();
		expect(entity.name).toBe("Fiction Book");
	});

	it("returns 400 when enum value is not in options", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId } = await createSchemaWithEnumFields(client);

		const error = await client.runError((c) =>
			c.entities.create({
				payload: {
					name: "Invalid Status",
					entitySchemaId: schemaId,
					properties: { status: "deleted" },
				},
			}),
		);

		assertTaggedError(error, "BadRequest");
	});

	it("returns 400 when an enum-array item is not in options", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId } = await createSchemaWithEnumFields(client);

		const error = await client.runError((c) =>
			c.entities.create({
				payload: {
					name: "Invalid Genre",
					entitySchemaId: schemaId,
					properties: { genres: ["fiction", "horror"] },
				},
			}),
		);

		assertTaggedError(error, "BadRequest");
	});
});
