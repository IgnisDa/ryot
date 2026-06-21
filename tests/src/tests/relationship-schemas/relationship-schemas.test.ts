import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntitySchema,
	createRelationshipSchema,
	createTracker,
	listRelationshipSchemas,
	requireRelationshipSchemaBySlug,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("POST /relationship-schemas/list", () => {
	it.live("returns seeded built-in relationship schemas by slug", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const schemas = yield* listRelationshipSchemas(client, {
				slugs: ["in-library", "member-of"],
			});

			expect(schemas.map((schema) => schema.slug)).toEqual(["in-library", "member-of"]);
			const inLibrary = requireRelationshipSchemaBySlug(schemas, "in-library");
			expect(inLibrary.isBuiltin).toBe(true);
			expect(inLibrary.targetEntitySchemaId).not.toBeNull();
		}),
	);

	it.live("lists a custom relationship schema after creation", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { trackerId } = yield* createTracker(client, {
				name: "Relationship Schema List Tracker",
			});
			const { schemaId } = yield* createEntitySchema(client, {
				trackerId,
				name: "Relationship List Entity",
				slug: "relationship-list-entity",
			});
			const slug = `list-rel-${crypto.randomUUID()}`;

			const created = yield* createRelationshipSchema(client, {
				name: "List Relationship",
				slug,
				sourceEntitySchemaId: schemaId,
				targetEntitySchemaId: schemaId,
			});

			const schemas = yield* listRelationshipSchemas(client, { slugs: [slug] });

			expect(schemas).toHaveLength(1);
			expect(schemas[0]).toEqual(created);
		}),
	);

	it.live("returns 404 when filtering by another user's entity schema", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const intruder = yield* createAuthenticatedClient();
			const { trackerId } = yield* createTracker(owner.client, {
				name: "Relationship Schema Owner Tracker",
			});
			const { schemaId } = yield* createEntitySchema(owner.client, {
				trackerId,
				name: "Owner Relationship Entity",
				slug: "owner-relationship-entity",
			});

			const error = yield* Effect.flip(
				intruder.client.call((c) =>
					c.relationshipSchemas.list({ payload: { sourceEntitySchemaId: schemaId } }),
				),
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toBe("Entity schema not found");
		}),
	);
});

describe("POST /relationship-schemas", () => {
	it.live("successfully creates a relationship schema for custom entity schemas", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { trackerId } = yield* createTracker(client, {
				name: "Relationship Schema Tracker",
			});
			const source = yield* createEntitySchema(client, {
				trackerId,
				name: "Source Entity",
				slug: "source-entity",
			});
			const target = yield* createEntitySchema(client, {
				trackerId,
				name: "Target Entity",
				slug: "target-entity",
			});

			const data = yield* createRelationshipSchema(client, {
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
		}),
	);

	it.live("returns 409 when relationship schema slug already exists for user", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const slug = `duplicate-rel-${crypto.randomUUID()}`;
			yield* createRelationshipSchema(client, {
				name: "First Relationship",
				slug,
			});

			const error = yield* Effect.flip(
				client.call((c) =>
					c.relationshipSchemas.create({
						payload: {
							slug,
							name: "Second Relationship",
							propertiesSchema: { fields: {} },
						},
					}),
				),
			);

			assertTaggedError(error, "Conflict");
			expect(error.message).toBe("Relationship schema slug already exists");
		}),
	);

	it.live("returns 400 when relationship schema properties schema is invalid", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const error = yield* Effect.flip(
				client.call((c) =>
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
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("Rule path 'missing' does not exist");
		}),
	);

	it.live("returns 404 when creating for another user's entity schema", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const intruder = yield* createAuthenticatedClient();
			const { trackerId } = yield* createTracker(owner.client, {
				name: "Relationship Schema Create Owner Tracker",
			});
			const { schemaId } = yield* createEntitySchema(owner.client, {
				trackerId,
				name: "Create Owner Entity",
				slug: "create-owner-entity",
			});

			const error = yield* Effect.flip(
				intruder.client.call((c) =>
					c.relationshipSchemas.create({
						payload: {
							name: "Intruder Relationship",
							sourceEntitySchemaId: schemaId,
							slug: `intruder-rel-${crypto.randomUUID()}`,
							propertiesSchema: { fields: {} },
						},
					}),
				),
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toBe("Entity schema not found");
		}),
	);

	it.live("returns 400 when using a reserved built-in relationship schema slug", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const error = yield* Effect.flip(
				client.call((c) =>
					c.relationshipSchemas.create({
						payload: {
							name: "Member Of",
							slug: "member-of",
							propertiesSchema: { fields: {} },
						},
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe(
				'Relationship schema slug "member-of" is reserved for built-in schemas',
			);
		}),
	);
});
