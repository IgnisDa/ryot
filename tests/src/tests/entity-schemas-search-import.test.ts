import { describe, expect, it } from "bun:test";

import { EntitySchemaId, SandboxScriptId } from "@ryot/contract/schema/brands";

import {
	createAuthenticatedClient,
	deleteGlobalEntityByProvenance,
	enqueueEntityImport,
	enqueueEntitySearch,
	findBuiltinSchemaBySlug,
	findBuiltinSchemaWithProviders,
	getBackendClient,
	getFirstProviderScriptId,
	getGlobalEntityByProvenance,
	getRelationshipBySchemaSlug,
	pollEntityImportResult,
	pollEntitySearchResult,
} from "../fixtures";
import {
	assertCondition,
	assertPresent,
	assertTaggedError,
	requireObjectRecord,
} from "../test-support/assertions";

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

describe("POST /library/import", () => {
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

describe("GET /library/import/{jobId}", () => {
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
