import { Effect } from "effect";

import {
	type Client,
	createAuthenticatedClient,
	createEntity,
	createEntitySchema,
	createRelationship,
	createRelationshipSchema,
	createPluginScope,
	getBackendClient,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const makeRelationshipFixture = (client: Client) =>
	Effect.gen(function* () {
		const pluginSlug = createPluginScope();
		const { schemaId } = yield* createEntitySchema(client, {
			pluginSlug,
			name: "Relationship Test Entity",
		});
		const source = yield* createEntity(client, {
			name: "Source Entity",
			entitySchemaSlug: schemaId,
			properties: { title: "Source" },
		});
		const target = yield* createEntity(client, {
			name: "Target Entity",
			entitySchemaSlug: schemaId,
			properties: { title: "Target" },
		});
		const relSchema = yield* createRelationshipSchema(client, {
			name: "Test Relationship",
			slug: `test-rel-${crypto.randomUUID()}`,
			propertiesSchema: {
				fields: {
					rating: { type: "integer", label: "Rating", description: "Rating" },
				},
			},
		});
		return { source, target, relSchema };
	});

describe("POST /relationships", () => {
	it.live("creates a relationship and returns 201 with wasInserted: true", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { source, target, relSchema } = yield* makeRelationshipFixture(client);

			const result = yield* createRelationship(client, {
				sourceEntityId: source.id,
				targetEntityId: target.id,
				relationshipSchemaSlug: relSchema.id,
				properties: { rating: 7 },
			});

			expect(result.wasInserted).toBe(true);
			expect(result.sourceEntityId).toBe(source.id);
			expect(result.targetEntityId).toBe(target.id);
			expect(result.relationshipSchemaSlug).toBe(relSchema.id);
			expect(result.properties).toMatchObject({ rating: 7 });
			expect(result.id).toBeDefined();
			expect(result.createdAt).toBeDefined();
		}),
	);

	it.live("upserts on duplicate and returns wasInserted: false with updated properties", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { source, target, relSchema } = yield* makeRelationshipFixture(client);

			yield* createRelationship(client, {
				sourceEntityId: source.id,
				targetEntityId: target.id,
				relationshipSchemaSlug: relSchema.id,
				properties: { rating: 3 },
			});

			const upserted = yield* createRelationship(client, {
				sourceEntityId: source.id,
				targetEntityId: target.id,
				relationshipSchemaSlug: relSchema.id,
				properties: { rating: 9 },
			});

			expect(upserted.wasInserted).toBe(false);
			expect(upserted.properties).toMatchObject({ rating: 9 });
		}),
	);

	it.live("uses a global relationship schema with the caller's own entities", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const intruder = yield* createAuthenticatedClient();
			const { relSchema } = yield* makeRelationshipFixture(owner.client);
			const { source, target } = yield* makeRelationshipFixture(intruder.client);

			const result = yield* intruder.client.call((c) =>
				c.relationships.create({
					payload: {
						sourceEntityId: source.id,
						targetEntityId: target.id,
						relationshipSchemaSlug: relSchema.id,
					},
				}),
			);

			expect(result.wasInserted).toBe(true);
			expect(result.sourceEntityId).toBe(source.id);
			expect(result.targetEntityId).toBe(target.id);
			expect(result.relationshipSchemaSlug).toBe(relSchema.id);
		}),
	);

	it.live("returns 400 when properties violate the relationship schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { source, target } = yield* makeRelationshipFixture(client);
			const strictSchema = yield* createRelationshipSchema(client, {
				name: "Strict Relationship",
				slug: `strict-rel-${crypto.randomUUID()}`,
				propertiesSchema: {
					fields: {
						status: {
							type: "enum",
							label: "Status",
							description: "Status",
							options: ["active", "inactive"],
						},
					},
				},
			});

			const error = yield* Effect.flip(
				client.call((c) =>
					c.relationships.create({
						payload: {
							sourceEntityId: source.id,
							targetEntityId: target.id,
							relationshipSchemaSlug: strictSchema.id,
							properties: { status: "deleted" },
						},
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
		}),
	);

	it.live("returns 401 for unauthenticated requests", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { source, target, relSchema } = yield* makeRelationshipFixture(client);
			const unauthClient = getBackendClient();

			const error = yield* Effect.flip(
				unauthClient.call((c) =>
					c.relationships.create({
						payload: {
							sourceEntityId: source.id,
							targetEntityId: target.id,
							relationshipSchemaSlug: relSchema.id,
						},
					}),
				),
			);

			assertTaggedError(error, "Unauthorized");
		}),
	);
});
