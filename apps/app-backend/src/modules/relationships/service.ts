import {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot/contract/modules/relationships/schemas";
import type {
	EntityId,
	RelationshipId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { Context, Effect, Layer } from "effect";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import {
	RelationshipsRepository,
	type GlobalRelationshipListInput,
	type RelationshipIdentityInput,
} from "./repository";

type CreateRelationshipInput = RelationshipIdentityInput & {
	properties: unknown;
	propertiesSchema: AppSchema;
};

type UpdateRelationshipInput = RelationshipIdentityInput & {
	properties: unknown;
	propertiesSchema: AppSchema;
};

type UserRelationshipIdentity = {
	sourceEntityId: EntityId;
	targetEntityId: EntityId;
	relationshipSchemaSlug: RelationshipSchemaSlug;
};

export type ChangeUserRelationshipBatch = {
	creates: ReadonlyArray<UserRelationshipIdentity & { properties: unknown }>;
	deletes: ReadonlyArray<UserRelationshipIdentity>;
};

export type ReconcileGlobalRelationshipGroup = {
	relationshipSchemaSlug: RelationshipSchemaSlug;
	selector:
		| { type: "self" }
		| { type: "anchored"; direction: "incoming" | "outgoing"; anchorEntityId: EntityId };
	relationships: ReadonlyArray<{
		properties: unknown;
		sourceEntityId: EntityId;
		targetEntityId: EntityId;
	}>;
};

const relationshipKey = (input: { sourceEntityId: EntityId; targetEntityId: EntityId }) =>
	`${input.sourceEntityId}\u0000${input.targetEntityId}`;

export const changeUserRelationships = Effect.fn("RelationshipsService.changeUser")(function* (
	userId: UserId,
	batches: ReadonlyArray<ChangeUserRelationshipBatch>,
) {
	const database = yield* Database;
	const entities = yield* EntitiesRepository;
	const pluginRuntime = yield* PluginRuntimeResolver;
	const definitions = yield* pluginRuntime.getEffectiveDefinitions(userId);
	const repository = yield* RelationshipsRepository;

	const validate = Effect.fn("RelationshipsService.validateUserChange")(function* (
		change: UserRelationshipIdentity,
	) {
		const definition = definitions.relationshipSchemas[change.relationshipSchemaSlug];
		if (!definition) {
			return yield* new RelationshipNotFound({
				reason: {
					code: "relationship-schema-not-found",
					relationshipSchemaSlug: change.relationshipSchemaSlug,
				},
			});
		}
		const [source, target] = yield* Effect.all([
			entities.getEntityScopeForUser({ userId, entityId: change.sourceEntityId }),
			entities.getEntityScopeForUser({ userId, entityId: change.targetEntityId }),
		]);
		if (!source || !target) {
			return yield* new RelationshipNotFound({
				reason: {
					code: "entity-not-found",
					entityIds: [change.sourceEntityId, change.targetEntityId],
				},
			});
		}
		if (
			definition.sourceEntitySchemaSlug &&
			definition.sourceEntitySchemaSlug !== source.entitySchemaSlug
		) {
			return yield* new RelationshipBadRequest({
				reason: {
					code: "source-schema-mismatch",
					actual: source.entitySchemaSlug,
					expected: definition.sourceEntitySchemaSlug,
				},
			});
		}
		if (
			definition.targetEntitySchemaSlug &&
			definition.targetEntitySchemaSlug !== target.entitySchemaSlug
		) {
			return yield* new RelationshipBadRequest({
				reason: {
					code: "target-schema-mismatch",
					actual: target.entitySchemaSlug,
					expected: definition.targetEntitySchemaSlug,
				},
			});
		}
		return definition;
	});

	return yield* Effect.forEach(batches, (batch) =>
		mapDatabaseErrors(
			database.transaction((transaction) =>
				Effect.gen(function* () {
					let created = 0;
					let deleted = 0;
					for (const create of batch.creates) {
						const definition = yield* validate(create);
						const properties = yield* parseAppSchemaProperties({
							kind: "Relationship",
							properties: create.properties,
							propertiesSchema: definition.propertiesSchema,
						}).pipe(
							Effect.mapError(
								(error) =>
									new RelationshipBadRequest({
										reason: {
											code: "invalid-properties",
											paths: error.issues.map(({ path }) => path),
										},
									}),
							),
						);
						const saved = yield* repository.createRelationship({
							...create,
							userId,
							properties,
							scope: "user",
							relationshipSchemaPluginId: definition.pluginId ?? null,
						});
						if (saved.wasInserted) {
							created += 1;
						}
					}
					for (const remove of batch.deletes) {
						const definition = yield* validate(remove);
						const removed = yield* repository.deleteRelationship({
							...remove,
							userId,
							scope: "user",
							relationshipSchemaPluginId: definition.pluginId ?? null,
						});
						if (removed) {
							deleted += 1;
						}
					}
					return { created, deleted };
				}).pipe(Effect.provideService(Database, transaction)),
			),
		),
	);
});

export const reconcileGlobalRelationships = Effect.fn("RelationshipsService.reconcileGlobal")(
	function* (groups: ReadonlyArray<ReconcileGlobalRelationshipGroup>) {
		const database = yield* Database;
		const definitions = yield* DefinitionRegistry;
		const repository = yield* RelationshipsRepository;

		return yield* Effect.forEach(groups, (group) =>
			mapDatabaseErrors(
				database.transaction((transaction) =>
					Effect.gen(function* () {
						const definition = definitions.getRelationshipSchema(group.relationshipSchemaSlug);
						if (!definition) {
							return yield* new RelationshipNotFound({
								reason: {
									code: "relationship-schema-not-found",
									relationshipSchemaSlug: group.relationshipSchemaSlug,
								},
							});
						}

						const selector = {
							...group.selector,
							relationshipSchemaSlug: group.relationshipSchemaSlug,
							relationshipSchemaPluginId: definition.pluginId ?? null,
						} satisfies GlobalRelationshipListInput;
						const existing = yield* repository.listGlobalRelationships(selector);
						const seen = new Set<string>();
						const relationships = yield* Effect.forEach(group.relationships, (relationship) =>
							Effect.gen(function* () {
								let matchesSelector = relationship.sourceEntityId === relationship.targetEntityId;
								if (group.selector.type === "anchored") {
									matchesSelector =
										group.selector.direction === "outgoing"
											? relationship.sourceEntityId === group.selector.anchorEntityId
											: relationship.targetEntityId === group.selector.anchorEntityId;
								}
								if (!matchesSelector) {
									return yield* new RelationshipBadRequest({
										reason: { code: "reconciliation-selector-mismatch" },
									});
								}

								const key = relationshipKey(relationship);
								if (seen.has(key)) {
									return yield* new RelationshipBadRequest({
										reason: { code: "duplicate-reconciliation-relationship" },
									});
								}
								seen.add(key);

								const properties = yield* parseAppSchemaProperties({
									propertiesSchema: definition.propertiesSchema,
									kind: "Relationship",
									properties: relationship.properties,
								}).pipe(
									Effect.mapError(
										(error) =>
											new RelationshipBadRequest({
												reason: {
													code: "invalid-properties",
													paths: error.issues.map(({ path }) => path),
												},
											}),
									),
								);
								return { ...relationship, properties };
							}),
						);

						for (const relationship of relationships) {
							const input = {
								...relationship,
								scope: "global" as const,
								relationshipSchemaSlug: group.relationshipSchemaSlug,
								relationshipSchemaPluginId: definition.pluginId ?? null,
							};
							const saved = yield* repository.createRelationship(input);
							if (!saved.wasInserted) {
								yield* repository.updateRelationship(input);
							}
						}

						let deleted = 0;
						for (const relationship of existing) {
							if (seen.has(relationshipKey(relationship))) {
								continue;
							}
							const removed = yield* repository.deleteRelationship({
								scope: "global",
								sourceEntityId: relationship.sourceEntityId,
								targetEntityId: relationship.targetEntityId,
								relationshipSchemaSlug: group.relationshipSchemaSlug,
								relationshipSchemaPluginId: definition.pluginId ?? null,
							});
							if (removed) {
								deleted += 1;
							}
						}

						return { deleted, upserted: relationships.length };
					}).pipe(Effect.provideService(Database, transaction)),
				),
			),
		);
	},
);

export class RelationshipsService extends Context.Service<RelationshipsService>()(
	"RelationshipsService",
	{
		make: Effect.gen(function* () {
			const pluginRuntime = yield* PluginRuntimeResolver;
			const repository = yield* RelationshipsRepository;

			const parseProperties = Effect.fn("RelationshipsService.parseProperties")(function* (input: {
				properties: unknown;
				propertiesSchema: AppSchema;
			}) {
				return yield* parseAppSchemaProperties({
					kind: "Relationship",
					properties: input.properties,
					propertiesSchema: input.propertiesSchema,
				}).pipe(
					Effect.mapError(
						(error) =>
							new RelationshipBadRequest({
								reason: { code: "invalid-properties", paths: error.issues.map(({ path }) => path) },
							}),
					),
				);
			});

			const create = Effect.fn("RelationshipsService.create")(function* (
				input: CreateRelationshipInput,
			) {
				const { propertiesSchema, ...saveInput } = input;
				const properties = yield* parseProperties({
					propertiesSchema,
					properties: input.properties,
				});

				return yield* repository.createRelationship({ ...saveInput, properties });
			});

			const update = Effect.fn("RelationshipsService.update")(function* (
				input: UpdateRelationshipInput,
			) {
				const { propertiesSchema, ...updateInput } = input;
				const properties = yield* parseProperties({
					propertiesSchema,
					properties: input.properties,
				});
				const updated = yield* repository.updateRelationship({ ...updateInput, properties });
				if (!updated) {
					return yield* new RelationshipNotFound({ reason: { code: "relationship-not-found" } });
				}
				return updated;
			});

			const mergeUserProperties = Effect.fn("RelationshipsService.mergeUserProperties")(function* (
				input: CreateRelationshipInput & { userId: UserId },
			) {
				const database = yield* Database;
				return yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						Effect.gen(function* () {
							const merge = (existing: unknown) => {
								const current = isObjectRecord(existing) ? existing : {};
								const incoming = isObjectRecord(input.properties) ? input.properties : {};
								const merged = { ...current, ...incoming };
								for (const [key, value] of Object.entries(incoming)) {
									if (Array.isArray(value) && Array.isArray(current[key])) {
										const seen = new Set<string>();
										merged[key] = [...current[key], ...value].filter((item) => {
											const encoded = JSON.stringify(item);
											if (seen.has(encoded)) {
												return false;
											}
											seen.add(encoded);
											return true;
										});
									}
								}
								return parseProperties({
									properties: merged,
									propertiesSchema: input.propertiesSchema,
								});
							};
							const { propertiesSchema: _propertiesSchema, ...saveInput } = input;
							const existing = yield* repository.findRelationshipProperties(input);
							const properties = yield* merge(existing);
							if (existing) {
								return yield* repository.updateRelationship({ ...saveInput, properties });
							}
							const created = yield* repository.createRelationship({ ...saveInput, properties });
							if (created.wasInserted) {
								return created;
							}
							const conflicted = yield* repository.findRelationshipProperties(input);
							const updated = yield* repository.updateRelationship({
								...saveInput,
								properties: yield* merge(conflicted),
							});
							if (!updated) {
								return yield* new RelationshipNotFound({
									reason: { code: "relationship-not-found" },
								});
							}
							return updated;
						}).pipe(Effect.provideService(Database, transaction)),
					),
				);
			});

			const deleteRelationship = Effect.fn("RelationshipsService.delete")(function* (
				input: RelationshipIdentityInput,
			) {
				return yield* repository.deleteRelationship(input);
			});

			const deleteUserRelationshipById = Effect.fn(
				"RelationshipsService.deleteUserRelationshipById",
			)(function* (userId: UserId, relationshipId: RelationshipId) {
				return yield* repository.deleteUserRelationshipById(userId, relationshipId);
			});

			const listGlobal = Effect.fn("RelationshipsService.listGlobal")(function* (
				input: GlobalRelationshipListInput,
			) {
				return yield* repository.listGlobalRelationships(input);
			});

			return {
				create,
				update,
				listGlobal,
				mergeUserProperties,
				delete: deleteRelationship,
				deleteUserRelationshipById,
				changeUser: (userId: UserId, batches: ReadonlyArray<ChangeUserRelationshipBatch>) =>
					changeUserRelationships(userId, batches).pipe(
						Effect.provideService(PluginRuntimeResolver, pluginRuntime),
						Effect.provideService(RelationshipsRepository, repository),
					),
				reconcileGlobal: (groups: ReadonlyArray<ReconcileGlobalRelationshipGroup>) =>
					reconcileGlobalRelationships(groups).pipe(
						Effect.provideService(RelationshipsRepository, repository),
					),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
