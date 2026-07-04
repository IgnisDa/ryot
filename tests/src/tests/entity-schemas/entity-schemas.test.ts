import { EntitySchemaId, TrackerId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntitySchema,
	createTracker,
	findBuiltinEntitySchema,
	findBuiltinSchemaWithProviders,
	findBuiltinTracker,
	getEntitySchema,
	listEntitySchemas,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("GET /entity-schemas", () => {
	it.live("returns 200 and lists built-in entity schemas for built-in tracker", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const builtinTracker = yield* findBuiltinTracker(client);

			const schemas = yield* listEntitySchemas(client, {
				trackerId: builtinTracker.id,
			});

			expect(Array.isArray(schemas)).toBe(true);
			expect(schemas.length).toBeGreaterThan(0);

			const firstSchema = schemas[0];
			expect(firstSchema?.id).toBeDefined();
			expect(firstSchema?.name).toBeDefined();
			expect(firstSchema?.slug).toBeDefined();
			expect(firstSchema?.trackerId).toBe(builtinTracker.id);
			expect(firstSchema?.isBuiltin).toBe(true);
			expect(firstSchema?.icon).toBeDefined();
			expect(firstSchema?.accentColor).toBeDefined();
			expect(firstSchema?.propertiesSchema).toBeDefined();
		}),
	);

	it.live("includes the built-in collection schema in the default platform", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const builtinTracker = yield* findBuiltinTracker(client);
			const schemas = yield* listEntitySchemas(client, {
				trackerId: builtinTracker.id,
			});
			const collectionSchema = schemas.find((schema) => schema.slug === "collection");

			expect(collectionSchema).toBeDefined();
			expect(collectionSchema).toMatchObject({
				providers: [],
				icon: "folders",
				isBuiltin: true,
				name: "Collection",
				accentColor: "#F59E0B",
				propertiesSchema: {
					fields: {
						description: { type: "string", label: "Description" },
						membershipPropertiesSchema: {
							type: "object",
							properties: {},
							unknownKeys: "passthrough",
							label: "Membership Properties Schema",
						},
					},
				},
			});
		}),
	);

	it.live("returns 200 and lists custom entity schemas for custom tracker", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { trackerId } = yield* createTracker(client, {
				name: "Custom Tracker",
			});

			const { schemaId } = yield* createEntitySchema(client, {
				trackerId,
				name: "Custom Schema",
				slug: "custom-schema",
			});

			const schemas = yield* listEntitySchemas(client, { trackerId });

			expect(Array.isArray(schemas)).toBe(true);
			expect(schemas.length).toBe(1);

			const schema = schemas[0];
			expect(schema?.id).toBe(schemaId);
			expect(schema?.name).toBe("Custom Schema");
			expect(schema?.slug).toBe("custom-schema");
			expect(schema?.trackerId).toBe(trackerId);
			expect(schema?.isBuiltin).toBe(false);
		}),
	);

	it.live("returns 404 for non-existent tracker", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const nonExistentId = "00000000-0000-0000-0000-000000000000";
			const error = yield* Effect.flip(
				client.call((c) =>
					c.entitySchemas.list({ payload: { trackerId: TrackerId.make(nonExistentId) } }),
				),
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toBe("Tracker not found");
		}),
	);

	it.live("returns empty array for custom tracker with no schemas", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { trackerId } = yield* createTracker(client, { name: "Empty Tracker" });

			const schemas = yield* listEntitySchemas(client, { trackerId });

			expect(Array.isArray(schemas)).toBe(true);
			expect(schemas.length).toBe(0);
		}),
	);

	it.live("returns 404 when attempting to access another user's custom tracker", () =>
		Effect.gen(function* () {
			const { client: client1 } = yield* createAuthenticatedClient();
			const { client: client2 } = yield* createAuthenticatedClient();

			const { trackerId } = yield* createTracker(client1, { name: "User 1 Tracker" });

			const error = yield* Effect.flip(
				client2.call((c) => c.entitySchemas.list({ payload: { trackerId } })),
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toBe("Tracker not found");
		}),
	);

	it.live("lists multiple custom schemas ordered by name and createdAt", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { trackerId } = yield* createTracker(client, {
				name: "Multi Schema Tracker",
			});

			yield* createEntitySchema(client, {
				trackerId,
				slug: "zebra",
				name: "Zebra Schema",
			});

			yield* createEntitySchema(client, {
				trackerId,
				slug: "alpha",
				name: "Alpha Schema",
			});

			yield* createEntitySchema(client, {
				trackerId,
				slug: "beta",
				name: "Beta Schema",
			});

			const schemas = yield* listEntitySchemas(client, { trackerId });

			expect(schemas.length).toBe(3);

			const names = schemas.map((s) => s.name);
			expect(names).toEqual(["Alpha Schema", "Beta Schema", "Zebra Schema"]);
		}),
	);

	it.live("returns 200 when filtering by a single slug", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { trackerId } = yield* createTracker(client, { name: "Single Slug Tracker" });
			yield* createEntitySchema(client, {
				trackerId,
				name: "Only Schema",
				slug: "only-schema",
			});

			const data = yield* client.call((c) =>
				c.entitySchemas.list({ payload: { slugs: ["only-schema"] } }),
			);

			expect(data.length).toBe(1);
			expect(data[0]?.slug).toBe("only-schema");
		}),
	);

	it.live("lists schemas by slug across accessible trackers", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { trackerId: booksTrackerId } = yield* createTracker(client, { name: "Books" });
			const { trackerId: moviesTrackerId } = yield* createTracker(client, { name: "Movies" });

			yield* createEntitySchema(client, {
				name: "Book Entry",
				slug: "book-entry",
				trackerId: booksTrackerId,
			});
			yield* createEntitySchema(client, {
				name: "Movie Entry",
				slug: "movie-entry",
				trackerId: moviesTrackerId,
			});

			const schemas = yield* listEntitySchemas(client, {
				slugs: ["movie-entry", "book-entry"],
			});

			expect(schemas.length).toBe(2);
			expect(schemas.map((schema) => schema.slug)).toEqual(["book-entry", "movie-entry"]);
			expect(schemas.map((schema) => schema.trackerId)).toEqual([booksTrackerId, moviesTrackerId]);
		}),
	);

	it.live("returns all accessible schemas when trackerId and slugs are both missing", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const builtinTracker = yield* findBuiltinTracker(client);
			const builtinSchemas = yield* listEntitySchemas(client, {
				trackerId: builtinTracker.id,
			});

			const { trackerId } = yield* createTracker(client, { name: "Unfiltered Tracker" });
			yield* createEntitySchema(client, {
				trackerId,
				name: "Custom Entry",
				slug: "custom-entry",
			});

			const data = yield* client.call((c) => c.entitySchemas.list({ payload: {} }));

			expect(data.some((schema) => schema.slug === "custom-entry")).toBe(true);
			expect(data.length).toBeGreaterThanOrEqual(builtinSchemas.length + 1);
		}),
	);

	it.live("built-in schemas with linked scripts have non-empty providers", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaWithProviders(client);

			expect(schema.providers.length).toBeGreaterThan(0);
			const provider = schema.providers[0];
			expect(provider).toBeDefined();
			expect(typeof provider?.name).toBe("string");
			expect(provider?.name.length).toBeGreaterThan(0);
			expect(typeof provider?.scriptId).toBe("string");
		}),
	);

	it.live("custom schemas without linked scripts have providers as empty array", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { trackerId } = yield* createTracker(client, { name: "Provider Test Tracker" });
			yield* createEntitySchema(client, {
				trackerId,
				name: "Provider Test Schema",
			});

			const schemas = yield* listEntitySchemas(client, { trackerId });

			expect(schemas.length).toBe(1);
			expect(schemas[0]?.providers).toEqual([]);
		}),
	);
});

