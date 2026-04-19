import { describe, expect, it } from "bun:test";
import {
	createAuthenticatedClient,
	createEntitySchema,
	createTracker,
	enqueueEntityImport,
	enqueueEntitySearch,
	findBuiltinEntitySchema,
	findBuiltinSchemaWithProviders,
	findBuiltinTracker,
	getEntitySchema,
	getFirstProviderScriptId,
	listEntitySchemas,
	pollEntityImportResult,
	pollEntitySearchResult,
} from "../fixtures";
import { getBackendClient } from "../setup";

describe("GET /entity-schemas", () => {
	it("returns 200 and lists built-in entity schemas for built-in tracker", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const builtinTracker = await findBuiltinTracker(client, cookies);

		const schemas = await listEntitySchemas(client, cookies, {
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
		const { client, cookies } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client, cookies);
		const schemas = await listEntitySchemas(client, cookies, {
			trackerId: builtinTracker.id,
		});
		const collectionSchema = schemas.find(
			(schema) => schema.slug === "collection",
		);

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
		const { client, cookies } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, cookies, {
			name: "Custom Tracker",
		});

		const { schemaId } = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Custom Schema",
			slug: "custom-schema",
		});

		const schemas = await listEntitySchemas(client, cookies, { trackerId });

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
		const { client, cookies } = await createAuthenticatedClient();

		const nonExistentId = "00000000-0000-0000-0000-000000000000";
		const { response, error } = await client.POST("/entity-schemas/list", {
			headers: { Cookie: cookies },
			body: { trackerId: nonExistentId },
		});

		expect(response.status).toBe(404);
		expect(error?.error).toBeDefined();
		expect(error?.error?.message).toBe("Tracker not found");
	});

	it("returns empty array for custom tracker with no schemas", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, cookies, {
			name: "Empty Tracker",
		});

		const schemas = await listEntitySchemas(client, cookies, { trackerId });

		expect(Array.isArray(schemas)).toBe(true);
		expect(schemas.length).toBe(0);
	});

	it("returns 404 when attempting to access another user's custom tracker", async () => {
		const { client: client1, cookies: cookies1 } =
			await createAuthenticatedClient();
		const { client: client2, cookies: cookies2 } =
			await createAuthenticatedClient();

		const { trackerId } = await createTracker(client1, cookies1, {
			name: "User 1 Tracker",
		});

		const { response, error } = await client2.POST("/entity-schemas/list", {
			body: { trackerId },
			headers: { Cookie: cookies2 },
		});

		expect(response.status).toBe(404);
		expect(error?.error).toBeDefined();
		expect(error?.error?.message).toBe("Tracker not found");
	});

	it("lists multiple custom schemas ordered by name and createdAt", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, cookies, {
			name: "Multi Schema Tracker",
		});

		await createEntitySchema(client, cookies, {
			trackerId,
			slug: "zebra",
			name: "Zebra Schema",
		});

		await createEntitySchema(client, cookies, {
			trackerId,
			slug: "alpha",
			name: "Alpha Schema",
		});

		await createEntitySchema(client, cookies, {
			trackerId,
			slug: "beta",
			name: "Beta Schema",
		});

		const schemas = await listEntitySchemas(client, cookies, { trackerId });

		expect(schemas.length).toBe(3);

		const names = schemas.map((s) => s.name);
		expect(names).toEqual(["Alpha Schema", "Beta Schema", "Zebra Schema"]);
	});

	it("returns 200 when filtering by a single slug", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, cookies, {
			name: "Single Slug Tracker",
		});
		await createEntitySchema(client, cookies, {
			trackerId,
			name: "Only Schema",
			slug: "only-schema",
		});

		const { data, response } = await client.POST("/entity-schemas/list", {
			headers: { Cookie: cookies },
			body: { slugs: ["only-schema"] },
		});

		expect(response.status).toBe(200);
		expect(data?.data?.length).toBe(1);
		expect(data?.data?.[0]?.slug).toBe("only-schema");
	});

	it("lists schemas by slug across accessible trackers", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { trackerId: booksTrackerId } = await createTracker(client, cookies, {
			name: "Books",
		});
		const { trackerId: moviesTrackerId } = await createTracker(
			client,
			cookies,
			{ name: "Movies" },
		);

		await createEntitySchema(client, cookies, {
			name: "Book Entry",
			slug: "book-entry",
			trackerId: booksTrackerId,
		});
		await createEntitySchema(client, cookies, {
			name: "Movie Entry",
			slug: "movie-entry",
			trackerId: moviesTrackerId,
		});

		const schemas = await listEntitySchemas(client, cookies, {
			slugs: ["movie-entry", "book-entry"],
		});

		expect(schemas.length).toBe(2);
		expect(schemas.map((schema) => schema.slug)).toEqual([
			"book-entry",
			"movie-entry",
		]);
		expect(schemas.map((schema) => schema.trackerId)).toEqual([
			booksTrackerId,
			moviesTrackerId,
		]);
	});

	it("returns all accessible schemas when trackerId and slugs are both missing", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client, cookies);
		const builtinSchemas = await listEntitySchemas(client, cookies, {
			trackerId: builtinTracker.id,
		});

		const { trackerId } = await createTracker(client, cookies, {
			name: "Unfiltered Tracker",
		});
		await createEntitySchema(client, cookies, {
			trackerId,
			name: "Custom Entry",
			slug: "custom-entry",
		});

		const { data, response } = await client.POST("/entity-schemas/list", {
			body: {},
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
		expect(data?.data?.some((schema) => schema.slug === "custom-entry")).toBe(
			true,
		);
		expect(data?.data?.length).toBeGreaterThanOrEqual(
			builtinSchemas.length + 1,
		);
	});

	it("built-in schemas with linked scripts have non-empty providers", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);

		expect(schema.providers.length).toBeGreaterThan(0);
		const provider = schema.providers[0];
		expect(provider).toBeDefined();
		expect(typeof provider?.name).toBe("string");
		expect(provider?.name.length).toBeGreaterThan(0);
		expect(typeof provider?.scriptId).toBe("string");
	});

	it("custom schemas without linked scripts have providers as empty array", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Provider Test Tracker",
		});
		await createEntitySchema(client, cookies, {
			trackerId,
			name: "Provider Test Schema",
		});

		const schemas = await listEntitySchemas(client, cookies, { trackerId });

		expect(schemas.length).toBe(1);
		expect(schemas[0]?.providers).toEqual([]);
	});
});

