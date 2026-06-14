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
	getFirstProviderScriptId,
	pollEntityImportResult,
	pollEntitySearchResult,
	queryInLibraryRelationship,
	searchDriverCode,
	seedBuiltinProviderScript,
	type SeededProviderScript,
} from "../fixtures";
import {
	assertCondition,
	assertTaggedError,
	requireArray,
	requireObjectRecord,
} from "../test-support/assertions";

const IMPORT_EXTERNAL_ID = "e2e-audiobook-1";
const IMPORTED_NAME = "E2E Imported Audiobook";

// A fake builtin provider registering both a `search` and a `details` driver, returning fixed data
// with no network access. Search takes the scriptId directly; import pairs it with a real builtin
// entity schema (no provider link is required by the import endpoint).
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
			c.entitySchemas.search({ payload: { scriptId: SandboxScriptId.make(crypto.randomUUID()) } }),
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
		assertCondition(
			result.status === "completed",
			`Expected search job to complete, got '${result.status}'`,
		);
		const value = requireObjectRecord(result.value, "Expected search result to be an object");
		const items = requireArray(value.items, "Expected search result items to be an array");
		expect(items).toHaveLength(2);
	}, 30_000);

	it("returns 401 for unauthenticated search requests", async () => {
		const client = getBackendClient();

		const error = await client.runError((c) =>
			c.entitySchemas.search({ payload: { scriptId: SandboxScriptId.make(crypto.randomUUID()) } }),
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

		assertCondition(
			result.status === "completed",
			`Expected import job to complete, got '${result.status}'`,
		);
		expect(result.data.id).toBeDefined();
		expect(result.data.name).toBe(IMPORTED_NAME);
		expect(result.data.entitySchemaId).toBe(schema.id);

		const inLibrary = await queryInLibraryRelationship(client, result.data.id, email);
		expect(inLibrary.rowCount).toBeGreaterThan(0);
	}, 30_000);
});
