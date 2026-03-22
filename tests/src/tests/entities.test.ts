import { describe, expect, it } from "bun:test";
import {
	createAuthenticatedClient,
	createEntity,
	createEntitySchema,
	createTracker,
	findBuiltinSchemaWithSearchProviders,
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
		expect(entity.detailsSandboxScriptId).toBeNull();
	});

	it("creates entity with externalId and detailsSandboxScriptId", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemaId } = await createCustomSchemaFixture(client, cookies);
		const { schema } = await findBuiltinSchemaWithSearchProviders(
			client,
			cookies,
		);
		const detailsSandboxScriptId = schema.searchProviders[0]?.detailsScriptId;
		if (!detailsSandboxScriptId) {
			throw new Error("No search provider found");
		}

		const entity = await createEntity(client, cookies, {
			image: null,
			externalId: "ext-001",
			detailsSandboxScriptId,
			name: "External Entity",
			entitySchemaId: schemaId,
			properties: { title: "External Entity" },
		});

		expect(entity.id).toBeDefined();
		expect(entity.externalId).toBe("ext-001");
		expect(entity.detailsSandboxScriptId).toBe(detailsSandboxScriptId);
	});

	it("returns the existing entity on duplicate externalId + detailsSandboxScriptId", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemaId } = await createCustomSchemaFixture(client, cookies);
		const { schema } = await findBuiltinSchemaWithSearchProviders(
			client,
			cookies,
		);
		const detailsSandboxScriptId = schema.searchProviders[0]?.detailsScriptId;
		if (!detailsSandboxScriptId) {
			throw new Error("No search provider found");
		}

		const first = await createEntity(client, cookies, {
			image: null,
			detailsSandboxScriptId,
			entitySchemaId: schemaId,
			name: "Idempotent Entity",
			externalId: "ext-idem-001",
			properties: { title: "Idempotent Entity" },
		});

		const second = await createEntity(client, cookies, {
			image: null,
			detailsSandboxScriptId,
			entitySchemaId: schemaId,
			name: "Idempotent Entity",
			externalId: "ext-idem-001",
			properties: { title: "Idempotent Entity" },
		});

		expect(second.id).toBe(first.id);
	});

	it("creates entity for a built-in schema when provenance fields are provided", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithSearchProviders(
			client,
			cookies,
		);
		const provider = schema.searchProviders[0];
		if (!provider) {
			throw new Error("No search provider found");
		}

		const entity = await createEntity(client, cookies, {
			image: null,
			properties: {},
			name: "Built-in Book",
			entitySchemaId: schema.id,
			externalId: "ext-builtin-test",
			detailsSandboxScriptId: provider.detailsScriptId,
		});

		expect(entity.id).toBeDefined();
		expect(entity.externalId).toBe("ext-builtin-test");
		expect(entity.detailsSandboxScriptId).toBe(provider.detailsScriptId);
	});

	it("returns 400 when only externalId is provided without detailsSandboxScriptId", async () => {
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
			"externalId and detailsSandboxScriptId must both be provided or both be omitted",
		);
	});

	it("returns 400 when only detailsSandboxScriptId is provided without externalId", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schemaId } = await createCustomSchemaFixture(client, cookies);
		const { schema } = await findBuiltinSchemaWithSearchProviders(
			client,
			cookies,
		);
		const detailsSandboxScriptId = schema.searchProviders[0]?.detailsScriptId;
		if (!detailsSandboxScriptId) {
			throw new Error("No search provider found");
		}

		const { response, error } = await client.POST("/entities", {
			headers: { Cookie: cookies },
			body: {
				image: null,
				detailsSandboxScriptId,
				entitySchemaId: schemaId,
				properties: { title: "Partial" },
				name: "Partial Provenance Entity",
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error?.message).toBe(
			"externalId and detailsSandboxScriptId must both be provided or both be omitted",
		);
	});
});
