import { describe, expect, it } from "bun:test";

import { EntitySchemaId, SandboxScriptId, TrackerId } from "@ryot/app-backend/schema/brands";

import {
	createAuthenticatedClient,
	createEntitySchema,
	createTracker,
	deleteGlobalEntityByProvenance,
	enqueueEntityImport,
	enqueueEntitySearch,
	findBuiltinEntitySchema,
	findBuiltinSchemaBySlug,
	findBuiltinSchemaWithProviders,
	findBuiltinTracker,
	getBackendClient,
	getEntitySchema,
	getFirstProviderScriptId,
	getGlobalEntityByProvenance,
	getRelationshipBySchemaSlug,
	listEntitySchemas,
	pollEntityImportResult,
	pollEntitySearchResult,
} from "../fixtures";
import {
	assertCondition,
	assertPresent,
	assertTaggedError,
	requireObjectRecord,
} from "../test-support/assertions";

describe("GET /entity-schemas", () => {
	it("returns 200 and lists built-in entity schemas for built-in tracker", async () => {
		const { client } = await createAuthenticatedClient();

		const builtinTracker = await findBuiltinTracker(client);

		const schemas = await listEntitySchemas(client, {
			trackerId: builtinTracker.id,
		});

		expect(Array.isArray(schemas)).toBe(true);
		expect(schemas.length).toBeGreaterThan(0);

		const firstSchema = schemas[0];
		expect(firstSchema?.id).toBeDefined();
		expect(firstSchema?.name).toBeDefined();
		expect(firstSchema?.slug).toBeDefined();
		expect(firstSchema?.trackerId).toBe(builtinTracker.id);
		expect(firstSchema?.isBuiltin).toBe(true);
		expect(firstSchema?.icon).toBeDefined();
		expect(firstSchema?.accentColor).toBeDefined();
		expect(firstSchema?.propertiesSchema).toBeDefined();
	});

	it("includes the built-in collection schema in the default platform", async () => {
		const { client } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client);
		const schemas = await listEntitySchemas(client, {
			trackerId: builtinTracker.id,
		});
		const collectionSchema = schemas.find((schema) => schema.slug === "collection");

		expect(collectionSchema).toBeDefined();
		expect(collectionSchema).toMatchObject({
			providers: [],
			icon: "folders",
			isBuiltin: true,
			name: "Collection",
			accentColor: "#F59E0B",
			propertiesSchema: {
				fields: {
					description: { type: "string", label: "Description" },
					membershipPropertiesSchema: {
						type: "object",
						properties: {},
						unknownKeys: "passthrough",
						label: "Membership Properties Schema",
					},
				},
			},
		});
	});

	it("returns 200 and lists custom entity schemas for custom tracker", async () => {
		const { client } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, {
			name: "Custom Tracker",
		});

		const { schemaId } = await createEntitySchema(client, {
			trackerId,
			name: "Custom Schema",
			slug: "custom-schema",
		});

		const schemas = await listEntitySchemas(client, { trackerId });

		expect(Array.isArray(schemas)).toBe(true);
		expect(schemas.length).toBe(1);

		const schema = schemas[0];
		expect(schema?.id).toBe(schemaId);
		expect(schema?.name).toBe("Custom Schema");
		expect(schema?.slug).toBe("custom-schema");
		expect(schema?.trackerId).toBe(trackerId);
		expect(schema?.isBuiltin).toBe(false);
	});

	it("returns 404 for non-existent tracker", async () => {
		const { client } = await createAuthenticatedClient();

		const nonExistentId = "00000000-0000-0000-0000-000000000000";
		const error = await client.runError((c) =>
			c.entitySchemas.list({ payload: { trackerId: TrackerId.make(nonExistentId) } }),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Tracker not found");
	});

	it("returns empty array for custom tracker with no schemas", async () => {
		const { client } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, {
			name: "Empty Tracker",
		});

		const schemas = await listEntitySchemas(client, { trackerId });

		expect(Array.isArray(schemas)).toBe(true);
		expect(schemas.length).toBe(0);
	});

	it("returns 404 when attempting to access another user's custom tracker", async () => {
		const { client: client1 } = await createAuthenticatedClient();
		const { client: client2 } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client1, {
			name: "User 1 Tracker",
		});

		const error = await client2.runError((c) => c.entitySchemas.list({ payload: { trackerId } }));

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Tracker not found");
	});

	it("lists multiple custom schemas ordered by name and createdAt", async () => {
		const { client } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, {
			name: "Multi Schema Tracker",
		});

		await createEntitySchema(client, {
			trackerId,
			slug: "zebra",
			name: "Zebra Schema",
		});

		await createEntitySchema(client, {
			trackerId,
			slug: "alpha",
			name: "Alpha Schema",
		});

		await createEntitySchema(client, {
			trackerId,
			slug: "beta",
			name: "Beta Schema",
		});

		const schemas = await listEntitySchemas(client, { trackerId });

		expect(schemas.length).toBe(3);

		const names = schemas.map((s) => s.name);
		expect(names).toEqual(["Alpha Schema", "Beta Schema", "Zebra Schema"]);
	});

	it("returns 200 when filtering by a single slug", async () => {
		const { client } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, {
			name: "Single Slug Tracker",
		});
		await createEntitySchema(client, {
			trackerId,
			name: "Only Schema",
			slug: "only-schema",
		});

		const data = await client.run((c) =>
			c.entitySchemas.list({ payload: { slugs: ["only-schema"] } }),
		);

		expect(data.length).toBe(1);
		expect(data[0]?.slug).toBe("only-schema");
	});

	it("lists schemas by slug across accessible trackers", async () => {
		const { client } = await createAuthenticatedClient();

		const { trackerId: booksTrackerId } = await createTracker(client, {
			name: "Books",
		});
		const { trackerId: moviesTrackerId } = await createTracker(client, { name: "Movies" });

		await createEntitySchema(client, {
			name: "Book Entry",
			slug: "book-entry",
			trackerId: booksTrackerId,
		});
		await createEntitySchema(client, {
			name: "Movie Entry",
			slug: "movie-entry",
			trackerId: moviesTrackerId,
		});

		const schemas = await listEntitySchemas(client, {
			slugs: ["movie-entry", "book-entry"],
		});

		expect(schemas.length).toBe(2);
		expect(schemas.map((schema) => schema.slug)).toEqual(["book-entry", "movie-entry"]);
		expect(schemas.map((schema) => schema.trackerId)).toEqual([booksTrackerId, moviesTrackerId]);
	});

	it("returns all accessible schemas when trackerId and slugs are both missing", async () => {
		const { client } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client);
		const builtinSchemas = await listEntitySchemas(client, {
			trackerId: builtinTracker.id,
		});

		const { trackerId } = await createTracker(client, {
			name: "Unfiltered Tracker",
		});
		await createEntitySchema(client, {
			trackerId,
			name: "Custom Entry",
			slug: "custom-entry",
		});

		const data = await client.run((c) => c.entitySchemas.list({ payload: {} }));

		expect(data.some((schema) => schema.slug === "custom-entry")).toBe(true);
		expect(data.length).toBeGreaterThanOrEqual(builtinSchemas.length + 1);
	});

	it("built-in schemas with linked scripts have non-empty providers", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client);

		expect(schema.providers.length).toBeGreaterThan(0);
		const provider = schema.providers[0];
		expect(provider).toBeDefined();
		expect(typeof provider?.name).toBe("string");
		expect(provider?.name.length).toBeGreaterThan(0);
		expect(typeof provider?.scriptId).toBe("string");
	});

	it("custom schemas without linked scripts have providers as empty array", async () => {
		const { client } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, {
			name: "Provider Test Tracker",
		});
		await createEntitySchema(client, {
			trackerId,
			name: "Provider Test Schema",
		});

		const schemas = await listEntitySchemas(client, { trackerId });

		expect(schemas.length).toBe(1);
		expect(schemas[0]?.providers).toEqual([]);
	});
});

