import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createCollection,
	createEntity,
	createEventTestFixture,
	createPluginSchema,
	createPluginSchemaAndEntity,
	waitForEventCount,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { getBackendUrl } from "~/support/backend";
import { describe, expect, it } from "~/support/effect-test";

describe("Entity write path — propertiesSchema validation", () => {
	it.live("rejects entity creation when a required field is missing", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId } = yield* createPluginSchema(client, {
				name: "Required Field Schema",
				propertiesSchema: {
					fields: {
						title: {
							label: "Title",
							type: "string" as const,
							description: "Title of the item",
							validation: { required: true as const },
						},
					},
				},
			});

			const error = yield* Effect.flip(
				client.call((c) =>
					c.entities.create({
						payload: { properties: {}, name: "Missing Required", entitySchemaSlug: schemaId },
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("title: is missing");
		}),
	);

	it.live("rejects entity creation when a field has the wrong type", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId } = yield* createPluginSchema(client, {
				name: "Type Check Schema",
				propertiesSchema: {
					fields: {
						count: {
							label: "Count",
							type: "integer" as const,
							description: "An integer count",
							validation: { required: true as const },
						},
					},
				},
			});

			const error = yield* Effect.flip(
				client.call((c) =>
					c.entities.create({
						payload: {
							name: "Wrong Type",
							entitySchemaSlug: schemaId,
							properties: { count: "not-a-number" },
						},
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
		}),
	);

	it.live(
		"ignores undeclared entity properties when the schema does not opt into strict unknown keys",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { schemaId } = yield* createPluginSchema(client, {
					name: "Strict Schema",
					propertiesSchema: {
						fields: { title: { label: "Title", description: "Title", type: "string" as const } },
					},
				});

				const entity = yield* createEntity(client, {
					name: "Extra Field",
					entitySchemaSlug: schemaId,
					properties: { title: "OK", undeclaredField: "should fail" },
				});

				expect(entity.properties).toEqual({ title: "OK" });
			}),
	);

	it.live("accepts entity creation when properties match the schema exactly", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId } = yield* createPluginSchema(client, {
				name: "Valid Schema",
				propertiesSchema: {
					fields: {
						rating: { label: "Rating", description: "Rating", type: "integer" as const },
						title: {
							label: "Title",
							description: "Title",
							type: "string" as const,
							validation: { required: true as const },
						},
					},
				},
			});

			const entity = yield* createEntity(client, {
				name: "Valid Entity",
				entitySchemaSlug: schemaId,
				properties: { title: "My Item", rating: 4 },
			});

			expect(entity.id).toBeDefined();
			expect(entity.properties).toMatchObject({ title: "My Item", rating: 4 });
		}),
	);
});

describe("Event write path — propertiesSchema validation", () => {
	it.live("rejects event creation when a required field is missing", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { entityId, eventSchemaSlug } = yield* createEventTestFixture(client);

			const result = yield* client.call((c) =>
				c.events.create({ payload: [{ entityId, eventSchemaSlug, properties: {} }] }),
			);

			expect(result).toMatchObject({
				count: 0,
				outcomes: [],
				failure: {
					index: 0,
					reason: { kind: "bad_request", message: expect.stringContaining("rating: is missing") },
				},
			});
		}),
	);

	it.live("rejects event creation when a field has the wrong type", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { entityId, eventSchemaSlug } = yield* createEventTestFixture(client);

			const result = yield* client.call((c) =>
				c.events.create({
					payload: [{ entityId, eventSchemaSlug, properties: { rating: "not-a-number" } }],
				}),
			);

			expect(result).toMatchObject({
				count: 0,
				outcomes: [],
				failure: { index: 0, reason: { kind: "bad_request" } },
			});
		}),
	);

	it.live(
		"ignores undeclared event properties when the schema does not opt into strict unknown keys",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { entityId, eventSchemaSlug } = yield* createEventTestFixture(client);

				const data = yield* client.call((c) =>
					c.events.create({
						payload: [
							{ entityId, eventSchemaSlug, properties: { rating: 4, undeclaredField: "bad" } },
						],
					}),
				);

				expect(data.count).toBe(1);

				const [event] = yield* waitForEventCount(client, entityId, 1);
				expect(event?.properties).toEqual({ rating: 4 });
			}),
	);

	it.live("accepts event creation when properties match the schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { entityId, eventSchemaSlug } = yield* createEventTestFixture(client);

			const data = yield* client.call((c) =>
				c.events.create({ payload: [{ entityId, eventSchemaSlug, properties: { rating: 5 } }] }),
			);

			expect(data.count).toBe(1);
		}),
	);
});

