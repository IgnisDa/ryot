import { describe, expect, it } from "bun:test";
import {
	createEntityBody,
	createEntityDeps,
	createListedEntity,
	createNestedMetadataPropertiesSchema,
	createOptionalTitlePropertiesSchema,
	createRequiredTitlePropertiesSchema,
	createTitleAndPagesPropertiesSchema,
} from "~/lib/test-fixtures";
import { expectDataResult } from "~/lib/test-helpers";
import {
	createEntity,
	createEntityWithCollection,
	getEntityDetail,
	parseEntityProperties,
	resolveEntityCreateInput,
	resolveEntityId,
	resolveEntityName,
	resolveEntitySchemaId,
} from "./service";

describe("resolveEntityName", () => {
	it("trims the provided name", () => {
		expect(resolveEntityName("  My Entity  ")).toBe("My Entity");
	});

	it("throws when the name is blank", () => {
		expect(() => resolveEntityName("   ")).toThrow("Entity name is required");
	});
});

describe("resolveEntitySchemaId", () => {
	it("trims the provided entity schema id", () => {
		expect(resolveEntitySchemaId("  schema_123  ")).toBe("schema_123");
	});

	it("throws when the entity schema id is blank", () => {
		expect(() => resolveEntitySchemaId("   ")).toThrow(
			"Entity schema id is required",
		);
	});
});

describe("resolveEntityId", () => {
	it("trims the provided entity id", () => {
		expect(resolveEntityId("  entity_123  ")).toBe("entity_123");
	});

	it("throws when the entity id is blank", () => {
		expect(() => resolveEntityId("   ")).toThrow("Entity id is required");
	});
});

describe("parseEntityProperties", () => {
	it("validates properties against schema", () => {
		const propertiesSchema = createTitleAndPagesPropertiesSchema();

		const properties = { pages: 350, title: "My Book" };

		expect(
			parseEntityProperties({ properties, propertiesSchema }),
		).toMatchObject({ pages: 350, title: "My Book" });
	});

	it("accepts properties with optional fields missing", () => {
		const propertiesSchema = createTitleAndPagesPropertiesSchema();

		const properties = { title: "My Book" };

		expect(
			parseEntityProperties({ properties, propertiesSchema }),
		).toMatchObject({ title: "My Book" });
	});

	it("rejects properties missing required fields", () => {
		const propertiesSchema = createTitleAndPagesPropertiesSchema();

		const properties = { pages: 350 };

		expect(() =>
			parseEntityProperties({ properties, propertiesSchema }),
		).toThrow("Entity properties validation failed");
	});

	it("rejects properties with wrong type", () => {
		const propertiesSchema = createTitleAndPagesPropertiesSchema();

		const properties = {
			title: "My Book",
			pages: "not a number",
		};

		expect(() =>
			parseEntityProperties({ properties, propertiesSchema }),
		).toThrow("Entity properties validation failed");
	});

	it("rejects non-object properties", () => {
		const propertiesSchema = createOptionalTitlePropertiesSchema();

		expect(() =>
			parseEntityProperties({ properties: "not an object", propertiesSchema }),
		).toThrow("Entity properties must be a JSON object");
	});

	it("rejects array properties", () => {
		const propertiesSchema = createOptionalTitlePropertiesSchema();

		expect(() =>
			parseEntityProperties({ properties: [], propertiesSchema }),
		).toThrow("Entity properties must be a JSON object, not an array");
	});

	it("validates nested object properties", () => {
		const propertiesSchema = createNestedMetadataPropertiesSchema();

		const properties = {
			metadata: { year: 2024, author: "John Doe" },
		};

		expect(
			parseEntityProperties({ properties, propertiesSchema }),
		).toMatchObject(properties);
	});
});

