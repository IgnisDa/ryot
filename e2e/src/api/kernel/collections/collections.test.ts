import {
	EntityId,
	EntitySchemaSlug,
	RelationshipSchemaSlug,
} from "@ryot-app/contract/schema/brands";
import { column, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { Effect, Schema } from "effect";

import {
	type Client,
	createAuthenticatedClient,
	createCollection,
	createPluginSchemaAndEntity,
	executeRyotQL,
	getApiClient,
	getEntity,
	listEventsForEntity,
	listImportedEntityNames,
	requireRows,
	startDataJsonImport,
	waitForEventWithSchema,
} from "~/fixtures/kernel";
import { createGlobalBookEntityFixture } from "~/fixtures/plugins/media";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { getApiUrl } from "~/support/harness-target";
import { webRequest } from "~/support/web-request";

const kernelCollection = {
	owner: { kind: "kernel" as const },
	slug: EntitySchemaSlug.make("collection"),
};

const ownedFields = [
	{ required: true, label: "Owned On", type: "date" as const },
	{
		label: "Format",
		required: false,
		defaultValue: "Vinyl",
		type: "choice" as const,
		choices: ["Vinyl", "CD"],
	},
];

const countRows = (client: Client, tableName: "entity" | "relationship", key: string, id: string) =>
	Effect.gen(function* () {
		const source = table(tableName, "counted");
		const result = yield* executeRyotQL(
			client,
			document({
				counted: rows(source, {
					limit: 10,
					where: eq(column(source, key), literal(id)),
					fields: [field("id", column(source, "id"))],
				}),
			}),
		);
		return requireRows(result.data.counted, "counted").items.length;
	});

const postJson = (token: string, path: string, body: unknown) =>
	Effect.gen(function* () {
		return yield* webRequest(`${getApiUrl()}${path}`, {
			method: "POST",
			body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(body),
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		});
	});

describe("POST /collections", () => {
	it.live("compiles member fields into a strict membership schema with generated keys", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const collection = yield* createCollection(client, {
				fields: ownedFields,
				name: "Recommended to me",
				description: "Movies and books recommended by friends",
			});

			expect(collection.name).toBe("Recommended to me");
			expect(collection.properties).toEqual({
				description: "Movies and books recommended by friends",
				membershipPropertiesSchema: {
					unknownKeys: "strict",
					fields: {
						"owned-on": {
							position: 0,
							type: "date",
							label: "Owned On",
							description: "Owned On",
							validation: { required: true },
						},
						format: {
							position: 1,
							type: "enum",
							label: "Format",
							description: "Format",
							defaultValue: "Vinyl",
							choices: { kind: "static", values: [{ value: "Vinyl" }, { value: "CD" }] },
						},
					},
				},
			});
		}),
	);

	it.live("creates a collection without member fields", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const collection = yield* createCollection(client, {
				name: "Favorites",
				description: "My favorite items",
			});

			expect(collection.properties).toEqual({ description: "My favorite items" });
		}),
	);

	it.live("rejects reserved keys, invented keys, and unsupported field shapes", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const create = (fields: NonNullable<Parameters<typeof createCollection>[1]>["fields"]) =>
				Effect.flip(createCollection(client, { fields, name: `Fields ${crypto.randomUUID()}` }));

			const reserved = yield* create([
				{ key: "rank", label: "Rank", type: "number", required: false },
			]);
			assertTaggedError(reserved, "CollectionBadRequest");
			expect(reserved.reason).toEqual({
				code: "reserved-field-key",
				paths: [["fields", "0", "key"]],
			});

			const invented = yield* create([
				{ type: "text", label: "Note", key: "invented", required: false },
			]);
			assertTaggedError(invented, "CollectionBadRequest");
			expect(invented.reason).toEqual({ code: "invalid-fields", paths: [["fields", "0", "key"]] });

			const unsupported = yield* create([{ type: "choice", label: "Format", required: false }]);
			assertTaggedError(unsupported, "CollectionBadRequest");
			expect(unsupported.reason).toEqual({
				code: "invalid-fields",
				paths: [["fields", "0", "choices"]],
			});
		}),
	);

	it.live("rejects raw property-schema knobs and over-long names at the wire", () =>
		Effect.gen(function* () {
			const { token } = yield* createAuthenticatedClient();

			const knobs = yield* postJson(token, "/collections", {
				name: "Pattern Collection",
				fields: [
					{ type: "text", label: "Note", required: false, validation: { pattern: "^(a+)+$" } },
				],
			});
			expect(knobs.status).toBe(400);

			const longName = yield* postJson(token, "/collections", { name: "n".repeat(201) });
			expect(longName.status).toBe(400);
		}),
	);

	it.live("rejects a duplicate name for the same user after trimming", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { client: other } = yield* createAuthenticatedClient();
			yield* createCollection(client, { name: "Shelf" });
			yield* createCollection(other, { name: "Shelf" });

			const error = yield* Effect.flip(createCollection(client, { name: "  Shelf " }));

			assertTaggedError(error, "CollectionBadRequest");
			expect(error.reason).toEqual({ field: "name", code: "name-taken" });
		}),
	);

	it.live("records a duplicate-name kernel collection import as an unsuccessful record", () =>
		Effect.gen(function* () {
			const user = yield* createAuthenticatedClient();
			const name = `Imported Shelf ${crypto.randomUUID()}`;
			yield* createCollection(user.client, { name });

			const { run } = yield* startDataJsonImport(user, {
				events: [],
				relationships: [],
				entities: [
					{
						name,
						kind: "custom",
						properties: {},
						key: "duplicate",
						entitySchema: kernelCollection,
					},
				],
			});

			expect(run).toMatchObject({
				status: "completed",
				summary: [
					{
						unit: "entities",
						recordKind: "entity",
						counts: { created: 0, updated: 0, skipped: 0, unchanged: 0, unsuccessful: 1 },
					},
				],
			});
			expect(yield* listImportedEntityNames(user.client, "collection")).toEqual([name]);
		}),
	);

	it.live("rejects unauthenticated requests", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				getApiClient().call((c) => c.collections.create({ payload: { name: "Test Collection" } })),
			);

			assertTaggedError(error, "AuthUnauthorized");
		}),
	);
});