describe("Collection entity write path — propertiesSchema validation", () => {
	it.live("rejects collection creation when description is not a string", () =>
		Effect.gen(function* () {
			const { cookies } = yield* createAuthenticatedClient();

			const response = yield* Effect.promise(() =>
				fetch(`${getBackendUrl()}/collections`, {
					method: "POST",
					headers: { Cookie: cookies, "Content-Type": "application/json" },
					body: JSON.stringify({ description: 12345, name: "Invalid Description Type" }),
				}),
			);

			expect(response.status).toBe(400);
		}),
	);

	it.live("accepts collection creation with a valid description string", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const collection = yield* createCollection(client, {
				name: "Valid Collection",
				description: "A perfectly valid description",
			});

			expect(collection.id).toBeDefined();
			expect(collection.properties).toMatchObject({
				description: "A perfectly valid description",
			});
		}),
	);

	it.live("accepts collection creation with a valid membershipPropertiesSchema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const collection = yield* createCollection(client, {
				name: "Schema Collection",
				membershipPropertiesSchema: {
					fields: { notes: { type: "string", label: "Notes", description: "Notes" } },
				},
			});

			expect(collection.id).toBeDefined();
			expect(collection.properties.membershipPropertiesSchema).toBeDefined();
		}),
	);
});

describe("Collection membership — member-of relationship propertiesSchema validation", () => {
	it.live("accepts membership add with properties matching the collection schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const collection = yield* createCollection(client, {
				name: "Rated Collection",
				membershipPropertiesSchema: {
					fields: {
						score: {
							label: "Score",
							description: "Score",
							type: "integer" as const,
							validation: { minimum: 1, maximum: 10 },
						},
					},
				},
			});
			const { entityId } = yield* createPluginSchemaAndEntity(client);

			const data = yield* client.call((c) =>
				c.collections.createMembership({
					payload: { entityId, collectionId: collection.id, properties: { score: 8 } },
				}),
			);

			expect(data.memberOf.properties).toMatchObject({ score: 8 });
		}),
	);

	it.live(
		"rejects membership add when properties fail the collection's membershipPropertiesSchema",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const collection = yield* createCollection(client, {
					name: "Strict Score Collection",
					membershipPropertiesSchema: {
						fields: {
							score: {
								label: "Score",
								description: "Score",
								type: "integer" as const,
								validation: { minimum: 1, maximum: 10 },
							},
						},
					},
				});
				const { entityId } = yield* createPluginSchemaAndEntity(client);

				const error = yield* Effect.flip(
					client.call((c) =>
						c.collections.createMembership({
							payload: { entityId, collectionId: collection.id, properties: { score: 999 } },
						}),
					),
				);

				assertTaggedError(error, "BadRequest");
				expect(error.message).toContain("Membership properties validation failed");
			}),
	);

	it.live(
		"accepts membership add with arbitrary properties when no membershipPropertiesSchema is set",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const collection = yield* createCollection(client, { name: "Open Collection" });
				const { entityId } = yield* createPluginSchemaAndEntity(client);

				const data = yield* client.call((c) =>
					c.collections.createMembership({
						payload: {
							entityId,
							collectionId: collection.id,
							properties: { arbitrary: "any-value", number: 42 },
						},
					}),
				);

				expect(data.memberOf.properties).toMatchObject({ arbitrary: "any-value", number: 42 });
			}),
	);
});