describe("resolveEntityCreateInput", () => {
	it("returns normalized payload", () => {
		const propertiesSchema = createTitleAndPagesPropertiesSchema();

		expect(
			resolveEntityCreateInput({
				image: null,
				propertiesSchema,
				name: "  My Book  ",
				properties: { title: "Test Book", pages: 200 },
			}),
		).toEqual({
			image: null,
			name: "My Book",
			properties: { title: "Test Book", pages: 200 },
		});
	});

	it("accepts a remote image url", () => {
		const propertiesSchema = createRequiredTitlePropertiesSchema();

		expect(
			resolveEntityCreateInput({
				name: "Book",
				propertiesSchema,
				properties: { title: "Test Book" },
				image: { kind: "remote", url: "https://example.com/image.jpg" },
			}),
		).toEqual({
			name: "Book",
			properties: { title: "Test Book" },
			image: { kind: "remote", url: "https://example.com/image.jpg" },
		});
	});

	it("accepts an s3 image key", () => {
		const propertiesSchema = createRequiredTitlePropertiesSchema();

		expect(
			resolveEntityCreateInput({
				name: "Book",
				propertiesSchema,
				properties: { title: "Test Book" },
				image: { kind: "s3", key: "uploads/entities/entity-image-123" },
			}),
		).toEqual({
			name: "Book",
			properties: { title: "Test Book" },
			image: { kind: "s3", key: "uploads/entities/entity-image-123" },
		});
	});

	it("rejects invalid remote image urls", () => {
		const propertiesSchema = createRequiredTitlePropertiesSchema();

		expect(() =>
			resolveEntityCreateInput({
				name: "Book",
				propertiesSchema,
				properties: { title: "Test Book" },
				image: { kind: "remote", url: "not-a-url" },
			}),
		).toThrow("Entity image remote url must be a valid URL");
	});
});

describe("getEntityDetail", () => {
	it("returns not found when the entity does not exist", async () => {
		const result = await getEntityDetail(
			{ entityId: "entity_1", userId: "user_1" },
			createEntityDeps({ getEntityScopeForUser: async () => undefined }),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Entity not found",
		});
	});
});

describe("createEntity", () => {
	it("normalizes the payload before persisting", async () => {
		let createdName: string | undefined;
		const deps = createEntityDeps({
			createEntityForUser: async (input) => {
				createdName = input.name;
				return createListedEntity({
					name: input.name,
					image: input.image,
					properties: input.properties,
				});
			},
		});

		const createdEntity = expectDataResult(
			await createEntity(
				{
					userId: "user_1",
					body: {
						...createEntityBody(),
						name: "  My Book  ",
						properties: { title: "My Book" },
					},
				},
				deps,
			),
		);

		expect(createdName).toBe("My Book");
		expect(createdEntity.name).toBe("My Book");
	});

	it("returns validation when the schema is built in and no provenance is provided", async () => {
		const result = await createEntity(
			{ body: createEntityBody(), userId: "user_1" },
			createEntityDeps({
				getEntitySchemaScopeForUser: async () => ({
					userId: null,
					id: "schema_1",
					isBuiltin: true,
					propertiesSchema: { fields: {} },
				}),
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Built-in entity schemas do not support manual entity creation",
		});
	});

	it("allows creation for a built-in schema when provenance fields are provided", async () => {
		const createdEntity = createListedEntity({
			name: "Built-in Book",
			externalId: "ol:OL12345W",
			sandboxScriptId: "script_details_1",
		});
		const deps = createEntityDeps({
			getEntitySchemaScopeForUser: async () => ({
				userId: null,
				id: "schema_1",
				isBuiltin: true,
				propertiesSchema: { fields: { title: { type: "string" as const } } },
			}),
			findEntityByExternalIdForUser: async () => undefined,
			createEntityForUser: async () => createdEntity,
		});

		const result = await createEntity(
			{
				userId: "user_1",
				body: {
					...createEntityBody(),
					externalId: "ol:OL12345W",
					sandboxScriptId: "script_details_1",
				},
			},
			deps,
		);

		expect(result).toEqual({ data: createdEntity });
	});

	it("returns validation for a blank entity schema id", async () => {
		const result = await createEntity(
			{
				userId: "user_1",
				body: { ...createEntityBody(), entitySchemaId: "   " },
			},
			createEntityDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Entity schema id is required",
		});
	});

	it("returns validation when only externalId is provided without sandboxScriptId", async () => {
		const result = await createEntity(
			{
				userId: "user_1",
				body: { ...createEntityBody(), externalId: "ol:OL12345M" },
			},
			createEntityDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message:
				"externalId and sandboxScriptId must both be provided or both be omitted",
		});
	});

	it("returns validation when only sandboxScriptId is provided without externalId", async () => {
		const result = await createEntity(
			{
				userId: "user_1",
				body: {
					...createEntityBody(),
					sandboxScriptId: "script_details_1",
				},
			},
			createEntityDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message:
				"externalId and sandboxScriptId must both be provided or both be omitted",
		});
	});

	it("returns the existing entity without inserting when provenance fields match", async () => {
		const existingEntity = createListedEntity({
			id: "entity_existing",
			externalId: "ol:OL12345M",
			sandboxScriptId: "script_details_1",
		});
		let createCalled = false;
		const deps = createEntityDeps({
			findEntityByExternalIdForUser: async () => existingEntity,
			createEntityForUser: async (input) => {
				createCalled = true;
				return createListedEntity({ name: input.name });
			},
		});

		const result = await createEntity(
			{
				userId: "user_1",
				body: {
					...createEntityBody(),
					externalId: "ol:OL12345M",
					sandboxScriptId: "script_details_1",
				},
			},
			deps,
		);

		expect(createCalled).toBe(false);
		expect(result).toEqual({ data: existingEntity });
	});

	it("creates a new entity with provenance fields when no matching entity exists", async () => {
		let capturedInput: Parameters<typeof createEntityBody>[0] | undefined;
		const deps = createEntityDeps({
			findEntityByExternalIdForUser: async () => undefined,
			createEntityForUser: async (input) => {
				capturedInput = input as unknown as Parameters<
					typeof createEntityBody
				>[0];
				return createListedEntity({
					name: input.name,
					externalId: input.externalId ?? null,
					sandboxScriptId: input.sandboxScriptId ?? null,
				});
			},
		});

		const result = expectDataResult(
			await createEntity(
				{
					userId: "user_1",
					body: {
						...createEntityBody(),
						externalId: "ol:OL99999M",
						sandboxScriptId: "script_details_1",
					},
				},
				deps,
			),
		);

		expect(capturedInput).toBeDefined();
		expect(result.externalId).toBe("ol:OL99999M");
		expect(result.sandboxScriptId).toBe("script_details_1");
	});
});

