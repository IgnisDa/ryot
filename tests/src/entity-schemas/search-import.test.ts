import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { EntitySchemaId, SandboxScriptId } from "@ryot/contract/schema/brands";

import {
	cleanupBuiltinProviderScript,
	createAuthenticatedClient,
	detailsDriverCode,
	enqueueEntityImport,
	enqueueEntitySearch,
	findBuiltinSchemaBySlug,
	findBuiltinSchemaWithProviders,
	getBackendClient,
	getGlobalEntityByProvenance,
	getRelationshipBySchemaSlug,
	pollEntityImportResult,
	pollEntitySearchResult,
	searchDriverCode,
	seedBuiltinProviderScript,
	type SeededProviderScript,
} from "../fixtures";
import {
	assertCompleted,
	assertPresent,
	assertTaggedError,
	requireArray,
	requireObjectRecord,
} from "../test-support/assertions";

const BOOK_IMPORT_NAME = "E2E Imported Book";
const ANIME_IMPORT_NAME = "E2E Imported Anime";
const RELATED_COMPANY_NAME = "E2E Studio";
const RELATED_COMPANY_EXTERNAL_ID = "e2e-company-1";

let bookProvider: SeededProviderScript;
let animeProvider: SeededProviderScript;
let companyProvider: SeededProviderScript;

const bookScriptId = () => SandboxScriptId.make(bookProvider.scriptId);

beforeAll(async () => {
	const { client } = await createAuthenticatedClient();
	const { schema: companySchema } = await findBuiltinSchemaBySlug(client, "company");

	companyProvider = await seedBuiltinProviderScript({
		linkToEntitySchemaId: companySchema.id,
		code: detailsDriverCode({ name: RELATED_COMPANY_NAME, properties: {} }),
	});

	animeProvider = await seedBuiltinProviderScript({
		code: detailsDriverCode({
			name: ANIME_IMPORT_NAME,
			properties: { description: "Imported anime from the e2e fake provider." },
			relatedEntityGroups: [
				{
					direction: "incoming",
					synchronization: "additive",
					relationshipSchemaSlug: "company-to-anime",
					entities: [
						{
							name: RELATED_COMPANY_NAME,
							scriptSlug: companyProvider.slug,
							externalId: RELATED_COMPANY_EXTERNAL_ID,
							relationshipProperties: { roles: ["E2E Animation Studio"] },
						},
					],
				},
			],
		}),
	});

	bookProvider = await seedBuiltinProviderScript({
		code: [
			searchDriverCode([
				{ externalId: "e2e-book-1", title: "E2E Book One", subtitle: null },
				{ externalId: "e2e-book-2", title: "E2E Book Two", subtitle: 2 },
			]),
			detailsDriverCode({
				name: BOOK_IMPORT_NAME,
				properties: { description: "Imported book from the e2e fake provider." },
			}),
		].join("\n"),
	});
});

afterAll(async () => {
	await cleanupBuiltinProviderScript(animeProvider);
	await cleanupBuiltinProviderScript(companyProvider);
	await cleanupBuiltinProviderScript(bookProvider);
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

	it("returns 200 with a jobId when given a valid script", async () => {
		const { client } = await createAuthenticatedClient();

		const { jobId } = await enqueueEntitySearch(client, {
			scriptId: bookScriptId(),
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

		const { jobId } = await enqueueEntitySearch(clientA, {
			scriptId: bookScriptId(),
			context: { page: 1, pageSize: 5, query: "test" },
		});

		const error = await clientB.runError((c) =>
			c.entitySchemas.getSearchResult({ path: { jobId } }),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Sandbox job not found");
	});

	it("completes a search and returns the seeded results", async () => {
		const { client } = await createAuthenticatedClient();

		const { jobId } = await enqueueEntitySearch(client, {
			scriptId: bookScriptId(),
			context: { page: 1, pageSize: 5, query: "test" },
		});

		const result = await pollEntitySearchResult(client, jobId, { timeoutMs: 30_000 });
		assertCompleted(result, "search job");
		const value = requireObjectRecord(result.value, "Expected search result to be an object");
		const items = requireArray(value.items, "Expected search result items to be an array");
		expect(items).toHaveLength(2);
	});
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

	it("returns 200 with a jobId when given a valid script and schema", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client);

		const { jobId } = await enqueueEntityImport(client, {
			scriptId: bookScriptId(),
			externalId: "e2e-book-1",
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

		const { jobId } = await enqueueEntityImport(clientA, {
			scriptId: bookScriptId(),
			externalId: "e2e-book-crossuser",
			entitySchemaId: schema.id,
		});

		const error = await clientB.runError((c) =>
			c.entityImport.getImportResult({ path: { jobId } }),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Entity import job not found");
	});

	it("completes an import for a valid details script", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client);

		const { jobId } = await enqueueEntityImport(client, {
			scriptId: bookScriptId(),
			externalId: "e2e-book-terminal",
			entitySchemaId: schema.id,
		});

		const result = await pollEntityImportResult(client, jobId, { timeoutMs: 30_000 });

		assertCompleted(result, "import job");
		expect(result.data.name).toBe(BOOK_IMPORT_NAME);
	});

	it("returns entity with populated properties and related entities in the completed result", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(client, "anime");
		const { schema: companySchema } = await findBuiltinSchemaBySlug(client, "company");

		const { jobId } = await enqueueEntityImport(client, {
			externalId: "e2e-anime-1",
			scriptId: SandboxScriptId.make(animeProvider.scriptId),
			entitySchemaId: schema.id,
		});

		const result = await pollEntityImportResult(client, jobId, { timeoutMs: 30_000 });

		assertCompleted(result, "import job");

		const properties = requireObjectRecord(
			result.data.properties,
			"Expected imported entity properties to be an object",
		);
		expect(properties).not.toEqual({});
		expect(properties.populatedAt).toBeUndefined();

		const relatedEntity = await getGlobalEntityByProvenance({
			entitySchemaId: companySchema.id,
			externalId: RELATED_COMPANY_EXTERNAL_ID,
			sandboxScriptId: companyProvider.scriptId,
		});
		expect(relatedEntity.name).toBe(RELATED_COMPANY_NAME);
		expect(relatedEntity.populatedAt).toBeNull();

		const relationship = await getRelationshipBySchemaSlug(client, {
			targetEntityId: result.data.id,
			sourceEntityId: relatedEntity.id,
			relationshipSchemaSlug: "company-to-anime",
		});
		expect(relationship.sourceEntityId).toBe(relatedEntity.id);
		expect(relationship.targetEntityId).toBe(result.data.id);
		expect(relationship.properties).toMatchObject({ roles: ["E2E Animation Studio"] });
	});

	it("sets populatedAt as a UTC ISO timestamp column on the imported entity", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client);

		const { jobId } = await enqueueEntityImport(client, {
			scriptId: bookScriptId(),
			entitySchemaId: schema.id,
			externalId: "e2e-book-populatedat",
		});

		const result = await pollEntityImportResult(client, jobId, { timeoutMs: 30_000 });

		assertCompleted(result, "import job");

		const populatedAt = result.data.populatedAt;

		assertPresent(populatedAt, "Expected populatedAt to be present on the imported entity");
		expect(typeof populatedAt).toBe("string");
		expect(new Date(populatedAt).toISOString()).toBe(populatedAt);
	});
});
