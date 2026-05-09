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
	enqueueEntityImport,
	enqueueEntitySearch,
	findBuiltinSchemaBySlug,
	findBuiltinSchemaWithProviders,
	getBackendClient,
	getEntity,
	getEntitySchema,
	getFirstProviderScriptId,
	insertLibraryMembership,
	listEventSchemas,
	pollEntityImportResult,
	pollEntitySearchResult,
	queryInLibraryRelationship,
	queryUserEntityStateCounts,
	requireEventSchemaBySlug,
} from "../fixtures";
import { getPgClient } from "../setup";
import { assertTaggedError } from "../test-support/assertions";

async function insertUserEvent(input: {
	userId: string;
	entityId: string;
	eventSchemaId: string;
	sessionEntityId?: string;
	properties: Record<string, unknown>;
}) {
	const pg = getPgClient();

	await pg.query(
		`insert into event (
			id,
			user_id,
			entity_id,
			event_schema_id,
			session_entity_id,
			occurred_at,
			properties
		) values ($1, $2, $3, $4, $5, now(), $6::jsonb)`,
		[
			crypto.randomUUID(),
			input.userId,
			input.entityId,
			input.eventSchemaId,
			input.sessionEntityId ?? null,
			JSON.stringify(input.properties),
		],
	);
}

async function insertUserRelationship(input: {
	userId: string;
	sourceEntityId: string;
	targetEntityId: string;
	relationshipSchemaSlug: string;
	properties?: Record<string, unknown>;
}) {
	const pg = getPgClient();
	const relationshipSchema = await pg.query<{ id: string }>(
		`select id from relationship_schema
		 where slug = $1 and user_id is null
		 limit 1`,
		[input.relationshipSchemaSlug],
	);
	const relationshipSchemaId = relationshipSchema.rows[0]?.id;
	if (!relationshipSchemaId) {
		throw new Error(`Missing relationship schema '${input.relationshipSchemaSlug}'`);
	}

	await pg.query(
		`insert into relationship (
			id,
			user_id,
			relationship_schema_id,
			properties,
			source_entity_id,
			target_entity_id
		) values ($1, $2, $3, $4::jsonb, $5, $6)
		 on conflict (user_id, source_entity_id, target_entity_id, relationship_schema_id) do nothing`,
		[
			crypto.randomUUID(),
			input.userId,
			relationshipSchemaId,
			JSON.stringify(input.properties ?? {}),
			input.sourceEntityId,
			input.targetEntityId,
		],
	);
}

async function getLibraryEntityId(userId: string) {
	const pg = getPgClient();
	const result = await pg.query<{ id: string }>(
		`select e.id
		 from entity e
		 inner join entity_schema es on es.id = e.entity_schema_id
		 where e.user_id = $1
		   and es.slug = 'library'
		   and es.user_id is null
		 limit 1`,
		[userId],
	);

	const libraryEntityId = result.rows[0]?.id;
	if (!libraryEntityId) {
		throw new Error(`Missing library entity for user '${userId}'`);
	}

	return libraryEntityId;
}

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

		await insertLibraryMembership({ userId, mediaEntityId: entity.id });
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

