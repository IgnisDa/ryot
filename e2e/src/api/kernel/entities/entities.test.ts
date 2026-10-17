import { Effect } from "effect";

import {
	type Client,
	createAuthenticatedClient,
	createEntity,
	createEntitySchema,
	createPluginSchema,
	createPluginScope,
	fakeProviderDetailsResult,
	getEntity,
	getEntitySchema,
	installTestProvider,
	testProviderEntitySchema,
	uninstallTestProvider,
} from "~/fixtures/kernel";
import { findFitnessEntitySchema } from "~/fixtures/plugins/fitness";
import {
	createGlobalBookEntityFixture,
	findBuiltinSchemaWithProviders,
	insertLibraryMembership,
} from "~/fixtures/plugins/media";
import { assertPresent, assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const createPrivateProvider = Effect.fn("createPrivateProvider")(function* (client: Client) {
	const provider = yield* Effect.acquireRelease(
		installTestProvider({
			client,
			rootEntitySchemaSlug: `record-${crypto.randomUUID()}`,
			details: fakeProviderDetailsResult({ name: "External Entity" }),
		}),
		uninstallTestProvider,
	);
	return { providerId: provider.providerId, reference: testProviderEntitySchema(provider) };
});

const createSchemaWithEnumFields = (client: Client) =>
	Effect.gen(function* () {
		const pluginSlug = createPluginScope();
		const { reference } = yield* createEntitySchema(client, {
			pluginSlug,
			name: "Enum Schema",
			propertiesSchema: {
				fields: {
					status: {
						label: "Status",
						type: "enum" as const,
						description: "Status",
						choices: {
							kind: "static",
							values: [{ value: "draft" }, { value: "published" }, { value: "archived" }],
						},
					},
					genres: {
						label: "Genres",
						description: "Genres",
						type: "enum-array" as const,
						choices: {
							kind: "static",
							values: [{ value: "fiction" }, { value: "non-fiction" }, { value: "mystery" }],
						},
					},
				},
			},
		});
		return { reference };
	});

describe("POST /entities", () => {
	it.live("creates entity normally when no provenance fields are provided", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { reference } = yield* createPluginSchema(client);

			const entity = yield* createEntity(client, {
				name: "Plain Entity",
				entitySchema: reference,
				properties: { title: "Plain Entity" },
			});

			expect(entity.id).toBeDefined();
			expect(entity.name).toBe("Plain Entity");
			expect(entity.externalId).toBeNull();
			expect(entity.providerId).toBeNull();
		}),
	);

	it.live("creates entity with externalId and providerId", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { reference, providerId } = yield* createPrivateProvider(client);
			const externalId = `external-${crypto.randomUUID()}`;

			const entity = yield* createEntity(client, {
				providerId,
				externalId,
				properties: {},
				name: "External Entity",
				entitySchema: reference,
			});

			expect(entity.id).toBeDefined();
			expect(entity.externalId).toBe(externalId);
			expect(entity.providerId).toBe(providerId);
		}),
	);

	it.live("returns the existing entity on duplicate externalId + providerId", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { reference, providerId } = yield* createPrivateProvider(client);
			const externalId = `idempotent-${crypto.randomUUID()}`;

			const first = yield* createEntity(client, {
				providerId,
				externalId,
				properties: {},
				entitySchema: reference,
				name: "Idempotent Entity",
			});

			const second = yield* createEntity(client, {
				providerId,
				externalId,
				properties: {},
				entitySchema: reference,
				name: "Idempotent Entity",
			});

			expect(second.id).toBe(first.id);
		}),
	);

	it.live("rejects system provider provenance for a user-scoped creation", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const externalId = `global-conflict-${crypto.randomUUID()}`;
			const { schema, entity: global } = yield* createGlobalBookEntityFixture(client, {
				externalId,
			});
			const providerId = schema.providers[0]?.providerId;
			assertPresent(providerId, "Expected a provider for the built-in schema");

			const error = yield* Effect.flip(
				createEntity(client, {
					externalId,
					providerId,
					properties: {},
					name: "User Owned Book",
					entitySchema: schema.reference,
				}),
			);

			assertTaggedError(error, "EntityBadRequest");
			expect(error.reason).toEqual({ code: "provider-scope-mismatch" });
			expect(yield* getEntity(client, global.id)).toMatchObject({
				externalId,
				providerId,
				name: global.name,
			});
		}),
	);

	it.live("creates an entity for a built-in schema without provider provenance", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaWithProviders(client);

			const entity = yield* createEntity(client, {
				properties: {},
				name: "Built-in Book",
				entitySchema: schema.reference,
			});

			expect(entity.id).toBeDefined();
			expect(entity.name).toBe("Built-in Book");
			expect(entity.entitySchemaSlug).toBe(schema.id);
			expect(entity.externalId).toBeNull();
			expect(entity.providerId).toBeNull();
		}),
	);

	it.live("creates a built-in workout entity through the generic entity endpoint", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findFitnessEntitySchema(client, "workout");

			const entity = yield* createEntity(client, {
				name: "Push Day",
				entitySchema: schema.reference,
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

	it.live("returns 400 when only externalId is provided without providerId", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { reference } = yield* createPluginSchema(client);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.entities.create({
						payload: {
							entitySchema: reference,
							externalId: "ext-partial",
							properties: { title: "Partial" },
							name: "Partial Provenance Entity",
						},
					}),
				),
			);

			assertTaggedError(error, "EntityBadRequest");
			expect(error.reason).toEqual({
				code: "incomplete-provenance",
				fields: ["externalId", "providerId"],
			});
		}),
	);

	it.live("returns 400 when only providerId is provided without externalId", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { reference } = yield* createPluginSchema(client);
			const { schema } = yield* findBuiltinSchemaWithProviders(client);
			const providerId = schema.providers[0]?.providerId;
			assertPresent(providerId, "Expected a provider for the built-in schema");

			const error = yield* Effect.flip(
				client.call((c) =>
					c.entities.create({
						payload: {
							providerId,
							entitySchema: reference,
							properties: { title: "Partial" },
							name: "Partial Provenance Entity",
						},
					}),
				),
			);

			assertTaggedError(error, "EntityBadRequest");
			expect(error.reason).toEqual({
				code: "incomplete-provenance",
				fields: ["externalId", "providerId"],
			});
		}),
	);
});

