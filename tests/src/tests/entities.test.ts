import { describe, expect, it } from "bun:test";
import {
	createAuthenticatedClient,
	createEntity,
	createEntitySchema,
	createTracker,
	findBuiltinSchemaWithProviders,
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

	it("creates entity for a built-in schema when provenance fields are provided", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const provider = schema.providers[0];
		if (!provider) {
			throw new Error("No provider found");
		}

		const entity = await createEntity(client, cookies, {
			image: null,
			properties: {},
			name: "Built-in Book",
			entitySchemaId: schema.id,
			externalId: "ext-builtin-test",
			sandboxScriptId: provider.scriptId,
		});

		expect(entity.id).toBeDefined();
		expect(entity.externalId).toBe("ext-builtin-test");
		expect(entity.sandboxScriptId).toBe(provider.scriptId);
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

	it("accepts null values for non-required boolean fields", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const provider = schema.providers[0];
		if (!provider) {
			throw new Error("No provider found");
		}

		const entity = await createEntity(client, cookies, {
			image: null,
			entitySchemaId: schema.id,
			externalId: "null-isNsfw-test",
			name: "Entity with Null isNsfw",
			sandboxScriptId: provider.scriptId,
			properties: {
				isNsfw: null,
				genres: ["Test"],
				assets: { remoteImages: [] },
			},
		});

		expect(entity.id).toBeDefined();
	});
});