describe("DELETE /entities/:id/user-state", () => {
	it("clears only the caller's user-scoped state for a global entity", async () => {
		const userA = await createAuthenticatedClient();
		const userB = await createAuthenticatedClient();
		const { entity, schema } = await createGlobalBookEntityFixture(userA.client);

		const eventSchemas = await listEventSchemas(userA.client, schema.id);
		const reviewEventSchema = requireEventSchemaBySlug(eventSchemas, "review");

		const { entityId: extraTargetEntityId } = await createTrackerWithSchemaAndEntity(userA.client);

		await insertUserEvent({
			entityId: entity.id,
			userId: userA.userId,
			eventSchemaId: reviewEventSchema.id,
			properties: { rating: 4, text: "User A review" },
		});
		await insertUserEvent({
			entityId: entity.id,
			userId: userB.userId,
			eventSchemaId: reviewEventSchema.id,
			properties: { rating: 5, text: "User B review" },
		});

		await insertLibraryMembership({ userId: userB.userId, mediaEntityId: entity.id });
		await insertLibraryMembership({ userId: userA.userId, mediaEntityId: entity.id });
		await insertUserRelationship({
			userId: userA.userId,
			sourceEntityId: entity.id,
			targetEntityId: extraTargetEntityId,
			relationshipSchemaSlug: "member-of",
		});

		expect(await queryUserEntityStateCounts({ userId: userA.userId, entityId: entity.id })).toEqual(
			{ eventCount: 1, relationshipCount: 2 },
		);
		expect(await queryUserEntityStateCounts({ userId: userB.userId, entityId: entity.id })).toEqual(
			{ eventCount: 1, relationshipCount: 1 },
		);

		const result = await clearEntityUserState(userA.client, entity.id);

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

	it("rejects clearing the library entity user state", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const libraryEntityId = await getLibraryEntityId(userId);

		const error = await client.runError((c) =>
			c.userState.clearUserState({ path: { entityId: libraryEntityId } }),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toBe("Library entity user state cannot be cleared");
	});

	it("rejects unauthenticated requests", async () => {
		const client = getBackendClient();

		const error = await client.runError((c) =>
			c.userState.clearUserState({ path: { entityId: "entity_1" } }),
		);

		assertTaggedError(error, "Unauthorized");
	});
});

describe("POST /entity-schemas/search — provider entity search", () => {
	it("returns 404 when the script does not exist", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.entitySchemas.search({ payload: { scriptId: crypto.randomUUID() } }),
		);

		assertTaggedError(error, "NotFound");
	});

	it("enqueues a provider search and reaches a terminal state", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client);
		const scriptId = getFirstProviderScriptId(schema);

		const { jobId } = await enqueueEntitySearch(client, {
			scriptId,
			context: { query: "test", page: 1, pageSize: 5 },
		});

		const result = await pollEntitySearchResult(client, jobId);
		expect(result.status).not.toBe("pending");
	}, 30_000);

	it("returns 401 for unauthenticated search requests", async () => {
		const client = getBackendClient();

		const error = await client.runError((c) =>
			c.entitySchemas.search({ payload: { scriptId: crypto.randomUUID() } }),
		);

		assertTaggedError(error, "Unauthorized");
	});
});

describe("POST /entities/import — provider entity import", () => {
	it("returns 404 when the script does not exist", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client);

		const error = await client.runError((c) =>
			c.entities.import({
				payload: {
					scriptId: crypto.randomUUID(),
					externalId: "some-external-id",
					entitySchemaId: schema.id,
				},
			}),
		);

		assertTaggedError(error, "NotFound");
	});

	it("returns 404 when the entity schema does not exist", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client);
		const scriptId = getFirstProviderScriptId(schema);

		const error = await client.runError((c) =>
			c.entities.import({
				payload: {
					scriptId,
					externalId: "some-external-id",
					entitySchemaId: crypto.randomUUID(),
				},
			}),
		);

		assertTaggedError(error, "NotFound");
	});

	it("returns 404 for unknown import job id", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.entities.getImportResult({ path: { jobId: crypto.randomUUID() } }),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Entity import job not found");
	});

	it("returns 401 for unauthenticated import requests", async () => {
		const client = getBackendClient();

		const error = await client.runError((c) =>
			c.entities.import({
				payload: {
					externalId: "some-id",
					scriptId: crypto.randomUUID(),
					entitySchemaId: crypto.randomUUID(),
				},
			}),
		);

		assertTaggedError(error, "Unauthorized");
	});
});

describe("GET /entities/import/:jobId — provider entity import result", () => {
	it("enqueues a provider import and adds entity to library when completed", async () => {
		const { client, email } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(client, "audiobook");
		const scriptId = getFirstProviderScriptId(schema);

		const { jobId } = await enqueueEntityImport(client, {
			scriptId,
			externalId: "B08G9PRS1K",
			entitySchemaId: schema.id,
		});

		const result = await pollEntityImportResult(client, jobId);

		expect(result.status).not.toBe("pending");
		if (result.status === "completed") {
			expect(result.data.id).toBeDefined();
			expect(result.data.name).toBeDefined();
			expect(result.data.entitySchemaId).toBe(schema.id);

			const inLibrary = await queryInLibraryRelationship(result.data.id, email);
			expect(inLibrary.rowCount).toBeGreaterThan(0);
		}
	}, 60_000);
});