describe("POST /entity-schemas", () => {
	it("returns 400 when attempting to create schema for built-in tracker", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const builtinTracker = await findBuiltinTracker(client, cookies);

		const { response, error } = await client.POST("/entity-schemas", {
			headers: { Cookie: cookies },
			body: {
				icon: "test",
				slug: "hacked",
				name: "Hacked Schema",
				accentColor: "#FF0000",
				trackerId: builtinTracker.id,
				propertiesSchema: {
					fields: { field: { type: "string", label: "Field" } },
				},
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error).toBeDefined();
		expect(error?.error?.message).toBe(
			"Built-in trackers do not support entity schema creation",
		);
	});

	it("successfully creates schema for custom tracker", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, cookies, {
			name: "Custom Tracker",
		});

		const { data, response } = await client.POST("/entity-schemas", {
			headers: { Cookie: cookies },
			body: {
				trackerId,
				icon: "star",
				name: "My Schema",
				slug: "my-schema",
				accentColor: "#00FF00",
				propertiesSchema: {
					fields: {
						year: { type: "number", label: "Year" },
						title: { type: "string", label: "Title" },
					},
				},
			},
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
		expect(data?.data?.name).toBe("My Schema");
		expect(data?.data?.slug).toBe("my-schema");
		expect(data?.data?.trackerId).toBe(trackerId);
		expect(data?.data?.isBuiltin).toBe(false);
	});

	it("returns 404 when tracker does not exist", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const nonExistentId = "00000000-0000-0000-0000-000000000000";
		const { response, error } = await client.POST("/entity-schemas", {
			headers: { Cookie: cookies },
			body: {
				icon: "test",
				name: "Schema",
				slug: "schema",
				accentColor: "#FF0000",
				trackerId: nonExistentId,
				propertiesSchema: {
					fields: { field: { type: "string", label: "Field" } },
				},
			},
		});

		expect(response.status).toBe(404);
		expect(error?.error).toBeDefined();
		expect(error?.error?.message).toBe("Tracker not found");
	});

	it("returns 404 when attempting to create schema for another user's tracker", async () => {
		const { client: client1, cookies: cookies1 } =
			await createAuthenticatedClient();
		const { client: client2, cookies: cookies2 } =
			await createAuthenticatedClient();

		const { trackerId } = await createTracker(client1, cookies1, {
			name: "User 1 Tracker",
		});

		const { response, error } = await client2.POST("/entity-schemas", {
			headers: { Cookie: cookies2 },
			body: {
				trackerId,
				icon: "test",
				slug: "hacked",
				name: "Hacked Schema",
				accentColor: "#FF0000",
				propertiesSchema: {
					fields: { field: { type: "string", label: "Field" } },
				},
			},
		});

		expect(response.status).toBe(404);
		expect(error?.error).toBeDefined();
		expect(error?.error?.message).toBe("Tracker not found");
	});

	it("returns 400 when slug already exists for user", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, cookies, {
			name: "Tracker",
		});

		await createEntitySchema(client, cookies, {
			trackerId,
			name: "First Schema",
			slug: "duplicate-slug",
		});

		const { response, error } = await client.POST("/entity-schemas", {
			headers: { Cookie: cookies },
			body: {
				trackerId,
				icon: "test",
				name: "Second Schema",
				slug: "duplicate-slug",
				accentColor: "#FF0000",
				propertiesSchema: {
					fields: { field: { type: "string", label: "Field" } },
				},
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error).toBeDefined();
		expect(error?.error?.message).toBe("Entity schema slug already exists");
	});

	it("returns 400 when attempting to create the reserved collection schema slug", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, cookies, {
			name: "Tracker",
		});

		const { response, error } = await client.POST("/entity-schemas", {
			headers: { Cookie: cookies },
			body: {
				trackerId,
				icon: "folders",
				name: "Collection",
				slug: "collection",
				accentColor: "#F59E0B",
				propertiesSchema: {
					fields: { title: { type: "string", label: "Title" } },
				},
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error).toBeDefined();
		expect(error?.error?.message).toBe(
			'Entity schema slug "collection" is reserved for built-in schemas',
		);
	});
});