describe("createEntityWithCollection", () => {
	it("creates an entity and adds it to a collection atomically", async () => {
		const deps = createEntityDeps();

		const result = expectDataResult(
			await createEntityWithCollection(
				{
					userId: "user_1",
					body: {
						...createEntityBody(),
						collectionId: "collection_1",
					},
				},
				deps,
			),
		);

		expect(result.entity.name).toBe("My Book");
		expect(result.entity.entitySchemaId).toBe("schema_1");
		expect(result.membership.collection.relType).toBe("collection");
		expect(result.membership.memberOf.relType).toBe("member_of");
		expect(result.membership.collection.sourceEntityId).toBe("collection_1");
		expect(result.membership.memberOf.targetEntityId).toBe("collection_1");
	});

	it("returns validation error when collectionId is not provided", async () => {
		const result = await createEntityWithCollection(
			{
				userId: "user_1",
				body: {
					...createEntityBody(),
					collectionId: undefined as unknown as string,
				},
			},
			createEntityDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Collection id is required",
		});
	});

	it("returns validation when only externalId is provided without sandboxScriptId", async () => {
		const result = await createEntityWithCollection(
			{
				userId: "user_1",
				body: {
					...createEntityBody(),
					externalId: "ol:OL12345M",
					collectionId: "collection_1",
				},
			},
			createEntityDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message:
				"externalId and sandboxScriptId must both be provided or both be omitted",
		});
	});

	it("returns validation when only sandboxScriptId is provided without externalId", async () => {
		const result = await createEntityWithCollection(
			{
				userId: "user_1",
				body: {
					...createEntityBody(),
					sandboxScriptId: "script_details_1",
					collectionId: "collection_1",
				},
			},
			createEntityDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message:
				"externalId and sandboxScriptId must both be provided or both be omitted",
		});
	});

	it("returns validation for built-in schema without provenance", async () => {
		const result = await createEntityWithCollection(
			{
				body: { ...createEntityBody(), collectionId: "collection_1" },
				userId: "user_1",
			},
			createEntityDeps({
				getEntitySchemaScopeForUser: async () => ({
					userId: null,
					id: "schema_1",
					isBuiltin: true,
					propertiesSchema: { fields: {} },
				}),
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Built-in entity schemas do not support manual entity creation",
		});
	});

	it("allows creation for built-in schema when provenance fields are provided", async () => {
		const deps = createEntityDeps({
			getEntitySchemaScopeForUser: async () => ({
				userId: null,
				id: "schema_1",
				isBuiltin: true,
				propertiesSchema: { fields: { title: { type: "string" as const } } },
			}),
			findEntityByExternalIdForUser: async () => undefined,
		});

		const result = expectDataResult(
			await createEntityWithCollection(
				{
					userId: "user_1",
					body: {
						...createEntityBody(),
						externalId: "ol:OL12345W",
						sandboxScriptId: "script_details_1",
						collectionId: "collection_1",
					},
				},
				deps,
			),
		);

		expect(result.entity.externalId).toBe("ol:OL12345W");
		expect(result.entity.sandboxScriptId).toBe("script_details_1");
		expect(result.membership.collection.relType).toBe("collection");
	});

	it("returns validation when entity already exists with same provenance", async () => {
		const existingEntity = createListedEntity({
			id: "entity_existing",
			externalId: "ol:OL12345M",
			sandboxScriptId: "script_details_1",
		});
		const deps = createEntityDeps({
			getEntitySchemaScopeForUser: async () => ({
				userId: null,
				id: "schema_1",
				isBuiltin: true,
				propertiesSchema: { fields: { title: { type: "string" as const } } },
			}),
			findEntityByExternalIdForUser: async () => existingEntity,
		});

		const result = await createEntityWithCollection(
			{
				userId: "user_1",
				body: {
					...createEntityBody(),
					externalId: "ol:OL12345M",
					sandboxScriptId: "script_details_1",
					collectionId: "collection_1",
				},
			},
			deps,
		);

		expect(result).toEqual({
			error: "validation",
			message: "Entity already exists",
		});
	});

	it("returns not found when entity schema does not exist", async () => {
		const result = await createEntityWithCollection(
			{
				body: { ...createEntityBody(), collectionId: "collection_1" },
				userId: "user_1",
			},
			createEntityDeps({
				getEntitySchemaScopeForUser: async () => undefined,
			}),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Entity schema not found",
		});
	});

	it("passes membership properties to the repository", async () => {
		let capturedMembershipProps: Record<string, unknown> | undefined;
		const deps = createEntityDeps({
			createEntityAndAddToCollection: async (input) => {
				capturedMembershipProps = input.membershipProperties;
				return {
					entity: createListedEntity({
						name: input.name,
						image: input.image,
						properties: input.properties,
					}),
					membership: {
						collection: {
							id: "rel-1",
							relType: "collection",
							createdAt: new Date().toISOString(),
							sourceEntityId: input.collectionId,
							targetEntityId: "entity-new",
							properties: input.membershipProperties ?? {},
						},
						memberOf: {
							id: "rel-2",
							relType: "member_of",
							createdAt: new Date().toISOString(),
							sourceEntityId: "entity-new",
							targetEntityId: input.collectionId,
							properties: input.membershipProperties ?? {},
						},
					},
				};
			},
		});

		const membershipProperties = { rating: 5, notes: "Excellent" };

		expectDataResult(
			await createEntityWithCollection(
				{
					userId: "user_1",
					body: {
						...createEntityBody(),
						collectionId: "collection_1",
						membershipProperties,
					},
				},
				deps,
			),
		);

		expect(capturedMembershipProps).toEqual(membershipProperties);
	});

	it("returns not found when collection does not exist or belong to user", async () => {
		const result = await createEntityWithCollection(
			{
				userId: "user_1",
				body: {
					...createEntityBody(),
					collectionId: "other_users_collection",
				},
			},
			createEntityDeps({
				getCollectionById: async () => undefined,
			}),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Collection not found",
		});
	});

	it("returns validation when membership properties are invalid", async () => {
		const result = await createEntityWithCollection(
			{
				userId: "user_1",
				body: {
					...createEntityBody(),
					collectionId: "collection_1",
					membershipProperties: { invalidField: "value" },
				},
			},
			createEntityDeps({
				getCollectionById: async () => ({
					id: "collection_1",
					name: "My Collection",
					createdAt: new Date(),
					updatedAt: new Date(),
					entitySchemaId: "collection_schema_1",
					image: null,
					externalId: null,
					properties: {
						membershipPropertiesSchema: {
							fields: {
								rating: { type: "number" },
							},
							required: ["rating"],
						},
					},
					sandboxScriptId: null,
				}),
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: expect.stringContaining(
				"Membership properties validation failed",
			),
		});
	});

	it("succeeds when membership properties are valid", async () => {
		const deps = createEntityDeps({
			getCollectionById: async () => ({
				id: "collection_1",
				name: "My Collection",
				createdAt: new Date(),
				updatedAt: new Date(),
				entitySchemaId: "collection_schema_1",
				image: null,
				externalId: null,
				properties: {
					membershipPropertiesSchema: {
						fields: {
							rating: { type: "number" },
						},
						required: ["rating"],
					},
				},
				sandboxScriptId: null,
			}),
		});

		const result = expectDataResult(
			await createEntityWithCollection(
				{
					userId: "user_1",
					body: {
						...createEntityBody(),
						collectionId: "collection_1",
						membershipProperties: { rating: 5 },
					},
				},
				deps,
			),
		);

		expect(result.entity.name).toBe("My Book");
		expect(result.membership.collection.relType).toBe("collection");
	});
});
