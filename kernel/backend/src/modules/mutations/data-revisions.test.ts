import { assert, expect, layer } from "@effect/vitest";
import {
	EntityId,
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { and, eq, isNull } from "drizzle-orm";
import { Effect, Exit, Layer } from "effect";

import { EntitiesRepository } from "#modules/entities/repository";
import { EventStreamRepository } from "#modules/events/stream-repository";
import { DataRevisions } from "#modules/mutations/data-revisions";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { testPluginPackageId } from "#modules/plugins/test-support";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { DatabaseSession } from "#platform/db/session";
import { dataRevision } from "#schema/tables/data-revisions";
import { entity, relationship } from "#schema/tables/entities";

const ownerId = UserId.make("owner");
const recipientId = UserId.make("recipient");

type TestPlugin = {
	pluginId: string;
	entitySchemaSlug: EntitySchemaSlug;
	relationshipSchemaSlug: RelationshipSchemaSlug;
};

const dataRevisionTestLayer = Layer.mergeAll(
	DataRevisions.layer,
	RelationshipsRepository.layer,
	EntitiesRepository.layer.pipe(Layer.provideMerge(EventStreamRepository.layer)),
).pipe(Layer.provideMerge(revisionDatabaseLayer));

const installPlugin = (prefix: string) =>
	Effect.gen(function* () {
		const slug = `${prefix}-${crypto.randomUUID()}`;
		const installed = yield* installRevisionPackage(
			revisionPackage(slug, "v1", `${slug}-entity`, testPluginPackageId()),
			ownerId,
		);
		return {
			pluginId: installed.pluginId,
			entitySchemaSlug: EntitySchemaSlug.make(`${slug}-entity`),
			relationshipSchemaSlug: RelationshipSchemaSlug.make(`${slug}-link`),
		} satisfies TestPlugin;
	});

const revisionForScope = (pluginId: string, userId: UserId | null) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const [row] = yield* session.run((db) =>
			db
				.select({ revision: dataRevision.revision })
				.from(dataRevision)
				.where(
					and(
						eq(dataRevision.pluginId, pluginId),
						userId === null ? isNull(dataRevision.userId) : eq(dataRevision.userId, userId),
					),
				)
				.limit(1),
		);
		return row?.revision ?? 0;
	});

const validateRevision = (input: {
	pluginId: string;
	userId: UserId;
	globalRevision?: number;
	userRevision?: number;
}) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const revisions = yield* DataRevisions;
		return yield* session.transaction(revisions.validate(input));
	});

const insertGlobalEntity = (plugin: TestPlugin, name: string, id?: EntityId) =>
	Effect.gen(function* () {
		const entities = yield* EntitiesRepository;
		const [created] = yield* entities.insertEntities([
			{
				...(id ? { id } : {}),
				name,
				properties: {},
				scope: "global",
				populatedAt: null,
				entitySchemaPluginId: plugin.pluginId,
				entitySchemaSlug: plugin.entitySchemaSlug,
			},
		]);
		assert(created);
		return created;
	});

const insertUserEntity = (plugin: TestPlugin, userId: UserId, name: string) =>
	Effect.gen(function* () {
		const entities = yield* EntitiesRepository;
		const [created] = yield* entities.insertEntities([
			{
				name,
				userId,
				scope: "user",
				properties: {},
				populatedAt: null,
				entitySchemaPluginId: plugin.pluginId,
				entitySchemaSlug: plugin.entitySchemaSlug,
			},
		]);
		assert(created);
		return created;
	});

const createGlobalRelationship = (
	plugin: TestPlugin,
	sourceEntityId: EntityId,
	targetEntityId: EntityId,
) =>
	Effect.gen(function* () {
		const relationships = yield* RelationshipsRepository;
		return yield* relationships.createRelationship({
			properties: {},
			sourceEntityId,
			targetEntityId,
			scope: "global",
			relationshipSchemaPluginId: plugin.pluginId,
			relationshipSchemaSlug: plugin.relationshipSchemaSlug,
		});
	});