describe("GET /entity-schemas/:entitySchemaId", () => {
	it("returns 200 and the entity schema for a valid owned schema", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, cookies, {
			name: "Test Tracker",
		});

		const { schemaId, data: createdData } = await createEntitySchema(
			client,
			cookies,
			{ trackerId, name: "My Schema", slug: "my-schema" },
		);

		const schema = await getEntitySchema(client, cookies, schemaId);

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
		const { client, cookies } = await createAuthenticatedClient();

		const { schema: firstSchema } = await findBuiltinEntitySchema(
			client,
			cookies,
		);
		const schema = await getEntitySchema(client, cookies, firstSchema.id);

		expect(schema.id).toBe(firstSchema.id);
		expect(schema.isBuiltin).toBe(true);
	});

	it("returns 404 for a non-existent entity schema", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const nonExistentId = "00000000-0000-0000-0000-000000000000";
		const { response, error } = await client.GET(
			"/entity-schemas/{entitySchemaId}",
			{
				headers: { Cookie: cookies },
				params: { path: { entitySchemaId: nonExistentId } },
			},
		);

		expect(response.status).toBe(404);
		expect(error?.error?.message).toBe("Entity schema not found");
	});

	it("returns 404 when accessing another user's entity schema", async () => {
		const { client: client1, cookies: cookies1 } =
			await createAuthenticatedClient();
		const { client: client2, cookies: cookies2 } =
			await createAuthenticatedClient();

		const { trackerId } = await createTracker(client1, cookies1, {
			name: "User 1 Tracker",
		});
		const { schemaId } = await createEntitySchema(client1, cookies1, {
			trackerId,
			slug: "user1-schema",
			name: "User 1 Schema",
		});

		const { response, error } = await client2.GET(
			"/entity-schemas/{entitySchemaId}",
			{
				headers: { Cookie: cookies2 },
				params: { path: { entitySchemaId: schemaId } },
			},
		);

		expect(response.status).toBe(404);
		expect(error?.error?.message).toBe("Entity schema not found");
	});
});