describe("POST /entity-schemas", () => {
	it("returns 400 when attempting to create schema for built-in tracker", async () => {
		const { client } = await createAuthenticatedClient();

		const builtinTracker = await findBuiltinTracker(client);

		const error = await client.runError((c) =>
			c.entitySchemas.create({
				payload: {
					icon: "test",
					slug: "hacked",
					name: "Hacked Schema",
					accentColor: "#FF0000",
					trackerId: builtinTracker.id,
					propertiesSchema: {
						fields: {
							field: { type: "string", label: "Field", description: "Field" },
						},
					},
				},
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toBe("Built-in trackers do not support entity schema creation");
	});

	it("successfully creates schema for custom tracker", async () => {
		const { client } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, {
			name: "Custom Tracker",
		});

		const data = await client.run((c) =>
			c.entitySchemas.create({
				payload: {
					trackerId,
					icon: "star",
					name: "My Schema",
					slug: "my-schema",
					accentColor: "#00FF00",
					propertiesSchema: {
						fields: {
							year: { type: "number", label: "Year", description: "Year" },
							title: { type: "string", label: "Title", description: "Title" },
						},
					},
				},
			}),
		);

		expect(data.name).toBe("My Schema");
		expect(data.slug).toBe("my-schema");
		expect(data.trackerId).toBe(trackerId);
		expect(data.isBuiltin).toBe(false);
	});

	it("returns 404 when tracker does not exist", async () => {
		const { client } = await createAuthenticatedClient();

		const nonExistentId = "00000000-0000-0000-0000-000000000000";
		const error = await client.runError((c) =>
			c.entitySchemas.create({
				payload: {
					icon: "test",
					name: "Schema",
					slug: "schema",
					accentColor: "#FF0000",
					trackerId: TrackerId.make(nonExistentId),
					propertiesSchema: {
						fields: {
							field: { type: "string", label: "Field", description: "Field" },
						},
					},
				},
			}),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Tracker not found");
	});

	it("returns 404 when attempting to create schema for another user's tracker", async () => {
		const { client: client1 } = await createAuthenticatedClient();
		const { client: client2 } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client1, {
			name: "User 1 Tracker",
		});

		const error = await client2.runError((c) =>
			c.entitySchemas.create({
				payload: {
					trackerId,
					icon: "test",
					slug: "hacked",
					name: "Hacked Schema",
					accentColor: "#FF0000",
					propertiesSchema: {
						fields: {
							field: { type: "string", label: "Field", description: "Field" },
						},
					},
				},
			}),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Tracker not found");
	});

	it("returns 409 when slug already exists for user", async () => {
		const { client } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, {
			name: "Tracker",
		});

		await createEntitySchema(client, {
			trackerId,
			name: "First Schema",
			slug: "duplicate-slug",
		});

		const error = await client.runError((c) =>
			c.entitySchemas.create({
				payload: {
					trackerId,
					icon: "test",
					name: "Second Schema",
					slug: "duplicate-slug",
					accentColor: "#FF0000",
					propertiesSchema: {
						fields: {
							field: { type: "string", label: "Field", description: "Field" },
						},
					},
				},
			}),
		);

		assertTaggedError(error, "Conflict");
		expect(error.message).toBe("Entity schema slug already exists");
	});

	it("returns 400 when attempting to create the reserved collection schema slug", async () => {
		const { client } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, {
			name: "Tracker",
		});

		const error = await client.runError((c) =>
			c.entitySchemas.create({
				payload: {
					trackerId,
					icon: "folders",
					name: "Collection",
					slug: "collection",
					accentColor: "#F59E0B",
					propertiesSchema: {
						fields: {
							title: { type: "string", label: "Title", description: "Title" },
						},
					},
				},
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toBe('Entity schema slug "collection" is reserved for built-in schemas');
	});
});

describe("GET /entity-schemas/:entitySchemaId", () => {
	it("returns 200 and the entity schema for a valid owned schema", async () => {
		const { client } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, {
			name: "Test Tracker",
		});

		const { schemaId, data: createdData } = await createEntitySchema(client, {
			trackerId,
			name: "My Schema",
			slug: "my-schema",
		});

		const schema = await getEntitySchema(client, schemaId);

		expect(schema.id).toBe(schemaId);
		expect(schema.name).toBe("My Schema");
		expect(schema.slug).toBe("my-schema");
		expect(schema.trackerId).toBe(trackerId);
		expect(schema.isBuiltin).toBe(false);
		expect(schema.icon).toBe(createdData.icon);
		expect(schema.accentColor).toBe(createdData.accentColor);
		expect(schema.propertiesSchema).toBeDefined();
	});

	it("returns 200 for a built-in entity schema accessible to the user", async () => {
		const { client } = await createAuthenticatedClient();

		const { schema: firstSchema } = await findBuiltinEntitySchema(client);
		const schema = await getEntitySchema(client, firstSchema.id);

		expect(schema.id).toBe(firstSchema.id);
		expect(schema.isBuiltin).toBe(true);
	});

	it("returns 404 for a non-existent entity schema", async () => {
		const { client } = await createAuthenticatedClient();

		const nonExistentId = "00000000-0000-0000-0000-000000000000";
		const error = await client.runError((c) =>
			c.entitySchemas.get({ path: { entitySchemaId: EntitySchemaId.make(nonExistentId) } }),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Entity schema not found");
	});

	it("returns 404 when accessing another user's entity schema", async () => {
		const { client: client1 } = await createAuthenticatedClient();
		const { client: client2 } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client1, {
			name: "User 1 Tracker",
		});
		const { schemaId } = await createEntitySchema(client1, {
			trackerId,
			slug: "user1-schema",
			name: "User 1 Schema",
		});

		const error = await client2.runError((c) =>
			c.entitySchemas.get({ path: { entitySchemaId: schemaId } }),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Entity schema not found");
	});
});

describe("POST /entity-schemas/search", () => {
	it("returns 401 when unauthenticated", async () => {
		const client = getBackendClient();
		const error = await client.runError((c) =>
			c.entitySchemas.search({ payload: { scriptId: SandboxScriptId.make(crypto.randomUUID()) } }),
		);

		assertTaggedError(error, "Unauthorized");
	});

	it("returns 404 when the scriptId does not exist", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.entitySchemas.search({ payload: { scriptId: SandboxScriptId.make(crypto.randomUUID()) } }),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Sandbox script not found");
	});

	it("returns 200 with a jobId when given a valid builtin script", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client);
		const scriptId = getFirstProviderScriptId(schema);

		const { jobId } = await enqueueEntitySearch(client, {
			scriptId,
			context: { page: 1, pageSize: 5, query: "test" },
		});

		expect(typeof jobId).toBe("string");
		expect(jobId.length).toBeGreaterThan(0);
	});
});

describe("GET /entity-schemas/search/{jobId}", () => {
	it("returns 401 when unauthenticated", async () => {
		const client = getBackendClient();
		const error = await client.runError((c) =>
			c.entitySchemas.getSearchResult({ path: { jobId: crypto.randomUUID() } }),
		);

		assertTaggedError(error, "Unauthorized");
	});

	it("returns 404 for a non-existent job id", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.entitySchemas.getSearchResult({ path: { jobId: crypto.randomUUID() } }),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Sandbox job not found");
	});

	it("returns 404 when another user polls the job", async () => {
		const { client: clientA } = await createAuthenticatedClient();
		const { client: clientB } = await createAuthenticatedClient();

		const { schema } = await findBuiltinSchemaWithProviders(clientA);
		const scriptId = getFirstProviderScriptId(schema);

		const { jobId } = await enqueueEntitySearch(clientA, {
			scriptId,
			context: { page: 1, pageSize: 5, query: "test" },
		});

		const error = await clientB.runError((c) =>
			c.entitySchemas.getSearchResult({ path: { jobId } }),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Sandbox job not found");
	});

	it("reaches a terminal state for a builtin search script", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client);
		const scriptId = getFirstProviderScriptId(schema);

		const { jobId } = await enqueueEntitySearch(client, {
			scriptId,
			context: { page: 1, pageSize: 5, query: "test" },
		});

		const result = await pollEntitySearchResult(client, jobId);

		expect(["completed", "failed"]).toContain(result.status);
	}, 30_000);
});

