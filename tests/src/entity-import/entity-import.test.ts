import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { EntitySchemaId, SandboxScriptId } from "@ryot/contract/schema/brands";

import {
	cleanupBuiltinProviderScript,
	createAuthenticatedClient,
	createSandboxScript,
	createTrackerWithSchema,
	detailsDriverCode,
	enqueueEntityImport,
	enqueueEntitySearch,
	findBuiltinSchemaBySlug,
	findBuiltinSchemaWithProviders,
	getBackendClient,
	getFirstProviderScriptId,
	pollEntityImportResult,
	pollEntitySearchResult,
	queryInLibraryRelationship,
	searchDriverCode,
	seedBuiltinProviderScript,
	type SeededProviderScript,
} from "../fixtures";
import {
	assertCompleted,
	assertTaggedError,
	requireArray,
	requireObjectRecord,
} from "../test-support/assertions";

const IMPORT_EXTERNAL_ID = "e2e-audiobook-1";
const IMPORTED_NAME = "E2E Imported Audiobook";

let providerScript: SeededProviderScript;

beforeAll(async () => {
	providerScript = await seedBuiltinProviderScript({
		code: [
			searchDriverCode([
				{ externalId: IMPORT_EXTERNAL_ID, title: "E2E Audiobook One", subtitle: null },
				{ externalId: "e2e-audiobook-2", title: "E2E Audiobook Two", subtitle: 2 },
			]),
			detailsDriverCode({
				name: IMPORTED_NAME,
				properties: { description: "Imported by the e2e fake provider." },
			}),
		].join("\n"),
	});
});

afterAll(async () => {
	await cleanupBuiltinProviderScript(providerScript);
});

describe("POST /entity-schemas/search — provider entity search", () => {
	it("returns 404 when the script does not exist", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.entitySchemas.search({
				payload: { scriptId: SandboxScriptId.make(crypto.randomUUID()) },
			}),
		);

		assertTaggedError(error, "NotFound");
	});

	it("enqueues a provider search and completes with the seeded results", async () => {
		const { client } = await createAuthenticatedClient();

		const { jobId } = await enqueueEntitySearch(client, {
			context: { query: "test", page: 1, pageSize: 5 },
			scriptId: SandboxScriptId.make(providerScript.scriptId),
		});

		const result = await pollEntitySearchResult(client, jobId);
		assertCompleted(result, "search job");
		const value = requireObjectRecord(result.value, "Expected search result to be an object");
		const items = requireArray(value.items, "Expected search result items to be an array");
		expect(items).toHaveLength(2);
	});

	it("returns 401 for unauthenticated search requests", async () => {
		const client = getBackendClient();

		const error = await client.runError((c) =>
			c.entitySchemas.search({
				payload: { scriptId: SandboxScriptId.make(crypto.randomUUID()) },
			}),
		);

		assertTaggedError(error, "Unauthorized");
	});
});

describe("POST /library/import — provider entity import", () => {
	it("returns 404 when the script does not exist", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client);

		const error = await client.runError((c) =>
			c.entityImport.import({
				payload: {
					entitySchemaId: schema.id,
					externalId: "some-external-id",
					scriptId: SandboxScriptId.make(crypto.randomUUID()),
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
			c.entityImport.import({
				payload: {
					scriptId,
					externalId: "some-external-id",
					entitySchemaId: EntitySchemaId.make(crypto.randomUUID()),
				},
			}),
		);

		assertTaggedError(error, "NotFound");
	});

	it("returns 404 for unknown import job id", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.entityImport.getImportResult({ path: { jobId: crypto.randomUUID() } }),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Entity import job not found");
	});

	it("returns 401 for unauthenticated import requests", async () => {
		const client = getBackendClient();

		const error = await client.runError((c) =>
			c.entityImport.import({
				payload: {
					externalId: "some-id",
					scriptId: SandboxScriptId.make(crypto.randomUUID()),
					entitySchemaId: EntitySchemaId.make(crypto.randomUUID()),
				},
			}),
		);

		assertTaggedError(error, "Unauthorized");
	});
});

describe("GET /library/import/:jobId — provider entity import result", () => {
	it("enqueues a provider import and adds entity to library when completed", async () => {
		const { client, email } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(client, "audiobook");

		const { jobId } = await enqueueEntityImport(client, {
			entitySchemaId: schema.id,
			externalId: IMPORT_EXTERNAL_ID,
			scriptId: SandboxScriptId.make(providerScript.scriptId),
		});

		const result = await pollEntityImportResult(client, jobId);

		assertCompleted(result, "import job");
		expect(result.data.id).toBeDefined();
		expect(result.data.name).toBe(IMPORTED_NAME);
		expect(result.data.entitySchemaId).toBe(schema.id);

		const inLibrary = await queryInLibraryRelationship(client, result.data.id, email);
		expect(inLibrary.rowCount).toBeGreaterThan(0);
	});
});

describe("POST /library/import — provider import ownership guard", () => {
	it("rejects a user-owned sandbox script with BadRequest", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(client, "audiobook");
		const userScript = await createSandboxScript(client, {
			metadata: {},
			name: `user-import-script-${crypto.randomUUID()}`,
			slug: `user-import-script-${crypto.randomUUID()}`,
			code: `driver("details", async function () { return { name: "x", properties: {} }; });`,
		});

		const error = await client.runError((c) =>
			c.entityImport.import({
				payload: {
					entitySchemaId: schema.id,
					externalId: IMPORT_EXTERNAL_ID,
					scriptId: SandboxScriptId.make(userScript.id),
				},
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toBe("Provider imports require a built-in provider script");
	});

	it("rejects a custom user-owned entity schema with BadRequest", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(client);

		// A built-in provider script passes the script guard, so the custom entity
		// schema is what the request must be rejected on.
		const error = await client.runError((c) =>
			c.entityImport.import({
				payload: {
					externalId: IMPORT_EXTERNAL_ID,
					entitySchemaId: EntitySchemaId.make(schemaId),
					scriptId: SandboxScriptId.make(providerScript.scriptId),
				},
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toBe("Provider imports require a built-in entity schema");
	});

	it("accepts a built-in schema paired with a built-in provider script", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(client, "audiobook");

		const { jobId } = await enqueueEntityImport(client, {
			entitySchemaId: schema.id,
			externalId: IMPORT_EXTERNAL_ID,
			scriptId: SandboxScriptId.make(providerScript.scriptId),
		});

		expect(typeof jobId).toBe("string");
		expect(jobId.length).toBeGreaterThan(0);
	});
});