describe("raw kernel collection writes", () => {
	it.live("rejects kernel collections created through POST /entities", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const error = yield* Effect.flip(
				client.call((c) =>
					c.entities.create({
						payload: { name: "Raw", properties: {}, entitySchema: kernelCollection },
					}),
				),
			);

			assertTaggedError(error, "EntityBadRequest");
			expect(error.reason).toEqual({ code: "kernel-owned-schema" });
		}),
	);

	it.live("rejects kernel memberships created through POST /relationships", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const collection = yield* createCollection(client);
			const { entityId } = yield* createPluginSchemaAndEntity(client);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.relationships.create({
						payload: {
							sourceEntityId: entityId,
							targetEntityId: collection.id,
							properties: { rank: -1000, invented: true },
							relationshipSchema: {
								owner: { kind: "kernel" },
								slug: RelationshipSchemaSlug.make("member-of"),
							},
						},
					}),
				),
			);

			assertTaggedError(error, "RelationshipBadRequest");
			expect(error.reason).toEqual({ code: "kernel-owned-schema" });
			expect(yield* countRows(client, "relationship", "targetEntityId", collection.id)).toBe(0);
		}),
	);
});

describe("PATCH /collections", () => {
	it.live("replaces fields wholesale, keeps stable keys, and leaves member values untouched", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const collection = yield* createCollection(client, {
				name: "Records",
				fields: [{ type: "text", label: "Note", required: false }],
			});
			const { entityId } = yield* createPluginSchemaAndEntity(client);
			const added = yield* client.call((c) =>
				c.collections.createMembership({
					payload: { entityId, collectionId: collection.id, properties: { note: "kept" } },
				}),
			);

			const updated = yield* client.call((c) =>
				c.collections.update({
					payload: {
						description: "Updated",
						name: "Records Renamed",
						collectionId: collection.id,
						fields: [
							{ key: "note", type: "text", required: false, label: "Comment" },
							{ label: "Note", type: "boolean", required: false },
						],
					},
				}),
			);

			expect(updated.name).toBe("Records Renamed");
			expect(updated.properties).toEqual({
				description: "Updated",
				membershipPropertiesSchema: {
					unknownKeys: "strict",
					fields: {
						"note-2": { position: 1, label: "Note", type: "boolean", description: "Note" },
						note: { position: 0, type: "string", label: "Comment", description: "Comment" },
					},
				},
			});
			const removed = yield* client.call((c) =>
				c.collections.deleteMembership({ payload: { entityId, collectionId: collection.id } }),
			);
			expect(removed.memberOf.properties).toEqual(added.memberOf.properties);
		}),
	);

	it.live("rejects renaming onto another collection's name", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			yield* createCollection(client, { name: "Taken" });
			const collection = yield* createCollection(client, { name: "Free" });

			const error = yield* Effect.flip(
				client.call((c) =>
					c.collections.update({
						payload: { fields: [], name: "Taken", description: null, collectionId: collection.id },
					}),
				),
			);

			assertTaggedError(error, "CollectionBadRequest");
			expect(error.reason).toEqual({ field: "name", code: "name-taken" });
		}),
	);

	it.live("treats global, non-collection, and other users' entities as missing", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { client: owner } = yield* createAuthenticatedClient();
			const foreign = yield* createCollection(owner, { name: "Owner Shelf" });
			const { entityId: ownEntityId } = yield* createPluginSchemaAndEntity(client);
			const { entity: global } = yield* createGlobalBookEntityFixture(client);

			for (const target of [global.id, ownEntityId, foreign.id]) {
				const error = yield* Effect.flip(
					client.call((c) =>
						c.collections.update({
							payload: { fields: [], name: "Hijacked", description: null, collectionId: target },
						}),
					),
				);
				assertTaggedError(error, "CollectionNotFound");
				expect(error.reason).toEqual({ collectionId: target, code: "collection-not-found" });
			}

			expect((yield* getEntity(owner, foreign.id)).name).toBe("Owner Shelf");
			expect((yield* getEntity(client, ownEntityId)).name).toBe("Test Entity");
			expect((yield* getEntity(client, global.id)).id).toBe(global.id);
		}),
	);
});