describe("global entity read access", () => {
	it.live(
		"returns the entity for the importing user and for a second user who never imported",
		() =>
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
			const { reference } = yield* createEntitySchema(client, {
				pluginSlug,
				name: "Round-trip Schema",
				propertiesSchema: {
					fields: {
						status: {
							label: "Status",
							type: "enum" as const,
							description: "Status",
							choices: { kind: "static", values: [{ value: "draft" }, { value: "published" }] },
						},
						genres: {
							label: "Genres",
							description: "Genres",
							type: "enum-array" as const,
							choices: { kind: "static", values: [{ value: "fiction" }, { value: "mystery" }] },
						},
					},
				},
			});

			const schema = yield* getEntitySchema(client, reference);

			expect(schema.propertiesSchema.fields.status).toMatchObject({
				type: "enum",
				label: "Status",
				description: "Status",
				choices: { kind: "static", values: [{ value: "draft" }, { value: "published" }] },
			});
			expect(schema.propertiesSchema.fields.genres).toMatchObject({
				label: "Genres",
				type: "enum-array",
				description: "Genres",
				choices: { kind: "static", values: [{ value: "fiction" }, { value: "mystery" }] },
			});
		}),
	);

	it.live("creates entity with valid enum and enum-array values", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { reference } = yield* createSchemaWithEnumFields(client);

			const entity = yield* createEntity(client, {
				name: "Fiction Book",
				entitySchema: reference,
				properties: { status: "published", genres: ["fiction", "mystery"] },
			});

			expect(entity.id).toBeDefined();
			expect(entity.name).toBe("Fiction Book");
		}),
	);

	it.live("returns 400 when enum value is not in choices", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { reference } = yield* createSchemaWithEnumFields(client);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.entities.create({
						payload: {
							name: "Invalid Status",
							entitySchema: reference,
							properties: { status: "deleted" },
						},
					}),
				),
			);

			assertTaggedError(error, "EntityBadRequest");
			expect(error.reason).toMatchObject({ code: "invalid-properties" });
		}),
	);

	it.live("returns 400 when an enum-array item is not in choices", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { reference } = yield* createSchemaWithEnumFields(client);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.entities.create({
						payload: {
							name: "Invalid Genre",
							entitySchema: reference,
							properties: { genres: ["fiction", "horror"] },
						},
					}),
				),
			);

			assertTaggedError(error, "EntityBadRequest");
			expect(error.reason).toMatchObject({ code: "invalid-properties" });
		}),
	);
});