describe("POST /entity-schemas", () => {
	it.live("returns 400 when attempting to create schema for built-in tracker", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const builtinTracker = yield* findBuiltinTracker(client);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.entitySchemas.create({
						payload: {
							icon: "test",
							slug: "hacked",
							name: "Hacked Schema",
							accentColor: "#FF0000",
							trackerId: builtinTracker.id,
							propertiesSchema: {
								fields: {
									field: { type: "string", label: "Field", description: "Field" },
								},
							},
						},
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe("Built-in trackers do not support entity schema creation");
		}),
	);

	it.live("successfully creates schema for custom tracker", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { trackerId } = yield* createTracker(client, {
				name: "Custom Tracker",
			});

			const data = yield* client.call((c) =>
				c.entitySchemas.create({
					payload: {
						trackerId,
						icon: "star",
						name: "My Schema",
						slug: "my-schema",
						accentColor: "#00FF00",
						propertiesSchema: {
							fields: {
								year: { type: "number", label: "Year", description: "Year" },
								title: { type: "string", label: "Title", description: "Title" },
							},
						},
					},
				}),
			);

			expect(data.name).toBe("My Schema");
			expect(data.slug).toBe("my-schema");
			expect(data.trackerId).toBe(trackerId);
			expect(data.isBuiltin).toBe(false);
		}),
	);

	it.live("returns 404 when tracker does not exist", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const nonExistentId = "00000000-0000-0000-0000-000000000000";
			const error = yield* Effect.flip(
				client.call((c) =>
					c.entitySchemas.create({
						payload: {
							icon: "test",
							name: "Schema",
							slug: "schema",
							accentColor: "#FF0000",
							trackerId: TrackerId.make(nonExistentId),
							propertiesSchema: {
								fields: {
									field: { type: "string", label: "Field", description: "Field" },
								},
							},
						},
					}),
				),
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toBe("Tracker not found");
		}),
	);

	it.live("returns 404 when attempting to create schema for another user's tracker", () =>
		Effect.gen(function* () {
			const { client: client1 } = yield* createAuthenticatedClient();
			const { client: client2 } = yield* createAuthenticatedClient();

			const { trackerId } = yield* createTracker(client1, {
				name: "User 1 Tracker",
			});

			const error = yield* Effect.flip(
				client2.call((c) =>
					c.entitySchemas.create({
						payload: {
							trackerId,
							icon: "test",
							slug: "hacked",
							name: "Hacked Schema",
							accentColor: "#FF0000",
							propertiesSchema: {
								fields: {
									field: { type: "string", label: "Field", description: "Field" },
								},
							},
						},
					}),
				),
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toBe("Tracker not found");
		}),
	);

	it.live("returns 409 when slug already exists for user", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { trackerId } = yield* createTracker(client, {
				name: "Tracker",
			});

			yield* createEntitySchema(client, {
				trackerId,
				name: "First Schema",
				slug: "duplicate-slug",
			});

			const error = yield* Effect.flip(
				client.call((c) =>
					c.entitySchemas.create({
						payload: {
							trackerId,
							icon: "test",
							name: "Second Schema",
							slug: "duplicate-slug",
							accentColor: "#FF0000",
							propertiesSchema: {
								fields: {
									field: { type: "string", label: "Field", description: "Field" },
								},
							},
						},
					}),
				),
			);

			assertTaggedError(error, "Conflict");
			expect(error.message).toBe("Entity schema slug already exists");
		}),
	);

	it.live("returns 400 when attempting to create the reserved collection schema slug", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { trackerId } = yield* createTracker(client, {
				name: "Tracker",
			});

			const error = yield* Effect.flip(
				client.call((c) =>
					c.entitySchemas.create({
						payload: {
							trackerId,
							icon: "folders",
							name: "Collection",
							slug: "collection",
							accentColor: "#F59E0B",
							propertiesSchema: {
								fields: {
									title: { type: "string", label: "Title", description: "Title" },
								},
							},
						},
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe(
				'Entity schema slug "collection" is reserved for built-in schemas',
			);
		}),
	);
});

