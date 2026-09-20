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
import { Context, Effect, Layer, Ref } from "effect";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import { fakeDatabaseSession } from "#lib/test-utils/effect";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import type { EntitySchemaSnapshot } from "#modules/definition-registry/snapshot";

import { CollectionsRepository } from "./repository";

const pluginCollectionSchema: EntitySchemaSnapshot = {
	eventSchemas: {},
	icon: "collection",
	name: "Plugin collection",
	mergeIdentityProperties: [],
	pluginSlug: "collection-plugin",
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

class DefinitionLookups extends Context.Service<
	DefinitionLookups,
	{
		readonly entityReferences: Effect.Effect<ReadonlyArray<DeclarationReference>>;
		readonly eventReferences: Effect.Effect<ReadonlyArray<EventSchemaReference>>;
	}
>()("test/DefinitionLookups") {}

type CollectionQuery = { readonly sql: string; readonly columns: ReadonlyArray<string> };

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
							let rows: ReadonlyArray<typeof pluginCollectionRow | typeof memberEntityRow> = [
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
				yield* repository.findCollectionByNameForUser({
					userId,
					name: "Favorites",
					entitySchemaSlug: EntitySchemaSlug.make("collection"),
				}),
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
			expect(byName?.sql).toContain("entity_schema_plugin_id");
			expect(byName?.sql).toContain("is null");
			expect(byId?.sql).toContain("entity_schema_plugin_id");
			expect(byId?.sql).toContain("is null");
			expect(membership?.columns).toContain("entitySchemaPluginId");
		}),
	);
});
