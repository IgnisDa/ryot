import { Effect } from "effect";

import {
	type Client,
	createAuthenticatedClient,
	createEntity,
	createEntitySchema,
	createGlobalBookEntityFixture,
	createPluginScope,
	createTrackerWithSchema,
	findBuiltinSchemaBySlug,
	findBuiltinSchemaWithProviders,
	getEntity,
	getEntitySchema,
	getFirstProviderScriptId,
	insertLibraryMembership,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const createSchemaWithEnumFields = (client: Client) =>
	Effect.gen(function* () {
		const pluginSlug = createPluginScope();
		const { schemaId } = yield* createEntitySchema(client, {
			pluginSlug,
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
	});

describe("POST /entities", () => {
	it.live("creates entity normally when no provenance fields are provided", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId } = yield* createTrackerWithSchema(client);

			const entity = yield* createEntity(client, {
				name: "Plain Entity",
				entitySchemaSlug: schemaId,
				properties: { title: "Plain Entity" },
			});

			expect(entity.id).toBeDefined();
			expect(entity.name).toBe("Plain Entity");
			expect(entity.externalId).toBeNull();
			expect(entity.sandboxScriptId).toBeNull();
		}),
	);

	it.live("creates entity with externalId and sandboxScriptId", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId } = yield* createTrackerWithSchema(client);
			const { schema } = yield* findBuiltinSchemaWithProviders(client);
			const sandboxScriptId = getFirstProviderScriptId(schema);

			const entity = yield* createEntity(client, {
				sandboxScriptId,
				externalId: "ext-001",
				name: "External Entity",
				entitySchemaSlug: schemaId,
				properties: { title: "External Entity" },
			});

			expect(entity.id).toBeDefined();
			expect(entity.externalId).toBe("ext-001");
			expect(entity.sandboxScriptId).toBe(sandboxScriptId);
		}),
	);

	it.live("returns the existing entity on duplicate externalId + sandboxScriptId", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId } = yield* createTrackerWithSchema(client);
			const { schema } = yield* findBuiltinSchemaWithProviders(client);
			const sandboxScriptId = getFirstProviderScriptId(schema);

			const first = yield* createEntity(client, {
				sandboxScriptId,
				entitySchemaSlug: schemaId,
				name: "Idempotent Entity",
				externalId: "ext-idem-001",
				properties: { title: "Idempotent Entity" },
			});

			const second = yield* createEntity(client, {
				sandboxScriptId,
				entitySchemaSlug: schemaId,
				name: "Idempotent Entity",
				externalId: "ext-idem-001",
				properties: { title: "Idempotent Entity" },
			});

			expect(second.id).toBe(first.id);
		}),
	);

	it.live("creates an entity for a built-in schema that was previously restricted", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaWithProviders(client);
			const providerScriptId = getFirstProviderScriptId(schema);

			const entity = yield* createEntity(client, {
				properties: {},
				name: "Built-in Book",
				entitySchemaSlug: schema.id,
				sandboxScriptId: providerScriptId,
				externalId: `ext-builtin-${crypto.randomUUID()}`,
			});

			expect(entity.id).toBeDefined();
			expect(entity.name).toBe("Built-in Book");
			expect(entity.entitySchemaSlug).toBe(schema.id);
		}),
	);

	it.live("creates a built-in workout entity through the generic entity endpoint", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(client, "workout");

			const entity = yield* createEntity(client, {
				name: "Push Day",
				entitySchemaSlug: schema.id,
				properties: { endedAt: "2026-04-27T11:00:00Z", startedAt: "2026-04-27T10:00:00Z" },
			});

			expect(entity.id).toBeDefined();
			expect(entity.entitySchemaSlug).toBe(schema.id);
			expect(entity.properties).toMatchObject({
				endedAt: "2026-04-27T11:00:00Z",
				startedAt: "2026-04-27T10:00:00Z",
			});
		}),
	);

	it.live("returns 400 when only externalId is provided without sandboxScriptId", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId } = yield* createTrackerWithSchema(client);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.entities.create({
						payload: {
							entitySchemaSlug: schemaId,
							externalId: "ext-partial",
							properties: { title: "Partial" },
							name: "Partial Provenance Entity",
						},
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe(
				"externalId and sandboxScriptId must both be provided or both be omitted",
			);
		}),
	);

	it.live("returns 400 when only sandboxScriptId is provided without externalId", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId } = yield* createTrackerWithSchema(client);
			const { schema } = yield* findBuiltinSchemaWithProviders(client);
			const sandboxScriptId = getFirstProviderScriptId(schema);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.entities.create({
						payload: {
							sandboxScriptId,
							entitySchemaSlug: schemaId,
							properties: { title: "Partial" },
							name: "Partial Provenance Entity",
						},
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe(
				"externalId and sandboxScriptId must both be provided or both be omitted",
			);
		}),
	);
});

describe("GET /entities/:id — global entity read access", () => {
	it.live("returns 200 for the importing user and for a second user who never imported", () =>
		Effect.gen(function* () {
			const { client: clientA } = yield* createAuthenticatedClient();
			const { entity } = yield* createGlobalBookEntityFixture(clientA);

			yield* insertLibraryMembership(clientA, { mediaEntityId: entity.id });
			const entityA = yield* getEntity(clientA, entity.id);
			expect(entityA.id).toBe(entity.id);

			const { client: clientB } = yield* createAuthenticatedClient();
			const entityB = yield* getEntity(clientB, entity.id);
			expect(entityB.id).toBe(entity.id);
		}),
	);
});

describe("POST /entities — enum and enum-array property schema validation", () => {
	it.live("round-trips enum and enum-array fields in propertiesSchema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const pluginSlug = createPluginScope();
			const { schemaId } = yield* createEntitySchema(client, {
				pluginSlug,
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

			const schema = yield* getEntitySchema(client, schemaId);

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
		}),
	);

	it.live("creates entity with valid enum and enum-array values", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId } = yield* createSchemaWithEnumFields(client);

			const entity = yield* createEntity(client, {
				name: "Fiction Book",
				entitySchemaSlug: schemaId,
				properties: { status: "published", genres: ["fiction", "mystery"] },
			});

			expect(entity.id).toBeDefined();
			expect(entity.name).toBe("Fiction Book");
		}),
	);

	it.live("returns 400 when enum value is not in options", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId } = yield* createSchemaWithEnumFields(client);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.entities.create({
						payload: {
							name: "Invalid Status",
							entitySchemaSlug: schemaId,
							properties: { status: "deleted" },
						},
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
		}),
	);

	it.live("returns 400 when an enum-array item is not in options", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId } = yield* createSchemaWithEnumFields(client);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.entities.create({
						payload: {
							name: "Invalid Genre",
							entitySchemaSlug: schemaId,
							properties: { genres: ["fiction", "horror"] },
						},
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
		}),
	);
});
