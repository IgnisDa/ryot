import { describe, expect, it } from "bun:test";
import {
	createAuthenticatedClient,
	createEntity,
	createEntitySchema,
	createTracker,
	findBuiltinSchemaWithProviders,
	importMedia,
	pollMediaImportResult,
} from "../fixtures";

async function createCustomSchemaFixture(
	client: Awaited<ReturnType<typeof createAuthenticatedClient>>["client"],
	cookies: string,
) {
	const { trackerId } = await createTracker(client, cookies, {
		name: "Entity Provenance Tracker",
	});
	const { schemaId } = await createEntitySchema(client, cookies, {
		trackerId,
		name: "Entity Provenance Schema",
	});
	return { schemaId };
}

describe("POST /entities", () => {
	it("creates entity normally when no provenance fields are provided", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemaId } = await createCustomSchemaFixture(client, cookies);

		const entity = await createEntity(client, cookies, {
			image: null,
			name: "Plain Entity",
			entitySchemaId: schemaId,
			properties: { title: "Plain Entity" },
		});

		expect(entity.id).toBeDefined();
		expect(entity.name).toBe("Plain Entity");
		expect(entity.externalId).toBeNull();
		expect(entity.sandboxScriptId).toBeNull();
	});

	it("creates entity with externalId and sandboxScriptId", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemaId } = await createCustomSchemaFixture(client, cookies);
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const sandboxScriptId = schema.providers[0]?.scriptId;
		if (!sandboxScriptId) {
			throw new Error("No provider found");
		}

		const entity = await createEntity(client, cookies, {
			image: null,
			externalId: "ext-001",
			sandboxScriptId,
			name: "External Entity",
			entitySchemaId: schemaId,
			properties: { title: "External Entity" },
		});

		expect(entity.id).toBeDefined();
		expect(entity.externalId).toBe("ext-001");
		expect(entity.sandboxScriptId).toBe(sandboxScriptId);
	});

	it("returns the existing entity on duplicate externalId + sandboxScriptId", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemaId } = await createCustomSchemaFixture(client, cookies);
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const sandboxScriptId = schema.providers[0]?.scriptId;
		if (!sandboxScriptId) {
			throw new Error("No provider found");
		}

		const first = await createEntity(client, cookies, {
			image: null,
			sandboxScriptId,
			entitySchemaId: schemaId,
			name: "Idempotent Entity",
			externalId: "ext-idem-001",
			properties: { title: "Idempotent Entity" },
		});

		const second = await createEntity(client, cookies, {
			image: null,
			sandboxScriptId,
			entitySchemaId: schemaId,
			name: "Idempotent Entity",
			externalId: "ext-idem-001",
			properties: { title: "Idempotent Entity" },
		});

		expect(second.id).toBe(first.id);
	});

	it("returns 400 for a built-in schema even when provenance fields are provided", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const provider = schema.providers[0];
		if (!provider) {
			throw new Error("No provider found");
		}

		const { response, error } = await client.POST("/entities", {
			headers: { Cookie: cookies },
			body: {
				image: null,
				properties: {},
				name: "Built-in Book",
				entitySchemaId: schema.id,
				externalId: "ext-builtin-test",
				sandboxScriptId: provider.scriptId,
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error?.message).toBe(
			"Built-in entity schemas do not support manual entity creation",
		);
	});

	it("returns 400 when only externalId is provided without sandboxScriptId", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemaId } = await createCustomSchemaFixture(client, cookies);

		const { response, error } = await client.POST("/entities", {
			headers: { Cookie: cookies },
			body: {
				image: null,
				entitySchemaId: schemaId,
				externalId: "ext-partial",
				properties: { title: "Partial" },
				name: "Partial Provenance Entity",
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error?.message).toBe(
			"externalId and sandboxScriptId must both be provided or both be omitted",
		);
	});

	it("returns 400 when only sandboxScriptId is provided without externalId", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemaId } = await createCustomSchemaFixture(client, cookies);
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const sandboxScriptId = schema.providers[0]?.scriptId;
		if (!sandboxScriptId) {
			throw new Error("No provider found");
		}

		const { response, error } = await client.POST("/entities", {
			headers: { Cookie: cookies },
			body: {
				image: null,
				sandboxScriptId,
				entitySchemaId: schemaId,
				properties: { title: "Partial" },
				name: "Partial Provenance Entity",
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error?.message).toBe(
			"externalId and sandboxScriptId must both be provided or both be omitted",
		);
	});
});

describe("GET /entities/:id — global entity read access", () => {
	it("returns 200 for the importing user and for a second user who never imported", async () => {
		const { client: clientA, cookies: cookiesA } =
			await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(clientA, cookiesA);
		const detailsScriptId = schema.providers[0]?.scriptId;
		if (!detailsScriptId) {
			throw new Error("No provider script found");
		}

		const { jobId } = await importMedia(clientA, cookiesA, {
			scriptId: detailsScriptId,
			identifier: "OL39858429M",
			entitySchemaId: schema.id,
		});

		const result = await pollMediaImportResult(clientA, cookiesA, jobId, {
			timeoutMs: 30_000,
		});

		// Skip if the external API is unavailable
		if (result.status === "failed") {
			console.warn(
				"[skip] media import failed — external API likely unavailable. " +
					"Verify manually if this persists.",
			);
			return;
		}

		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected media import to complete");
		}

		const entityId = result.data.id;

		const { response: responseA } = await clientA.GET("/entities/{entityId}", {
			headers: { Cookie: cookiesA },
			params: { path: { entityId } },
		});
		expect(responseA.status).toBe(200);

		const { client: clientB, cookies: cookiesB } =
			await createAuthenticatedClient();
		const { response: responseB } = await clientB.GET("/entities/{entityId}", {
			headers: { Cookie: cookiesB },
			params: { path: { entityId } },
		});
		expect(responseB.status).toBe(200);
	});
});