describe("DELETE /collections", () => {
	it.live("deletes the collection with its memberships and events", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const collection = yield* createCollection(client);
			const { entityId } = yield* createPluginSchemaAndEntity(client);
			yield* client.call((c) =>
				c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
			);
			yield* waitForEventWithSchema(client, collection.id, "add-entity-to-collection");

			const deleted = yield* client.call((c) =>
				c.collections.delete({ payload: { collectionId: collection.id } }),
			);

			expect(deleted.id).toBe(collection.id);
			expect(yield* countRows(client, "entity", "id", collection.id)).toBe(0);
			expect(yield* countRows(client, "relationship", "targetEntityId", collection.id)).toBe(0);
			expect(yield* listEventsForEntity(client, collection.id, undefined, 10)).toEqual([]);
			expect((yield* getEntity(client, entityId)).id).toBe(entityId);
		}),
	);

	it.live("treats missing, global, non-collection, and other users' entities as missing", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { client: owner } = yield* createAuthenticatedClient();
			const foreign = yield* createCollection(owner, { name: "Owner Shelf" });
			const { entityId: ownEntityId } = yield* createPluginSchemaAndEntity(client);
			const { entity: global } = yield* createGlobalBookEntityFixture(client);
			const missing = EntityId.make(`missing-${crypto.randomUUID()}`);

			for (const target of [missing, global.id, ownEntityId, foreign.id]) {
				const error = yield* Effect.flip(
					client.call((c) => c.collections.delete({ payload: { collectionId: target } })),
				);
				assertTaggedError(error, "CollectionNotFound");
				expect(error.reason).toEqual({ collectionId: target, code: "collection-not-found" });
			}

			expect((yield* getEntity(owner, foreign.id)).id).toBe(foreign.id);
			expect((yield* getEntity(client, ownEntityId)).id).toBe(ownEntityId);
			expect((yield* getEntity(client, global.id)).id).toBe(global.id);
		}),
	);
});
