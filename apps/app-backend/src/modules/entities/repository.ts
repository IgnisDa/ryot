import { DbError } from "@ryot/contract/errors";
import type { SandboxProviderId } from "@ryot/contract/schema/brands";
import { EntityId, EntitySchemaSlug, UserId } from "@ryot/contract/schema/brands";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";
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
};

export class EntitiesRepository extends Context.Service<EntitiesRepository>()(
	"EntitiesRepository",
	{
		make: Effect.gen(function* () {
			const definitions = yield* DefinitionRegistry;
			const pluginRuntime = yield* PluginRuntimeResolver;
			const listMatchCandidatesBySchema = Effect.fn(
				"EntitiesRepository.listMatchCandidatesBySchema",
			)(function* (input: { userId: UserId; entitySchemaSlug: EntitySchemaSlug }) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select(entitySelection)
						.from(schema.entity)
						.where(
							and(
								entityVisibleToUserClause(input.userId),
								eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
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

					const db = yield* CurrentDb;
					const rows = yield* dbEffect(() =>
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

			const getEntitySchemaScopeForUser = Effect.fn(
				"EntitiesRepository.getEntitySchemaScopeForUser",
			)((input: { userId: UserId; entitySchemaSlug: EntitySchemaSlug }) => {
				const definition = definitions.getEntitySchema(input.entitySchemaSlug);
				const scope: EntitySchemaScope | null = definition
					? {
							id: EntitySchemaSlug.make(definition.slug),
							slug: definition.slug,
							propertiesSchema: definition.propertiesSchema,
							userId: null,
							isBuiltin: true,
						}
					: null;
				return Effect.succeed(scope);
			});

			const findUserEntityWithoutProvenance = Effect.fn(
				"EntitiesRepository.findUserEntityWithoutProvenance",
			)(function* (input: { userId: UserId; entitySchemaSlug: EntitySchemaSlug }) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select(entitySelection)
						.from(schema.entity)
						.where(
							and(
								eq(schema.entity.userId, input.userId),
								eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
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
					const db = yield* CurrentDb;
					const scopes = [...new Set(input.entitySchemaSlugs)].sort();
					for (const entitySchemaSlug of scopes) {
						yield* dbEffect(() =>
							db.execute(
								sql`select pg_advisory_xact_lock(hashtext(${`user-entity:ensure:${input.userId}:${entitySchemaSlug}`}))`,
							),
						);
					}
				},
			);

			const getEntityScopeForUser = Effect.fn("EntitiesRepository.getEntityScopeForUser")(
				function* (input: { userId: UserId; entityId: EntityId }) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
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
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
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
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
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

			const getById = Effect.fn("EntitiesRepository.getById")(function* (entityId: EntityId) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
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
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({ id: schema.entity.id })
						.from(schema.entity)
						.where(and(eq(schema.entity.id, entityId), isNull(schema.entity.userId)))
						.limit(1),
				);
				return row ? { id: EntityId.make(row.id) } : null;
			});

			const findEntityByExternalIdForUser = Effect.fn(
				"EntitiesRepository.findEntityByExternalIdForUser",
			)(function* (input: {
				userId: UserId;
				externalId: string;
				entitySchemaSlug: EntitySchemaSlug;
				providerId: SandboxProviderId;
			}) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select(entitySelection)
						.from(schema.entity)
						.where(
							and(
								entityVisibleToUserClause(input.userId),
								eq(schema.entity.externalId, input.externalId),
								eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
								eq(schema.entity.providerId, input.providerId),
							),
						)
						.limit(1),
				);

				return row ? toListedEntity(row) : null;
			});

			const findGlobalEntityByExternalId = Effect.fn(
				"EntitiesRepository.findGlobalEntityByExternalId",
			)(function* (input: {
				externalId: string;
				entitySchemaSlug: EntitySchemaSlug;
				providerId: SandboxProviderId;
			}) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select(entitySelection)
						.from(schema.entity)
						.where(
							and(
								isNull(schema.entity.userId),
								eq(schema.entity.externalId, input.externalId),
								eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
								eq(schema.entity.providerId, input.providerId),
							),
						)
						.limit(1),
				);

				return row ? toListedEntity(row) : null;
			});

			const lockGlobalEntityProvenanceScope = Effect.fn(
				"EntitiesRepository.lockGlobalEntityProvenanceScope",
			)(function* (input: GlobalEntityProvenanceScopeInput) {
				const db = yield* CurrentDb;
				const lockKey = `global-entities:${input.entitySchemaSlug}:${input.providerId}`;
				yield* dbEffect(() => db.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`));
			});

			const countGlobalEntitiesByProvenanceScope = Effect.fn(
				"EntitiesRepository.countGlobalEntitiesByProvenanceScope",
			)(function* (input: GlobalEntityProvenanceScopeInput) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({ count: count() })
						.from(schema.entity)
						.where(
							and(
								isNull(schema.entity.userId),
								eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
								eq(schema.entity.providerId, input.providerId),
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
						? { propertiesSchema: definition.propertiesSchema, slug: definition.slug }
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
				const db = yield* CurrentDb;

				if (input.scope === "global") {
					const externalId = input.externalId;
					const providerId = input.providerId;
					const values = {
						userId: null,
						name: input.name,
						properties: input.properties,
						externalId: externalId ?? null,
						populatedAt: input.populatedAt,
						entitySchemaSlug: input.entitySchemaSlug,
						providerId: providerId ?? null,
					};

					if (!externalId || !providerId) {
						const [row] = yield* dbEffect(() =>
							db.insert(schema.entity).values(values).returning(entitySelection),
						);
						if (!row) {
							return yield* new DbError({ message: "Global entity insert returned no row" });
						}
						return { entity: toListedEntity(row), wasInserted: true };
					}

					const inserted = yield* dbEffect(() =>
						db
							.insert(schema.entity)
							.values(values)
							.onConflictDoNothing()
							.returning(entitySelection),
					);

					if (inserted[0]) {
						return { entity: toListedEntity(inserted[0]), wasInserted: true };
					}

					const [existing] = yield* dbEffect(() =>
						db
							.select(entitySelection)
							.from(schema.entity)
							.where(
								and(
									isNull(schema.entity.userId),
									eq(schema.entity.externalId, externalId),
									eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
									eq(schema.entity.providerId, providerId),
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
					properties: input.properties,
					externalId: externalId ?? null,
					entitySchemaSlug: input.entitySchemaSlug,
					providerId: providerId ?? null,
				};

				if (externalId && providerId) {
					const rows = yield* dbEffect(() =>
						db
							.insert(schema.entity)
							.values(values)
							.onConflictDoNothing({
								target: [
									schema.entity.userId,
									schema.entity.externalId,
									schema.entity.entitySchemaSlug,
									schema.entity.providerId,
								],
							})
							.returning(entitySelection),
					);

					const created = rows[0];
					if (created) {
						return { entity: toListedEntity(created), wasInserted: true };
					}

					const [row] = yield* dbEffect(() =>
						db
							.select(entitySelection)
							.from(schema.entity)
							.where(
								and(
									eq(schema.entity.userId, input.userId),
									eq(schema.entity.externalId, externalId),
									eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
									eq(schema.entity.providerId, providerId),
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

				const [row] = yield* dbEffect(() =>
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
				const db = yield* CurrentDb;
				const [updated] = yield* dbEffect(() =>
					db
						.update(schema.entity)
						.set({
							name: input.name,
							properties: input.properties,
							populatedAt: input.populatedAt,
						})
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
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
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
				getByIdForUser,
				findEntitySchemaById,
				findGlobalEntityById,
				getEntityScopeForUser,
				listEntityReferencesByIds,
				lockUserEntityEnsureScopes,
				getEntityMergeScopeForUser,
				listMatchCandidatesBySchema,
				getEntitySchemaScopeForUser,
				findGlobalEntityByExternalId,
				findEntityByExternalIdForUser,
				findEntitySchemaProviderBySlug,
				findUserEntityWithoutProvenance,
				lockGlobalEntityProvenanceScope,
				countGlobalEntitiesByProvenanceScope,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
