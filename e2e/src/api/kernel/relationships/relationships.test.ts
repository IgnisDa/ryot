import { Effect } from "effect";

import {
	type Client,
	createAuthenticatedClient,
	createEntity,
	createEntitySchema,
	createRelationship,
	createRelationshipSchema,
	createPluginScope,
	getApiClient,
} from "~/fixtures/kernel";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const makeRelationshipFixture = (client: Client) =>
	Effect.gen(function* () {
		const pluginSlug = createPluginScope();
		const { reference } = yield* createEntitySchema(client, {
			pluginSlug,
			name: "Relationship Test Entity",
		});
		const source = yield* createEntity(client, {
			name: "Source Entity",
			entitySchema: reference,
			properties: { title: "Source" },
		});
		const target = yield* createEntity(client, {
			name: "Target Entity",
			entitySchema: reference,
			properties: { title: "Target" },
		});
		const relSchema = yield* createRelationshipSchema(client, {
			pluginSlug,
			name: "Test Relationship",
			slug: `test-rel-${crypto.randomUUID()}`,
			propertiesSchema: {
				fields: { rating: { type: "integer", label: "Rating", description: "Rating" } },
			},
		});
		return { source, target, relSchema, pluginSlug };
	});

describe("POST /relationships", () => {
	it.live("creates a relationship and returns 201 with wasInserted: true", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { source, target, relSchema } = yield* makeRelationshipFixture(client);

			const result = yield* createRelationship(client, {
				sourceEntityId: source.id,
				targetEntityId: target.id,
				properties: { rating: 7 },
				relationshipSchema: relSchema.reference,
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
				properties: { rating: 3 },
				relationshipSchema: relSchema.reference,
			});

			const upserted = yield* createRelationship(client, {
				sourceEntityId: source.id,
				targetEntityId: target.id,
				properties: { rating: 9 },
				relationshipSchema: relSchema.reference,
			});

			expect(upserted.wasInserted).toBe(false);
			expect(upserted.properties).toMatchObject({ rating: 9 });
		}),
	);

	it.live("rejects another user's private relationship schema", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const intruder = yield* createAuthenticatedClient();
			const { relSchema } = yield* makeRelationshipFixture(owner.client);
			const { source, target } = yield* makeRelationshipFixture(intruder.client);

			const error = yield* Effect.flip(
				intruder.client.call((c) =>
					c.relationships.create({
						payload: {
							sourceEntityId: source.id,
							targetEntityId: target.id,
							relationshipSchema: relSchema.reference,
						},
					}),
				),
			);

			assertTaggedError(error, "RelationshipNotFound");
			expect(error.reason).toEqual({
				schema: relSchema.reference,
				code: "relationship-schema-not-found",
			});
		}),
	);

	it.live("returns 400 when properties violate the relationship schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { source, target, pluginSlug } = yield* makeRelationshipFixture(client);
			const strictSchema = yield* createRelationshipSchema(client, {
				pluginSlug,
				name: "Strict Relationship",
				slug: `strict-rel-${crypto.randomUUID()}`,
				propertiesSchema: {
					fields: {
						status: {
							type: "enum",
							label: "Status",
							description: "Status",
							choices: { kind: "static", values: [{ value: "active" }, { value: "inactive" }] },
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
							properties: { status: "deleted" },
							relationshipSchema: strictSchema.reference,
						},
					}),
				),
			);

			assertTaggedError(error, "RelationshipBadRequest");
			expect(error.reason).toMatchObject({ code: "invalid-properties" });
		}),
	);

	it.live("returns 401 for unauthenticated requests", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { source, target, relSchema } = yield* makeRelationshipFixture(client);
			const unauthClient = getApiClient();

			const error = yield* Effect.flip(
				unauthClient.call((c) =>
					c.relationships.create({
						payload: {
							sourceEntityId: source.id,
							targetEntityId: target.id,
							relationshipSchema: relSchema.reference,
						},
					}),
				),
			);

			assertTaggedError(error, "AuthUnauthorized");
		}),
	);
});