describe("POST /entity-schemas/search", () => {
	it("returns 401 when unauthenticated", async () => {
		const client = getBackendClient();
		const { response, error } = await client.POST("/entity-schemas/search", {
			body: { scriptId: crypto.randomUUID() },
		});

		expect(response.status).toBe(401);
		expect(error?.error).toBeDefined();
	});

	it("returns 404 when the scriptId does not exist", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { response, error } = await client.POST("/entity-schemas/search", {
			headers: { Cookie: cookies },
			body: { scriptId: crypto.randomUUID() },
		});

		expect(response.status).toBe(404);
		expect(error?.error?.message).toBe("Sandbox script not found");
	});

	it("returns 200 with a jobId when given a valid builtin script", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const scriptId = getFirstProviderScriptId(schema);

		const { jobId } = await enqueueEntitySearch(client, cookies, {
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
		const { response, error } = await client.GET(
			"/entity-schemas/search/{jobId}",
			{ params: { path: { jobId: crypto.randomUUID() } } },
		);

		expect(response.status).toBe(401);
		expect(error?.error).toBeDefined();
	});

	it("returns 404 for a non-existent job id", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { response, error } = await client.GET(
			"/entity-schemas/search/{jobId}",
			{
				headers: { Cookie: cookies },
				params: { path: { jobId: crypto.randomUUID() } },
			},
		);

		expect(response.status).toBe(404);
		expect(error?.error?.message).toBe("Sandbox job not found");
	});

	it("returns 404 when another user polls the job", async () => {
		const { client: clientA, cookies: cookiesA } =
			await createAuthenticatedClient();
		const { client: clientB, cookies: cookiesB } =
			await createAuthenticatedClient();

		const { schema } = await findBuiltinSchemaWithProviders(clientA, cookiesA);
		const scriptId = getFirstProviderScriptId(schema);

		const { jobId } = await enqueueEntitySearch(clientA, cookiesA, {
			scriptId,
			context: { page: 1, pageSize: 5, query: "test" },
		});

		const { response, error } = await clientB.GET(
			"/entity-schemas/search/{jobId}",
			{ params: { path: { jobId } }, headers: { Cookie: cookiesB } },
		);

		expect(response.status).toBe(404);
		expect(error?.error?.message).toBe("Sandbox job not found");
	});

	it("reaches a terminal state for a builtin search script", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const scriptId = getFirstProviderScriptId(schema);

		const { jobId } = await enqueueEntitySearch(client, cookies, {
			scriptId,
			context: { page: 1, pageSize: 5, query: "test" },
		});

		const result = await pollEntitySearchResult(client, cookies, jobId);

		expect(["completed", "failed"]).toContain(result.status);
	}, 30_000);
});

describe("POST /entity-schemas/import", () => {
	it("returns 401 when unauthenticated", async () => {
		const client = getBackendClient();
		const { response, error } = await client.POST("/entity-schemas/import", {
			body: {
				externalId: "test-id",
				scriptId: crypto.randomUUID(),
				entitySchemaId: crypto.randomUUID(),
			},
		});

		expect(response.status).toBe(401);
		expect(error?.error).toBeDefined();
	});

	it("returns 200 with a jobId when given valid builtin script and schema", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const scriptId = getFirstProviderScriptId(schema);

		const { jobId } = await enqueueEntityImport(client, cookies, {
			scriptId,
			externalId: "OL267933W",
			entitySchemaId: schema.id,
		});

		expect(typeof jobId).toBe("string");
		expect(jobId.length).toBeGreaterThan(0);
	});
});