layer(dataRevisionTestLayer)((test) => {
	test.effect("rejects a stale global revision after an entity insert", () =>
		Effect.gen(function* () {
			const plugin = yield* installPlugin("entity-insert");
			const token = yield* revisionForScope(plugin.pluginId, null);
			expect(
				yield* validateRevision({
					userId: ownerId,
					globalRevision: token,
					pluginId: plugin.pluginId,
				}),
			).toBe(true);

			yield* insertGlobalEntity(plugin, "inserted entity");

			expect(
				yield* validateRevision({
					userId: ownerId,
					globalRevision: token,
					pluginId: plugin.pluginId,
				}),
			).toBe(false);
			const freshToken = yield* revisionForScope(plugin.pluginId, null);
			expect(freshToken).toBe(token + 1);
			expect(
				yield* validateRevision({
					userId: ownerId,
					pluginId: plugin.pluginId,
					globalRevision: freshToken,
				}),
			).toBe(true);
		}),
	);

	test.effect("rejects a stale global revision after an entity update", () =>
		Effect.gen(function* () {
			const plugin = yield* installPlugin("entity-update");
			const existing = yield* insertGlobalEntity(plugin, "before update");
			const token = yield* revisionForScope(plugin.pluginId, null);
			expect(
				yield* validateRevision({
					userId: ownerId,
					globalRevision: token,
					pluginId: plugin.pluginId,
				}),
			).toBe(true);

			const session = yield* DatabaseSession;
			const entities = yield* EntitiesRepository;
			const updated = yield* session.transaction(
				entities.updateEntity({
					populatedAt: null,
					name: "after update",
					entityId: existing.id,
					properties: { changed: true },
				}),
			);
			expect(updated.name).toBe("after update");

			expect(
				yield* validateRevision({
					userId: ownerId,
					globalRevision: token,
					pluginId: plugin.pluginId,
				}),
			).toBe(false);
			const freshToken = yield* revisionForScope(plugin.pluginId, null);
			expect(freshToken).toBe(token + 1);
			expect(
				yield* validateRevision({
					userId: ownerId,
					pluginId: plugin.pluginId,
					globalRevision: freshToken,
				}),
			).toBe(true);
		}),
	);

	test.effect("rejects a stale global revision after an entity delete", () =>
		Effect.gen(function* () {
			const plugin = yield* installPlugin("entity-delete");
			const existing = yield* insertGlobalEntity(plugin, "deleted entity");
			const token = yield* revisionForScope(plugin.pluginId, null);
			expect(
				yield* validateRevision({
					userId: ownerId,
					globalRevision: token,
					pluginId: plugin.pluginId,
				}),
			).toBe(true);

			const deleted = yield* (yield* EntitiesRepository).deleteByIds([existing.id]);
			expect(deleted).toBe(1);

			expect(
				yield* validateRevision({
					userId: ownerId,
					globalRevision: token,
					pluginId: plugin.pluginId,
				}),
			).toBe(false);
			const freshToken = yield* revisionForScope(plugin.pluginId, null);
			expect(freshToken).toBe(token + 1);
			expect(
				yield* validateRevision({
					userId: ownerId,
					pluginId: plugin.pluginId,
					globalRevision: freshToken,
				}),
			).toBe(true);
		}),
	);

	test.effect("rejects a stale global revision after a relationship insert", () =>
		Effect.gen(function* () {
			const plugin = yield* installPlugin("relationship-insert");
			const source = yield* insertGlobalEntity(plugin, "relationship source");
			const target = yield* insertGlobalEntity(plugin, "relationship target");
			const token = yield* revisionForScope(plugin.pluginId, null);
			expect(
				yield* validateRevision({
					userId: ownerId,
					globalRevision: token,
					pluginId: plugin.pluginId,
				}),
			).toBe(true);

			const created = yield* createGlobalRelationship(plugin, source.id, target.id);
			expect(created.wasInserted).toBe(true);

			expect(
				yield* validateRevision({
					userId: ownerId,
					globalRevision: token,
					pluginId: plugin.pluginId,
				}),
			).toBe(false);
			const freshToken = yield* revisionForScope(plugin.pluginId, null);
			expect(freshToken).toBe(token + 1);
			expect(
				yield* validateRevision({
					userId: ownerId,
					pluginId: plugin.pluginId,
					globalRevision: freshToken,
				}),
			).toBe(true);
		}),
	);

	test.effect("rejects a stale global revision after a relationship update", () =>
		Effect.gen(function* () {
			const plugin = yield* installPlugin("relationship-update");
			const source = yield* insertGlobalEntity(plugin, "relationship source");
			const target = yield* insertGlobalEntity(plugin, "relationship target");
			const existing = yield* createGlobalRelationship(plugin, source.id, target.id);
			const token = yield* revisionForScope(plugin.pluginId, null);
			expect(
				yield* validateRevision({
					userId: ownerId,
					globalRevision: token,
					pluginId: plugin.pluginId,
				}),
			).toBe(true);

			const updated = yield* (yield* RelationshipsRepository).updateRelationshipsById([
				{ id: existing.id, properties: { changed: true } },
			]);
			expect(updated.get(existing.id)?.properties).toEqual({ changed: true });

			expect(
				yield* validateRevision({
					userId: ownerId,
					globalRevision: token,
					pluginId: plugin.pluginId,
				}),
			).toBe(false);
			const freshToken = yield* revisionForScope(plugin.pluginId, null);
			expect(freshToken).toBe(token + 1);
			expect(
				yield* validateRevision({
					userId: ownerId,
					pluginId: plugin.pluginId,
					globalRevision: freshToken,
				}),
			).toBe(true);
		}),
	);

	test.effect("rejects a stale global revision after a relationship delete", () =>
		Effect.gen(function* () {
			const plugin = yield* installPlugin("relationship-delete");
			const source = yield* insertGlobalEntity(plugin, "relationship source");
			const target = yield* insertGlobalEntity(plugin, "relationship target");
			const existing = yield* createGlobalRelationship(plugin, source.id, target.id);
			const token = yield* revisionForScope(plugin.pluginId, null);
			expect(
				yield* validateRevision({
					userId: ownerId,
					globalRevision: token,
					pluginId: plugin.pluginId,
				}),
			).toBe(true);

			const deleted = yield* (yield* RelationshipsRepository).deleteRelationshipsById([
				existing.id,
			]);
			expect(deleted.has(existing.id)).toBe(true);

			expect(
				yield* validateRevision({
					userId: ownerId,
					globalRevision: token,
					pluginId: plugin.pluginId,
				}),
			).toBe(false);
			const freshToken = yield* revisionForScope(plugin.pluginId, null);
			expect(freshToken).toBe(token + 1);
			expect(
				yield* validateRevision({
					userId: ownerId,
					pluginId: plugin.pluginId,
					globalRevision: freshToken,
				}),
			).toBe(true);
		}),
	);

	test.effect("rolls back an entity mutation and its data revision together", () =>
		Effect.gen(function* () {
			const plugin = yield* installPlugin("entity-rollback");
			const token = yield* revisionForScope(plugin.pluginId, null);
			expect(
				yield* validateRevision({
					userId: ownerId,
					globalRevision: token,
					pluginId: plugin.pluginId,
				}),
			).toBe(true);

			const id = EntityId.make(`rollback-${crypto.randomUUID()}`);
			const session = yield* DatabaseSession;
			const rollback = yield* Effect.exit(
				session.transaction(
					Effect.gen(function* () {
						yield* insertGlobalEntity(plugin, "rolled back entity", id);
						return yield* Effect.fail("rollback transaction");
					}),
				),
			);
			expect(Exit.isFailure(rollback)).toBe(true);

			const stored = yield* session.run((db) =>
				db.select({ id: entity.id }).from(entity).where(eq(entity.id, id)),
			);
			expect(stored).toEqual([]);
			expect(yield* revisionForScope(plugin.pluginId, null)).toBe(token);
			expect(
				yield* validateRevision({
					userId: ownerId,
					globalRevision: token,
					pluginId: plugin.pluginId,
				}),
			).toBe(true);
		}),
	);

	test.effect("isolates a plugin global revision from user and other-plugin mutations", () =>
		Effect.gen(function* () {
			const observedPlugin = yield* installPlugin("scope-observed");
			const otherPlugin = yield* installPlugin("scope-other");
			const globalToken = yield* revisionForScope(observedPlugin.pluginId, null);
			const userToken = yield* revisionForScope(observedPlugin.pluginId, recipientId);
			expect(
				yield* validateRevision({
					userId: recipientId,
					userRevision: userToken,
					globalRevision: globalToken,
					pluginId: observedPlugin.pluginId,
				}),
			).toBe(true);

			yield* insertUserEntity(observedPlugin, recipientId, "user-scoped entity");
			yield* insertGlobalEntity(otherPlugin, "other plugin entity");

			expect(yield* revisionForScope(observedPlugin.pluginId, null)).toBe(globalToken);
			expect(yield* revisionForScope(observedPlugin.pluginId, recipientId)).toBe(userToken + 1);
			expect(
				yield* validateRevision({
					userId: recipientId,
					globalRevision: globalToken,
					pluginId: observedPlugin.pluginId,
				}),
			).toBe(true);
			expect(
				yield* validateRevision({
					userId: recipientId,
					userRevision: userToken,
					pluginId: observedPlugin.pluginId,
				}),
			).toBe(false);
			const freshUserToken = yield* revisionForScope(observedPlugin.pluginId, recipientId);
			expect(
				yield* validateRevision({
					userId: recipientId,
					userRevision: freshUserToken,
					pluginId: observedPlugin.pluginId,
				}),
			).toBe(true);
		}),
	);

	test.effect("invalidates a cross-owner relationship scope after cascading entity deletion", () =>
		Effect.gen(function* () {
			const entityPlugin = yield* installPlugin("cascade-entity-owner");
			const relationshipPlugin = yield* installPlugin("cascade-relationship-owner");
			const source = yield* insertGlobalEntity(entityPlugin, "cascade source");
			const target = yield* insertGlobalEntity(entityPlugin, "cascade target");
			const relationships = yield* RelationshipsRepository;
			const created = yield* relationships.createRelationship({
				scope: "user",
				properties: {},
				userId: recipientId,
				sourceEntityId: source.id,
				targetEntityId: target.id,
				relationshipSchemaPluginId: relationshipPlugin.pluginId,
				relationshipSchemaSlug: relationshipPlugin.relationshipSchemaSlug,
			});
			const token = yield* revisionForScope(relationshipPlugin.pluginId, recipientId);
			expect(
				yield* validateRevision({
					userId: recipientId,
					userRevision: token,
					pluginId: relationshipPlugin.pluginId,
				}),
			).toBe(true);

			const deleted = yield* (yield* EntitiesRepository).deleteByIds([source.id]);
			expect(deleted).toBe(1);
			const remainingRelationship = yield* (yield* DatabaseSession).run((db) =>
				db
					.select({ id: relationship.id })
					.from(relationship)
					.where(eq(relationship.id, created.id)),
			);
			expect(remainingRelationship).toEqual([]);

			expect(yield* revisionForScope(relationshipPlugin.pluginId, recipientId)).toBe(token + 1);
			expect(
				yield* validateRevision({
					userId: recipientId,
					userRevision: token,
					pluginId: relationshipPlugin.pluginId,
				}),
			).toBe(false);
			const freshToken = yield* revisionForScope(relationshipPlugin.pluginId, recipientId);
			expect(
				yield* validateRevision({
					userId: recipientId,
					userRevision: freshToken,
					pluginId: relationshipPlugin.pluginId,
				}),
			).toBe(true);
		}),
	);
});