describe("GET /entity-schemas/:entitySchemaId", () => {
	it.live("returns 200 and the entity schema for a valid owned schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { trackerId } = yield* createTracker(client, {
				name: "Test Tracker",
			});

			const { schemaId, data: createdData } = yield* createEntitySchema(client, {
				trackerId,
				name: "My Schema",
				slug: "my-schema",
			});

			const schema = yield* getEntitySchema(client, schemaId);

			expect(schema.id).toBe(schemaId);
			expect(schema.name).toBe("My Schema");
			expect(schema.slug).toBe("my-schema");
			expect(schema.trackerId).toBe(trackerId);
			expect(schema.isBuiltin).toBe(false);
			expect(schema.icon).toBe(createdData.icon);
			expect(schema.accentColor).toBe(createdData.accentColor);
			expect(schema.propertiesSchema).toBeDefined();
		}),
	);

	it.live("returns 200 for a built-in entity schema accessible to the user", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { schema: firstSchema } = yield* findBuiltinEntitySchema(client);
			const schema = yield* getEntitySchema(client, firstSchema.id);

			expect(schema.id).toBe(firstSchema.id);
			expect(schema.isBuiltin).toBe(true);
		}),
	);

	it.live("returns 404 for a non-existent entity schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const nonExistentId = "00000000-0000-0000-0000-000000000000";
			const error = yield* Effect.flip(
				client.call((c) =>
					c.entitySchemas.get({ path: { entitySchemaId: EntitySchemaId.make(nonExistentId) } }),
				),
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toBe("Entity schema not found");
		}),
	);

	it.live("returns 404 when accessing another user's entity schema", () =>
		Effect.gen(function* () {
			const { client: client1 } = yield* createAuthenticatedClient();
			const { client: client2 } = yield* createAuthenticatedClient();

			const { trackerId } = yield* createTracker(client1, {
				name: "User 1 Tracker",
			});
			const { schemaId } = yield* createEntitySchema(client1, {
				trackerId,
				slug: "user1-schema",
				name: "User 1 Schema",
			});

			const error = yield* Effect.flip(
				client2.call((c) => c.entitySchemas.get({ path: { entitySchemaId: schemaId } })),
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toBe("Entity schema not found");
		}),
	);
});