describe("POST /entity-import", () => {
	it("returns 401 when unauthenticated", async () => {
		const client = getBackendClient();
		const error = await client.runError((c) =>
			c.entityImport.import({
				payload: {
					externalId: "test-id",
					scriptId: SandboxScriptId.make(crypto.randomUUID()),
					entitySchemaId: EntitySchemaId.make(crypto.randomUUID()),
				},
			}),
		);

		assertTaggedError(error, "Unauthorized");
	});

	it("returns 200 with a jobId when given valid builtin script and schema", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client);
		const scriptId = getFirstProviderScriptId(schema);

		const { jobId } = await enqueueEntityImport(client, {
			scriptId,
			externalId: "OL267933W",
			entitySchemaId: schema.id,
		});

		expect(typeof jobId).toBe("string");
		expect(jobId.length).toBeGreaterThan(0);
	});
});

describe("GET /entity-import/{jobId}", () => {
	it("returns 401 when unauthenticated", async () => {
		const client = getBackendClient();
		const error = await client.runError((c) =>
			c.entityImport.getImportResult({ path: { jobId: crypto.randomUUID() } }),
		);

		assertTaggedError(error, "Unauthorized");
	});

	it("returns 404 for a non-existent job id", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.entityImport.getImportResult({ path: { jobId: crypto.randomUUID() } }),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Entity import job not found");
	});

	it("returns 404 when another user polls the import job", async () => {
		const { client: clientA } = await createAuthenticatedClient();
		const { client: clientB } = await createAuthenticatedClient();

		const { schema } = await findBuiltinSchemaWithProviders(clientA);
		const scriptId = getFirstProviderScriptId(schema);

		const { jobId } = await enqueueEntityImport(clientA, {
			scriptId,
			externalId: "OL267933W",
			entitySchemaId: schema.id,
		});

		const error = await clientB.runError((c) =>
			c.entityImport.getImportResult({ path: { jobId } }),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Entity import job not found");
	});

	it("reaches a terminal state for a builtin details script", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client);
		const detailsScriptId = schema.providers.find((p) => p.name === "OpenLibrary")?.scriptId;
		assertPresent(detailsScriptId, "OpenLibrary provider script not found");

		const { jobId } = await enqueueEntityImport(client, {
			externalId: "OL267933W",
			scriptId: detailsScriptId,
			entitySchemaId: schema.id,
		});

		const result = await pollEntityImportResult(client, jobId, {
			timeoutMs: 30_000,
		});

		expect(["completed", "failed"]).toContain(result.status);
	}, 30_000);

	it("returns entity with populated properties in the completed import result", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(client, "anime");
		const detailsScriptId = schema.providers.find((p) => p.name === "Anilist")?.scriptId;
		assertPresent(detailsScriptId, "Anilist provider script not found");

		const { schema: companySchema } = await findBuiltinSchemaBySlug(client, "company");
		const companyScriptId = companySchema.providers.find((p) => p.name === "Anilist")?.scriptId;
		assertPresent(companyScriptId, "Anilist company provider script not found");

		await deleteGlobalEntityByProvenance({
			externalId: "14",
			entitySchemaId: companySchema.id,
			sandboxScriptId: companyScriptId,
		});
		await deleteGlobalEntityByProvenance({
			externalId: "1",
			entitySchemaId: schema.id,
			sandboxScriptId: detailsScriptId,
		});

		const { jobId } = await enqueueEntityImport(client, {
			externalId: "1",
			scriptId: detailsScriptId,
			entitySchemaId: schema.id,
		});

		const result = await pollEntityImportResult(client, jobId, {
			timeoutMs: 30_000,
		});

		assertCondition(
			result.status === "completed",
			`Expected import job to complete, got '${result.status}'`,
		);

		const properties = requireObjectRecord(
			result.data.properties,
			"Expected imported entity properties to be an object",
		);
		expect(properties).not.toEqual({});
		expect(properties.studios).toBeUndefined();
		expect(properties.populatedAt).toBeUndefined();

		const relatedEntity = await getGlobalEntityByProvenance({
			externalId: "14",
			entitySchemaId: companySchema.id,
			sandboxScriptId: companyScriptId,
		});
		expect(relatedEntity.name).toBe("Sunrise");
		expect(relatedEntity.populatedAt).toBeNull();

		const relationship = await getRelationshipBySchemaSlug(client, {
			relationshipSchemaSlug: "company-to-anime",
			sourceEntityId: relatedEntity.id,
			targetEntityId: result.data.id,
		});
		expect(relationship.sourceEntityId).toBe(relatedEntity.id);
		expect(relationship.targetEntityId).toBe(result.data.id);
		expect(relationship.properties).toMatchObject({ roles: ["Animation Studio"] });
	}, 30_000);

	it("sets populatedAt as a UTC ISO timestamp column on the imported entity", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(client, "anime");
		const detailsScriptId = schema.providers.find((p) => p.name === "Anilist")?.scriptId;
		assertPresent(detailsScriptId, "Anilist provider script not found");

		const { jobId } = await enqueueEntityImport(client, {
			externalId: "1",
			scriptId: detailsScriptId,
			entitySchemaId: schema.id,
		});

		const result = await pollEntityImportResult(client, jobId, {
			timeoutMs: 30_000,
		});

		assertCondition(
			result.status === "completed",
			`Expected import job to complete, got '${result.status}'`,
		);

		const populatedAt = result.data.populatedAt;

		assertPresent(populatedAt, "Expected populatedAt to be present on the imported entity");
		expect(typeof populatedAt).toBe("string");
		expect(new Date(populatedAt).toISOString()).toBe(populatedAt);
	}, 30_000);
});
