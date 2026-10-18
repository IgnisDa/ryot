import { expect, layer } from "@effect/vitest";
import type {
	DeclarationReference,
	EventSchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	PluginId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Context, Effect, Layer, Ref, Result } from "effect";

import { DefinitionRepository } from "#modules/definitions/repository";
import type { EntitySchemaSnapshot } from "#modules/definitions/snapshot";
import { revisionDatabaseLayer } from "#modules/plugins/packages/revision.test-support";
import { testPluginPackageId } from "#modules/plugins/test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { fakeDatabaseSession } from "#testing/effect";

import { CollectionsRepository } from "./repository";

const pluginCollectionSchema: EntitySchemaSnapshot = {
	eventSchemas: {},
	icon: "collection",
	name: "Plugin collection",
	mergeIdentityProperties: [],
	propertiesSchema: { fields: {} },
	slug: EntitySchemaSlug.make("collection"),
	pluginId: PluginId.make("collection-plugin"),
};

const repositoryLayer = Layer.unwrap(
	Effect.gen(function* () {
		const entityReferences = yield* Ref.make<ReadonlyArray<DeclarationReference>>([]);
		const eventReferences = yield* Ref.make<ReadonlyArray<EventSchemaReference>>([]);
		const lookups = Layer.succeed(DefinitionLookups, {
			eventReferences: Ref.get(eventReferences),
			entityReferences: Ref.get(entityReferences),
		});
		const definitions = Layer.mock(DefinitionRepository)({
			findGlobalEventSchema: (reference) =>
				Ref.update(eventReferences, (all) => [...all, reference]).pipe(Effect.as(null)),
			findGlobalEntitySchema: (reference) =>
				Ref.update(entityReferences, (all) => [...all, reference]).pipe(
					Effect.andThen(
						Effect.succeed(reference.owner.kind === "plugin" ? pluginCollectionSchema : null),
					),
				),
		});
		return CollectionsRepository.layer.pipe(
			Layer.provideMerge(lookups),
			Layer.provideMerge(definitions),
			Layer.provideMerge(Layer.mock(DatabaseSession)({})),
		);
	}),
);

type CollectionQuery = { readonly sql: string; readonly columns: ReadonlyArray<string> };

class DefinitionLookups extends Context.Service<
	DefinitionLookups,
	{
		readonly eventReferences: Effect.Effect<ReadonlyArray<EventSchemaReference>>;
		readonly entityReferences: Effect.Effect<ReadonlyArray<DeclarationReference>>;
	}
>()("test/DefinitionLookups") {}

const pluginCollectionRow = {
	properties: {},
	externalId: null,
	providerId: null,
	name: "Favorites",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	id: "plugin-collection",
	entitySchemaSlug: "collection",
	entitySchemaPluginId: "collection-plugin",
};

class CollectionQueries extends Context.Service<
	CollectionQueries,
	{ readonly entries: Effect.Effect<ReadonlyArray<CollectionQuery>> }
>()("test/CollectionQueries") {}

const collectionQueriesLayer = Layer.unwrap(
	Effect.gen(function* () {
		const entries = yield* Ref.make<ReadonlyArray<CollectionQuery>>([]);
		const dialect = new PgDialect();
		type Statement = Parameters<typeof dialect.sqlToQuery>[0];
		const memberEntityRow = {
			userId: "user",
			id: "foreign-entity",
			entitySchemaSlug: "record",
			entitySchemaPluginId: "foreign-plugin",
		};
		const database = {
			select: (selection: Record<string, unknown>) => ({
				from: () => ({
					where: (condition: { getSQL: () => Statement }) => ({
						limit: () => {
							const { sql } = dialect.sqlToQuery(condition.getSQL());
							const columns = Object.keys(selection);
							let rows: ReadonlyArray<typeof memberEntityRow | typeof pluginCollectionRow> = [
								memberEntityRow,
							];
							if (columns.includes("providerId")) {
								if (sql.includes("entity_schema_plugin_id") && sql.includes("is null")) {
									rows = [];
								} else {
									rows = [pluginCollectionRow];
								}
							}
							return Ref.update(entries, (all) => [...all, { sql, columns }]).pipe(
								Effect.andThen(Effect.succeed(rows)),
							);
						},
					}),
				}),
			}),
		};
		const repository = CollectionsRepository.layer.pipe(
			Layer.provideMerge(Layer.mock(DefinitionRepository)({})),
			Layer.provideMerge(fakeDatabaseSession(database)),
		);
		return Layer.merge(repository, Layer.succeed(CollectionQueries, { entries: Ref.get(entries) }));
	}),
);