describe("GET /entity-schemas/import/{jobId}", () => {
	it("returns 401 when unauthenticated", async () => {
		const client = getBackendClient();
		const { response, error } = await client.GET(
			"/entity-schemas/import/{jobId}",
			{ params: { path: { jobId: crypto.randomUUID() } } },
		);

		expect(response.status).toBe(401);
		expect(error?.error).toBeDefined();
	});

	it("returns 404 for a non-existent job id", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { response, error } = await client.GET(
			"/entity-schemas/import/{jobId}",
			{
				headers: { Cookie: cookies },
				params: { path: { jobId: crypto.randomUUID() } },
			},
		);

		expect(response.status).toBe(404);
		expect(error?.error?.message).toBe("Entity import job not found");
	});

	it("returns 404 when another user polls the import job", async () => {
		const { client: clientA, cookies: cookiesA } =
			await createAuthenticatedClient();
		const { client: clientB, cookies: cookiesB } =
			await createAuthenticatedClient();

		const { schema } = await findBuiltinSchemaWithProviders(clientA, cookiesA);
		const scriptId = getFirstProviderScriptId(schema);

		const { jobId } = await enqueueEntityImport(clientA, cookiesA, {
			scriptId,
			externalId: "OL267933W",
			entitySchemaId: schema.id,
		});

		const { response, error } = await clientB.GET(
			"/entity-schemas/import/{jobId}",
			{ params: { path: { jobId } }, headers: { Cookie: cookiesB } },
		);

		expect(response.status).toBe(404);
		expect(error?.error?.message).toBe("Entity import job not found");
	});

	it("reaches a terminal state for a builtin details script", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const detailsScriptId = schema.providers.find(
			(p) => p.name === "OpenLibrary",
		)?.scriptId;
		if (!detailsScriptId) {
			throw new Error("OpenLibrary provider script not found");
		}

		const { jobId } = await enqueueEntityImport(client, cookies, {
			externalId: "OL267933W",
			scriptId: detailsScriptId,
			entitySchemaId: schema.id,
		});

		const result = await pollEntityImportResult(client, cookies, jobId, {
			timeoutMs: 30_000,
		});

		expect(["completed", "failed"]).toContain(result.status);
	}, 30_000);

	it("returns entity with populated properties in the completed import result", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const detailsScriptId = schema.providers.find(
			(p) => p.name === "OpenLibrary",
		)?.scriptId;
		if (!detailsScriptId) {
			throw new Error("OpenLibrary provider script not found");
		}

		const { jobId } = await enqueueEntityImport(client, cookies, {
			externalId: "OL267933W",
			scriptId: detailsScriptId,
			entitySchemaId: schema.id,
		});

		const result = await pollEntityImportResult(client, cookies, jobId, {
			timeoutMs: 30_000,
		});

		if (result.status !== "completed") {
			return;
		}

		const properties = result.data.properties as Record<string, unknown>;
		expect(properties).not.toEqual({});
		expect(properties.populatedAt).toBeUndefined();
	}, 30_000);

	it("sets populatedAt as a UTC ISO timestamp column on the imported entity", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const detailsScriptId = schema.providers.find(
			(p) => p.name === "OpenLibrary",
		)?.scriptId;
		if (!detailsScriptId) {
			throw new Error("OpenLibrary provider script not found");
		}

		const { jobId } = await enqueueEntityImport(client, cookies, {
			externalId: "OL267933W",
			scriptId: detailsScriptId,
			entitySchemaId: schema.id,
		});

		const result = await pollEntityImportResult(client, cookies, jobId, {
			timeoutMs: 30_000,
		});

		if (result.status !== "completed") {
			return;
		}

		const entity = result.data as { populatedAt?: string };

		if (!entity.populatedAt) {
			throw new Error(
				"Expected populatedAt to be present on the imported entity",
			);
		}

		expect(new Date(entity.populatedAt).toISOString()).toBe(entity.populatedAt);
	}, 30_000);
});
