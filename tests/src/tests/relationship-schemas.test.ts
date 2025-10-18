import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createEntitySchema,
	createRelationshipSchema,
	createTracker,
	listRelationshipSchemas,
	requireRelationshipSchemaBySlug,
} from "../fixtures";
import { assertTaggedError } from "../test-support/assertions";

describe("POST /relationship-schemas/list", () => {
	it("returns seeded built-in relationship schemas by slug", async () => {
		const { client } = await createAuthenticatedClient();

		const schemas = await listRelationshipSchemas(client, { slugs: ["in-library", "member-of"] });

		expect(schemas.map((schema) => schema.slug)).toEqual(["in-library", "member-of"]);
		const inLibrary = requireRelationshipSchemaBySlug(schemas, "in-library");
		expect(inLibrary.isBuiltin).toBe(true);
		expect(inLibrary.targetEntitySchemaId).not.toBeNull();
	});

	it("lists a custom relationship schema after creation", async () => {
		const { client } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, {
			name: "Relationship Schema List Tracker",
		});
		const { schemaId } = await createEntitySchema(client, {
			trackerId,
			name: "Relationship List Entity",
			slug: "relationship-list-entity",
		});
		const slug = `list-rel-${crypto.randomUUID()}`;

		const created = await createRelationshipSchema(client, {
			name: "List Relationship",
			slug,
			sourceEntitySchemaId: schemaId,
			targetEntitySchemaId: schemaId,
			propertiesSchema: { fields: {} },
		});

		const schemas = await listRelationshipSchemas(client, { slugs: [slug] });

		expect(schemas).toHaveLength(1);
		expect(schemas[0]).toEqual(created);
	});

	it("returns 404 when filtering by another user's entity schema", async () => {
		const owner = await createAuthenticatedClient();
		const intruder = await createAuthenticatedClient();
		const { trackerId } = await createTracker(owner.client, {
			name: "Relationship Schema Owner Tracker",
		});
		const { schemaId } = await createEntitySchema(owner.client, {
			trackerId,
			name: "Owner Relationship Entity",
			slug: "owner-relationship-entity",
		});

		const error = await intruder.client.runError((c) =>
			c.relationshipSchemas.list({ payload: { sourceEntitySchemaId: schemaId } }),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Entity schema not found");
	});
});

describe("POST /relationship-schemas", () => {
	it("successfully creates a relationship schema for custom entity schemas", async () => {
		const { client } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, {
			name: "Relationship Schema Tracker",
		});
		const source = await createEntitySchema(client, {
			trackerId,
			name: "Source Entity",
			slug: "source-entity",
		});
		const target = await createEntitySchema(client, {
			trackerId,
			name: "Target Entity",
			slug: "target-entity",
		});

		const data = await createRelationshipSchema(client, {
			name: "My Relationship",
			slug: "my-relationship",
			sourceEntitySchemaId: source.schemaId,
			targetEntitySchemaId: target.schemaId,
			propertiesSchema: {
				fields: { rating: { type: "integer", label: "Rating", description: "Rating" } },
			},
		});

		expect(data.name).toBe("My Relationship");
		expect(data.slug).toBe("my-relationship");
		expect(data.isBuiltin).toBe(false);
		expect(data.sourceEntitySchemaId).toBe(source.schemaId);
		expect(data.targetEntitySchemaId).toBe(target.schemaId);
	});

	it("returns 409 when relationship schema slug already exists for user", async () => {
		const { client } = await createAuthenticatedClient();
		const slug = `duplicate-rel-${crypto.randomUUID()}`;
		await createRelationshipSchema(client, {
			name: "First Relationship",
			slug,
			propertiesSchema: { fields: {} },
		});

		const error = await client.runError((c) =>
			c.relationshipSchemas.create({
				payload: {
					slug,
					name: "Second Relationship",
					propertiesSchema: { fields: {} },
				},
			}),
		);

		assertTaggedError(error, "Conflict");
		expect(error.message).toBe("Relationship schema slug already exists");
	});

	it("returns 400 when relationship schema properties schema is invalid", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.relationshipSchemas.create({
				payload: {
					name: "Invalid Relationship",
					slug: `invalid-rel-${crypto.randomUUID()}`,
					propertiesSchema: {
						fields: { status: { type: "string", label: "Status", description: "Status" } },
						rules: [
							{
								path: ["missing"],
								kind: "validation",
								validation: { required: true },
								when: { operator: "eq", path: ["status"], value: "completed" },
							},
						],
					},
				},
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("Rule path 'missing' does not exist");
	});

	it("returns 404 when creating for another user's entity schema", async () => {
		const owner = await createAuthenticatedClient();
		const intruder = await createAuthenticatedClient();
		const { trackerId } = await createTracker(owner.client, {
			name: "Relationship Schema Create Owner Tracker",
		});
		const { schemaId } = await createEntitySchema(owner.client, {
			trackerId,
			name: "Create Owner Entity",
			slug: "create-owner-entity",
		});

		const error = await intruder.client.runError((c) =>
			c.relationshipSchemas.create({
				payload: {
					name: "Intruder Relationship",
					sourceEntitySchemaId: schemaId,
					slug: `intruder-rel-${crypto.randomUUID()}`,
					propertiesSchema: { fields: {} },
				},
			}),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Entity schema not found");
	});

	it("returns 400 when using a reserved built-in relationship schema slug", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.relationshipSchemas.create({
				payload: {
					name: "Member Of",
					slug: "member-of",
					propertiesSchema: { fields: {} },
				},
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toBe(
			'Relationship schema slug "member-of" is reserved for built-in schemas',
		);
	});
});