layer(repositoryLayer)((test) => {
	test.effect("resolves collection definitions only from the kernel namespace", () =>
		Effect.gen(function* () {
			const repository = yield* CollectionsRepository;
			expect(yield* repository.getBuiltinCollectionSchema()).toBeNull();
			expect(yield* (yield* DefinitionLookups).entityReferences).toEqual([
				{ owner: { kind: "kernel" }, slug: EntitySchemaSlug.make("collection") },
			]);
		}),
	);

	test.effect("looks up collection events with an explicit kernel owner", () =>
		Effect.gen(function* () {
			const repository = yield* CollectionsRepository;
			yield* repository.findBuiltinEventSchemaBySlug({
				owner: { kind: "kernel" },
				entitySchemaSlug: EntitySchemaSlug.make("collection"),
				slug: EventSchemaSlug.make("add-entity-to-collection"),
			});
			expect(yield* (yield* DefinitionLookups).eventReferences).toEqual([
				{
					owner: { kind: "kernel" },
					entitySchemaSlug: EntitySchemaSlug.make("collection"),
					slug: EventSchemaSlug.make("add-entity-to-collection"),
				},
			]);
		}),
	);
});

layer(collectionQueriesLayer)((test) => {
	test.effect("filters plugin collections and preserves membership entity owners", () =>
		Effect.gen(function* () {
			const repository = yield* CollectionsRepository;
			const userId = UserId.make("user");
			expect(
				yield* repository.findCollectionByNameForUser({ userId, name: "Favorites" }),
			).toBeNull();
			expect(
				yield* repository.getCollectionById(EntityId.make("plugin-collection"), userId),
			).toBeNull();
			expect(
				yield* repository.getEntityForMembership(EntityId.make("foreign-entity"), userId),
			).toEqual({
				userId,
				entitySchemaSlug: "record",
				id: EntityId.make("foreign-entity"),
				entitySchemaPluginId: "foreign-plugin",
			});
			const [byName, byId, membership] = yield* (yield* CollectionQueries).entries;
			expect(byName?.sql).toContain('"entity"."entity_schema_slug" = $');
			expect(byName?.sql).toContain('"entity"."entity_schema_plugin_id" is null');
			expect(byName?.sql).not.toContain("external_id");
			expect(byName?.sql).not.toContain("provider_id");
			expect(byId?.sql).toContain("entity_schema_plugin_id");
			expect(byId?.sql).toContain("is null");
			expect(membership?.columns).toContain("entitySchemaPluginId");
		}),
	);
});

const insertCollectionRows = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db
				.insert(tables.plugin)
				.values({ status: "inactive", id: "collection-plugin", packageId: testPluginPackageId() });
			yield* db.insert(tables.entity).values([
				{ id: "shelf", name: "Shelf", userId: "owner", entitySchemaSlug: "collection" },
				{ id: "empty", name: "Empty", userId: "owner", entitySchemaSlug: "collection" },
				{ name: "A", id: "member-a", userId: "owner", entitySchemaSlug: "record" },
				{ name: "B", id: "member-b", userId: "owner", entitySchemaSlug: "record" },
				{ name: "C", id: "member-c", userId: "owner", entitySchemaSlug: "record" },
			]);
			const membership = {
				userId: "owner",
				targetEntityId: "shelf",
				relationshipSchemaSlug: "member-of",
			};
			yield* db.insert(tables.relationship).values([
				{ ...membership, id: "a", properties: { rank: -2 }, sourceEntityId: "member-a" },
				{ ...membership, id: "b", sourceEntityId: "member-b", properties: { rank: "-99" } },
				{ ...membership, id: "c", sourceEntityId: "member-c", properties: { note: "unranked" } },
			]);
		}),
	);
});

layer(CollectionsRepository.layer.pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
	test.effect("reads memberships and the lowest numeric member rank of one collection", () =>
		Effect.gen(function* () {
			yield* insertCollectionRows;
			const repository = yield* CollectionsRepository;
			const userId = UserId.make("owner");
			const shelf = EntityId.make("shelf");
			expect(yield* repository.findLowestMemberRank({ userId, collectionId: shelf })).toBe(-2);
			expect(
				yield* repository.findLowestMemberRank({ userId, collectionId: EntityId.make("empty") }),
			).toBeNull();
			expect(
				yield* repository.findLowestMemberRank({
					collectionId: shelf,
					userId: UserId.make("recipient"),
				}),
			).toBeNull();
			expect(
				yield* repository.findMembership({
					userId,
					collectionId: shelf,
					entityId: EntityId.make("member-c"),
				}),
			).toEqual({ id: "c", properties: { note: "unranked" } });
			expect(
				yield* repository.findCollectionByNameForUser({ userId, name: "Shelf" }),
			).toMatchObject({ id: shelf });
		}),
	);

	test.effect("enforces unique kernel collection names per user only", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const insert = (row: { id: string } & Partial<typeof tables.entity.$inferInsert>) =>
				Effect.result(
					session.transaction(
						session.run((db) =>
							db
								.insert(tables.entity)
								.values({ name: "Shelf", userId: "owner", entitySchemaSlug: "collection", ...row }),
						),
					),
				);
			const duplicate = yield* insert({ id: "duplicate" });
			expect(Result.isFailure(duplicate) && duplicate.failure).toMatchObject({
				code: "23505",
				constraint: "entity_collection_name_unique",
			});
			for (const row of [
				{ id: "other-user", userId: "recipient" },
				{ id: "record", entitySchemaSlug: "record" },
				{ id: "plugin", entitySchemaPluginId: "collection-plugin" },
			]) {
				expect(Result.isSuccess(yield* insert(row))).toBe(true);
			}
		}),
	);
});
