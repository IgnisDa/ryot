import { DbError } from "@ryot/contract/errors";
import type { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	type SandboxProviderId,
	UserId,
} from "@ryot/contract/schema/brands";
import { and, asc, count, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import {
	entitySelection,
	entityVisibleToUserClause,
	toListedEntity,
	type EntitySchemaProviderDetailsScope,
	type EntitySchemaScope,
} from "./repository-support";

export type InsertEntityInputBase = {
	name: string;
	entitySchemaSlug: EntitySchemaSlug;
	origin?: AutomationOrigin | null | undefined;
	entitySchemaPluginId?: string | null | undefined;
} & (
	| {
			scope: "global";
			populatedAt: Date | null;
			externalId?: string | undefined;
			providerId?: SandboxProviderId | undefined;
	  }
	| {
			scope: "user";
			userId: UserId;
			externalId?: string | undefined;
			providerId?: SandboxProviderId | undefined;
	  }
);

export type InsertEntityInput = InsertEntityInputBase & { properties: Record<string, unknown> };

export type UpdateEntityInput = {
	name: string;
	entityId: EntityId;
	populatedAt: Date | null;
	properties: Record<string, unknown>;
};

export type GlobalEntityProvenanceScopeInput = {
	providerId: SandboxProviderId;
	entitySchemaSlug: EntitySchemaSlug;
	entitySchemaPluginId: string | null;
};

export type PortableEntityRecord = Pick<
	typeof schema.entity.$inferSelect,
	| "id"
	| "name"
	| "createdAt"
	| "updatedAt"
	| "properties"
	| "externalId"
	| "populatedAt"
	| "entitySchemaPluginId"
	| "entitySchemaSlug"
	| "origin"
> & {
	readonly provider: {
		readonly pluginId: string;
		readonly pluginSlug: string;
		readonly providerSlug: string;
	} | null;
};

type RestoreEntityInput = Pick<
	typeof schema.entity.$inferInsert,
	| "id"
	| "name"
	| "userId"
	| "createdAt"
	| "updatedAt"
	| "properties"
	| "externalId"
	| "populatedAt"
	| "providerId"
	| "entitySchemaPluginId"
	| "entitySchemaSlug"
	| "origin"
>;

const portableEntitySelection = {
	id: schema.entity.id,
	name: schema.entity.name,
	origin: schema.entity.origin,
	pluginSlug: schema.plugin.slug,
	providerPluginId: schema.plugin.id,
	createdAt: schema.entity.createdAt,
	updatedAt: schema.entity.updatedAt,
	properties: schema.entity.properties,
	externalId: schema.entity.externalId,
	populatedAt: schema.entity.populatedAt,
	providerSlug: schema.sandboxProvider.slug,
	entitySchemaSlug: schema.entity.entitySchemaSlug,
	entitySchemaPluginId: schema.entity.entitySchemaPluginId,
};

const toPortableEntity = (
	row: Omit<PortableEntityRecord, "provider"> & {
		readonly providerPluginId: string | null;
		readonly pluginSlug: string | null;
		readonly providerSlug: string | null;
	},
): PortableEntityRecord => {
	const { pluginSlug, providerSlug, providerPluginId, ...entity } = row;
	return {
		...entity,
		provider:
			pluginSlug === null || providerSlug === null || providerPluginId === null
				? null
				: { pluginId: providerPluginId, pluginSlug, providerSlug },
	};
};

const entitySchemaPluginWhere = (pluginId: string | null | undefined) =>
	pluginId == null
		? isNull(schema.entity.entitySchemaPluginId)
		: eq(schema.entity.entitySchemaPluginId, pluginId);

const providerWhere = (providerId: SandboxProviderId | null | undefined) =>
	providerId == null ? isNull(schema.entity.providerId) : eq(schema.entity.providerId, providerId);

export class EntitiesRepository extends Context.Service<EntitiesRepository>()(
	"EntitiesRepository",
	{
		make: Effect.gen(function* () {
			const definitions = yield* DefinitionRegistry;
			const pluginRuntime = yield* PluginRuntimeResolver;
			const listMatchCandidatesBySchema = Effect.fn(
				"EntitiesRepository.listMatchCandidatesBySchema",
			)(function* (input: { userId: UserId; entitySchemaSlug: EntitySchemaSlug }) {
				const effective = yield* pluginRuntime.getEffectiveDefinitions(input.userId);
				const definition = effective.entitySchemas[input.entitySchemaSlug];
				if (!definition) {
					return [];
				}
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select(entitySelection)
						.from(schema.entity)
						.where(
							and(
								entityVisibleToUserClause(input.userId),
								eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
								entitySchemaPluginWhere(definition.pluginId),
							),
						)
						.orderBy(
							sql`case when ${schema.entity.userId} = ${input.userId} then 0 else 1 end`,
							asc(schema.entity.name),
							asc(schema.entity.createdAt),
						),
				);
				return rows.map(toListedEntity);
			});

			const listEntityReferencesByIds = Effect.fn("EntitiesRepository.listEntityReferencesByIds")(
				function* (entityIds: ReadonlyArray<EntityId>) {
					if (entityIds.length === 0) {
						return [];
					}

					const db = yield* Database;
					const rows = yield* mapDatabaseErrors(
						db
							.select({
								id: schema.entity.id,
								name: schema.entity.name,
								entitySchemaSlug: schema.entity.entitySchemaSlug,
							})
							.from(schema.entity)
							.where(inArray(schema.entity.id, [...entityIds]))
							.orderBy(asc(schema.entity.id)),
					);

					return rows.map((row) => ({
						name: row.name,
						id: EntityId.make(row.id),
						entitySchemaSlug: row.entitySchemaSlug,
					}));
				},
			);

			const listUserEntitiesForBackup = Effect.fn("EntitiesRepository.listUserEntitiesForBackup")(
				function* (userId: UserId) {
					const db = yield* Database;
					const rows = yield* mapDatabaseErrors(
						db
							.select(portableEntitySelection)
							.from(schema.entity)
							.leftJoin(
								schema.sandboxProvider,
								eq(schema.entity.providerId, schema.sandboxProvider.id),
							)
							.leftJoin(schema.plugin, eq(schema.plugin.id, schema.sandboxProvider.pluginId))
							.where(eq(schema.entity.userId, userId))
							.orderBy(asc(schema.entity.id)),
					);
					return rows.map(toPortableEntity);
				},
			);

			const listReferencedGlobalEntitiesForBackup = Effect.fn(
				"EntitiesRepository.listReferencedGlobalEntitiesForBackup",
			)(function* (userId: UserId) {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select(portableEntitySelection)
						.from(schema.entity)
						.leftJoin(
							schema.sandboxProvider,
							eq(schema.entity.providerId, schema.sandboxProvider.id),
						)
						.leftJoin(schema.plugin, eq(schema.plugin.id, schema.sandboxProvider.pluginId))
						.where(
							and(
								isNull(schema.entity.userId),
								or(
									exists(
										db
											.select({ id: schema.relationship.id })
											.from(schema.relationship)
											.where(
												and(
													eq(schema.relationship.userId, userId),
													or(
														eq(schema.relationship.sourceEntityId, schema.entity.id),
														eq(schema.relationship.targetEntityId, schema.entity.id),
													),
												),
											),
									),
									exists(
										db
											.select({ id: schema.event.id })
											.from(schema.event)
											.where(
												and(
													eq(schema.event.userId, userId),
													or(
														eq(schema.event.entityId, schema.entity.id),
														eq(schema.event.sessionEntityId, schema.entity.id),
													),
												),
											),
									),
								),
							),
						)
						.orderBy(asc(schema.entity.id)),
				);
				return rows.map(toPortableEntity);
			});

			const listGlobalEntitiesByIdsForBackup = Effect.fn(
				"EntitiesRepository.listGlobalEntitiesByIdsForBackup",
			)(function* (entityIds: ReadonlyArray<EntityId>) {
				if (entityIds.length === 0) {
					return [];
				}
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select(portableEntitySelection)
						.from(schema.entity)
						.leftJoin(
							schema.sandboxProvider,
							eq(schema.entity.providerId, schema.sandboxProvider.id),
						)
						.leftJoin(schema.plugin, eq(schema.plugin.id, schema.sandboxProvider.pluginId))
						.where(and(isNull(schema.entity.userId), inArray(schema.entity.id, [...entityIds])))
						.orderBy(asc(schema.entity.id)),
				);
				return rows.map(toPortableEntity);
			});

			const getEntitySchemaScopeForUser: (input: {
				userId: UserId;
				entitySchemaSlug: EntitySchemaSlug;
			}) => Effect.Effect<EntitySchemaScope | null, DbError, Database> = Effect.fn(
				"EntitiesRepository.getEntitySchemaScopeForUser",
			)(function* (input: { userId: UserId; entitySchemaSlug: EntitySchemaSlug }) {
				const effectiveDefinitions = yield* pluginRuntime.getEffectiveDefinitions(input.userId);
				const definition = effectiveDefinitions.entitySchemas[input.entitySchemaSlug];
				const scope: EntitySchemaScope | null = definition
					? {
							userId: null,
							isBuiltin: true,
							slug: definition.slug,
							pluginId: definition.pluginId,
							propertiesSchema: definition.propertiesSchema,
							id: EntitySchemaSlug.make(definition.slug),
						}
					: null;
				return scope;
			});

			const findUserEntityWithoutProvenance = Effect.fn(
				"EntitiesRepository.findUserEntityWithoutProvenance",
			)(function* (input: { userId: UserId; entitySchemaSlug: EntitySchemaSlug }) {
				const effective = yield* pluginRuntime.getEffectiveDefinitions(input.userId);
				const definition = effective.entitySchemas[input.entitySchemaSlug];
				if (!definition) {
					return null;
				}
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select(entitySelection)
						.from(schema.entity)
						.where(
							and(
								eq(schema.entity.userId, input.userId),
								eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
								entitySchemaPluginWhere(definition.pluginId),
								isNull(schema.entity.externalId),
								isNull(schema.entity.providerId),
							),
						)
						.orderBy(asc(schema.entity.createdAt), asc(schema.entity.id))
						.limit(1),
				);
				return row ? toListedEntity(row) : null;
			});

			const lockUserEntityEnsureScopes = Effect.fn("EntitiesRepository.lockUserEntityEnsureScopes")(
				function* (input: { userId: UserId; entitySchemaSlugs: ReadonlyArray<EntitySchemaSlug> }) {
					const effective = yield* pluginRuntime.getEffectiveDefinitions(input.userId);
					const db = yield* Database;
					const scopes = [
						...new Map(
							input.entitySchemaSlugs.flatMap((entitySchemaSlug) => {
								const definition = effective.entitySchemas[entitySchemaSlug];
								if (!definition) {
									return [];
								}
								const pluginId = definition.pluginId ?? null;
								return [
									[`${entitySchemaSlug}:${pluginId ?? "kernel"}`, { entitySchemaSlug, pluginId }],
								];
							}),
						).values(),
					].sort((left, right) => left.entitySchemaSlug.localeCompare(right.entitySchemaSlug));
					for (const { entitySchemaSlug, pluginId } of scopes) {
						yield* mapDatabaseErrors(
							db.execute(
								sql`select pg_advisory_xact_lock(hashtext(${`user-entity:ensure:${input.userId}:${entitySchemaSlug}:${pluginId ?? "kernel"}`}))`,
							),
						);
					}
				},
			);

			const getEntityScopeForUser = Effect.fn("EntitiesRepository.getEntityScopeForUser")(
				function* (input: { userId: UserId; entityId: EntityId }) {
					const db = yield* Database;
					const [row] = yield* mapDatabaseErrors(
						db
							.select({
								entityId: schema.entity.id,
								entityName: schema.entity.name,
								entityUserId: schema.entity.userId,
								entitySchemaSlug: schema.entity.entitySchemaSlug,
							})
							.from(schema.entity)
							.where(
								and(eq(schema.entity.id, input.entityId), entityVisibleToUserClause(input.userId)),
							)
							.limit(1),
					);

					if (!row) {
						return null;
					}

					return {
						...row,
						isBuiltin: true,
						entityId: EntityId.make(row.entityId),
						entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
						entityUserId: row.entityUserId ? UserId.make(row.entityUserId) : null,
					};
				},
			);

			const getEntityMergeScopeForUser = Effect.fn("EntitiesRepository.getEntityMergeScopeForUser")(
				function* (input: { userId: UserId; entityId: EntityId }) {
					const db = yield* Database;
					const [row] = yield* mapDatabaseErrors(
						db
							.select({
								entityId: schema.entity.id,
								entityUserId: schema.entity.userId,
								properties: schema.entity.properties,
								entitySchemaSlug: schema.entity.entitySchemaSlug,
							})
							.from(schema.entity)
							.where(
								and(eq(schema.entity.id, input.entityId), entityVisibleToUserClause(input.userId)),
							)
							.limit(1),
					);

					return row
						? {
								...row,
								isBuiltin: true,
								entityId: EntityId.make(row.entityId),
								entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
								entityUserId: row.entityUserId ? UserId.make(row.entityUserId) : null,
							}
						: null;
				},
			);

			const getByIdForUser = Effect.fn("EntitiesRepository.getByIdForUser")(function* (input: {
				userId: UserId;
				entityId: EntityId;
			}) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select(entitySelection)
						.from(schema.entity)
						.where(
							and(eq(schema.entity.id, input.entityId), entityVisibleToUserClause(input.userId)),
						)
						.limit(1),
				);

				return row ? toListedEntity(row) : null;
			});

			const getByIdsForUser = Effect.fn("EntitiesRepository.getByIdsForUser")(function* (input: {
				userId: UserId;
				entityIds: ReadonlyArray<EntityId>;
			}) {
				if (input.entityIds.length === 0) {
					return [];
				}

				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select(entitySelection)
						.from(schema.entity)
						.where(
							and(
								inArray(schema.entity.id, [...input.entityIds]),
								entityVisibleToUserClause(input.userId),
							),
						),
				);

				return rows.map(toListedEntity);
			});

			const getById = Effect.fn("EntitiesRepository.getById")(function* (entityId: EntityId) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select(entitySelection)
						.from(schema.entity)
						.where(eq(schema.entity.id, entityId))
						.limit(1),
				);
				return row ? toListedEntity(row) : null;
			});

			const findGlobalEntityById = Effect.fn("EntitiesRepository.findGlobalEntityById")(function* (
				entityId: EntityId,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({ id: schema.entity.id, entitySchemaSlug: schema.entity.entitySchemaSlug })
						.from(schema.entity)
						.where(and(eq(schema.entity.id, entityId), isNull(schema.entity.userId)))
						.limit(1),
				);
				return row
					? {
							id: EntityId.make(row.id),
							entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
						}
					: null;
			});

			const findGlobalEntityByExternalId = Effect.fn(
				"EntitiesRepository.findGlobalEntityByExternalId",
			)(function* (input: {
				externalId: string;
				entitySchemaSlug: EntitySchemaSlug;
				providerId: SandboxProviderId;
				entitySchemaPluginId: string | null;
			}) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select(entitySelection)
						.from(schema.entity)
						.where(
							and(
								isNull(schema.entity.userId),
								eq(schema.entity.externalId, input.externalId),
								eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
								eq(schema.entity.providerId, input.providerId),
								entitySchemaPluginWhere(input.entitySchemaPluginId),
							),
						)
						.limit(1),
				);

				return row ? toListedEntity(row) : null;
			});

			const findGlobalEntityForRestore = Effect.fn("EntitiesRepository.findGlobalEntityForRestore")(
				function* (input: {
					externalId: string;
					entitySchemaSlug: EntitySchemaSlug;
					entitySchemaPluginId: string | null;
					provider: { readonly pluginSlug: string; readonly providerSlug: string } | null;
				}) {
					const db = yield* Database;
					const [row] = yield* mapDatabaseErrors(
						db
							.select({ id: schema.entity.id, entitySchemaSlug: schema.entity.entitySchemaSlug })
							.from(schema.entity)
							.leftJoin(
								schema.sandboxProvider,
								eq(schema.entity.providerId, schema.sandboxProvider.id),
							)
							.leftJoin(schema.plugin, eq(schema.plugin.id, schema.sandboxProvider.pluginId))
							.where(
								and(
									isNull(schema.entity.userId),
									eq(schema.entity.externalId, input.externalId),
									eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
									entitySchemaPluginWhere(input.entitySchemaPluginId),
									input.provider === null
										? isNull(schema.entity.providerId)
										: and(
												eq(schema.plugin.slug, input.provider.pluginSlug),
												eq(schema.plugin.scope, "system"),
												eq(schema.sandboxProvider.slug, input.provider.providerSlug),
											),
								),
							)
							.limit(1),
					);
					return row
						? {
								id: EntityId.make(row.id),
								entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
							}
						: null;
				},
			);

			const restoreEntity = Effect.fn("EntitiesRepository.restoreEntity")(function* (
				input: RestoreEntityInput,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db.insert(schema.entity).values(input).returning({ id: schema.entity.id }),
				);
				return row
					? EntityId.make(row.id)
					: yield* new DbError({ message: "Entity restore returned no row" });
			});

			const lockGlobalEntityProvenanceScope = Effect.fn(
				"EntitiesRepository.lockGlobalEntityProvenanceScope",
			)(function* (input: GlobalEntityProvenanceScopeInput) {
				const db = yield* Database;
				const lockKey = `global-entities:${input.entitySchemaSlug}:${input.entitySchemaPluginId ?? "kernel"}:${input.providerId}`;
				yield* mapDatabaseErrors(
					db.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`),
				);
			});

			const countGlobalEntitiesByProvenanceScope = Effect.fn(
				"EntitiesRepository.countGlobalEntitiesByProvenanceScope",
			)(function* (input: GlobalEntityProvenanceScopeInput) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({ count: count() })
						.from(schema.entity)
						.where(
							and(
								isNull(schema.entity.userId),
								eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
								eq(schema.entity.providerId, input.providerId),
								entitySchemaPluginWhere(input.entitySchemaPluginId),
							),
						),
				);
				return row?.count ?? 0;
			});

			const findEntitySchemaById = Effect.fn("EntitiesRepository.findEntitySchemaById")((
				entitySchemaSlug: EntitySchemaSlug,
			) => {
				const definition = definitions.getEntitySchema(entitySchemaSlug);
				return Effect.succeed(
					definition
						? {
								slug: definition.slug,
								propertiesSchema: definition.propertiesSchema,
								...(definition.pluginId == null ? {} : { pluginId: definition.pluginId }),
							}
						: null,
				);
			});

			const findEntitySchemaProviderBySlug = Effect.fn(
				"EntitiesRepository.findEntitySchemaProviderBySlug",
			)(function* (providerSlug: string) {
				const resolved = yield* pluginRuntime.findSchemaProviderBySlug(providerSlug);
				if (!resolved) {
					return null;
				}

				const detailsScript = yield* pluginRuntime.findDetailsScript(resolved.provider.id);
				return detailsScript
					? ({
							providerId: resolved.provider.id,
							detailsScriptId: detailsScript.id,
							entitySchemaSlug: resolved.entitySchemaSlug,
						} satisfies EntitySchemaProviderDetailsScope)
					: null;
			});

			const insertEntity = Effect.fn("EntitiesRepository.insertEntity")(function* (
				input: InsertEntityInput,
			) {
				const db = yield* Database;

				if (input.scope === "global") {
					const externalId = input.externalId;
					const providerId = input.providerId;
					const values = {
						userId: null,
						name: input.name,
						origin: input.origin ?? null,
						properties: input.properties,
						externalId: externalId ?? null,
						providerId: providerId ?? null,
						populatedAt: input.populatedAt,
						entitySchemaSlug: input.entitySchemaSlug,
						entitySchemaPluginId: input.entitySchemaPluginId ?? null,
					};

					if (!externalId) {
						const [row] = yield* mapDatabaseErrors(
							db.insert(schema.entity).values(values).returning(entitySelection),
						);
						if (!row) {
							return yield* new DbError({ message: "Global entity insert returned no row" });
						}
						return { entity: toListedEntity(row), wasInserted: true };
					}

					const inserted = yield* mapDatabaseErrors(
						db
							.insert(schema.entity)
							.values(values)
							.onConflictDoNothing()
							.returning(entitySelection),
					);

					if (inserted[0]) {
						return { entity: toListedEntity(inserted[0]), wasInserted: true };
					}

					const [existing] = yield* mapDatabaseErrors(
						db
							.select(entitySelection)
							.from(schema.entity)
							.where(
								and(
									isNull(schema.entity.userId),
									eq(schema.entity.externalId, externalId),
									eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
									providerWhere(providerId),
									entitySchemaPluginWhere(input.entitySchemaPluginId),
								),
							)
							.limit(1)
							.for("update"),
					);

					if (!existing) {
						return yield* new DbError({ message: "Global entity insert conflict but not found" });
					}

					return { entity: toListedEntity(existing), wasInserted: false };
				}

				const externalId = input.externalId;
				const providerId = input.providerId;
				const values = {
					name: input.name,
					userId: input.userId,
					origin: input.origin ?? null,
					properties: input.properties,
					externalId: externalId ?? null,
					providerId: providerId ?? null,
					entitySchemaSlug: input.entitySchemaSlug,
					entitySchemaPluginId: input.entitySchemaPluginId ?? null,
				};

				if (externalId && providerId) {
					const rows = yield* mapDatabaseErrors(
						db
							.insert(schema.entity)
							.values(values)
							.onConflictDoNothing()
							.returning(entitySelection),
					);

					const created = rows[0];
					if (created) {
						return { entity: toListedEntity(created), wasInserted: true };
					}

					const [row] = yield* mapDatabaseErrors(
						db
							.select(entitySelection)
							.from(schema.entity)
							.where(
								and(
									eq(schema.entity.userId, input.userId),
									eq(schema.entity.externalId, externalId),
									eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
									eq(schema.entity.providerId, providerId),
									entitySchemaPluginWhere(input.entitySchemaPluginId),
								),
							)
							.limit(1)
							.for("update"),
					);

					const existing = row ? toListedEntity(row) : null;

					if (existing) {
						return { entity: existing, wasInserted: false };
					}

					return yield* new DbError({ message: "Entity insert returned no row" });
				}

				const [row] = yield* mapDatabaseErrors(
					db.insert(schema.entity).values(values).returning(entitySelection),
				);

				if (!row) {
					return yield* new DbError({ message: "Entity insert returned no row" });
				}

				return { entity: toListedEntity(row), wasInserted: true };
			});

			const updateEntity = Effect.fn("EntitiesRepository.updateEntity")(function* (
				input: UpdateEntityInput,
			) {
				const db = yield* Database;
				const [updated] = yield* mapDatabaseErrors(
					db
						.update(schema.entity)
						.set({ name: input.name, properties: input.properties, populatedAt: input.populatedAt })
						.where(eq(schema.entity.id, input.entityId))
						.returning(entitySelection),
				);

				if (!updated) {
					return yield* new DbError({ message: "Entity update returned no row" });
				}

				return toListedEntity(updated);
			});

			const deleteByIds = Effect.fn("EntitiesRepository.deleteByIds")(function* (
				ids: readonly [EntityId, ...EntityId[]],
			) {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.delete(schema.entity)
						.where(inArray(schema.entity.id, [...ids]))
						.returning({ id: schema.entity.id }),
				);
				return rows.length;
			});

			return {
				getById,
				deleteByIds,
				insertEntity,
				updateEntity,
				restoreEntity,
				getByIdForUser,
				getByIdsForUser,
				findEntitySchemaById,
				findGlobalEntityById,
				getEntityScopeForUser,
				listEntityReferencesByIds,
				listUserEntitiesForBackup,
				lockUserEntityEnsureScopes,
				getEntityMergeScopeForUser,
				findGlobalEntityForRestore,
				listMatchCandidatesBySchema,
				getEntitySchemaScopeForUser,
				findGlobalEntityByExternalId,
				findEntitySchemaProviderBySlug,
				findUserEntityWithoutProvenance,
				lockGlobalEntityProvenanceScope,
				listGlobalEntitiesByIdsForBackup,
				countGlobalEntitiesByProvenanceScope,
				listReferencedGlobalEntitiesForBackup,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
