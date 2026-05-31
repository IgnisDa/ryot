import { describe, expect, it } from "bun:test";

import { EntitySchemaId, SandboxScriptId } from "@ryot/contract/schema/brands";

import {
	createAuthenticatedClient,
	enqueueEntityImport,
	enqueueEntitySearch,
	findBuiltinSchemaBySlug,
	findBuiltinSchemaWithProviders,
	getBackendClient,
	getFirstProviderScriptId,
	pollEntityImportResult,
	pollEntitySearchResult,
	queryInLibraryRelationship,
} from "../fixtures";
import { assertTaggedError } from "../test-support/assertions";

describe("POST /entity-schemas/search — provider entity search", () => {
	it("returns 404 when the script does not exist", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.entitySchemas.search({ payload: { scriptId: SandboxScriptId.make(crypto.randomUUID()) } }),
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
					scriptId: SandboxScriptId.make(crypto.randomUUID()),
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

			const inLibrary = await queryInLibraryRelationship(client, result.data.id, email);
			expect(inLibrary.rowCount).toBeGreaterThan(0);
		}
	}, 60_000);
});
