import { DbError } from "@ryot/contract/errors";
import { EntityId, EntitySchemaId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { decodeStoredAppSchema } from "@ryot/contract/schema/core";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

import type { EntityReferenceSnapshot } from "./mutation-outcomes";
import {
	entitySelection,
	entityVisibleToUserClause,
	entitySchemaVisibleToUserClause,
	toListedEntity,
} from "./repository-support";

export type InsertEntityInputBase = {
	name: string;
	entitySchemaId: EntitySchemaId;
} & (
	| {
			scope: "global";
			populatedAt: Date | null;
			externalId?: string | undefined;
			sandboxScriptId?: SandboxScriptId | undefined;
	  }
	| {
			scope: "user";
			userId: UserId;
			externalId?: string | undefined;
			sandboxScriptId?: SandboxScriptId | undefined;
	  }
);

export type InsertEntityInput = InsertEntityInputBase & { properties: Record<string, unknown> };

export type UpdateEntityInput = {
	name: string;
	entityId: EntityId;
	populatedAt: Date | null;
	properties: Record<string, unknown>;
};

export type {
	EntityScope,
	EntityMergeScope,
	EntitySchemaScope,
	EntitySchemaSandboxScriptScope,
} from "./repository-support";

export class EntitiesRepository extends Effect.Service<EntitiesRepository>()("EntitiesRepository", {
	sync: () => {
		const listMatchCandidatesBySchema = Effect.fn("EntitiesRepository.listMatchCandidatesBySchema")(
			function* (input: { userId: UserId; entitySchemaId: EntitySchemaId }) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select(entitySelection)
						.from(schema.entity)
						.where(
							and(
								entityVisibleToUserClause(input.userId),
								eq(schema.entity.entitySchemaId, input.entitySchemaId),
							),
						)
						.orderBy(
							sql`case when ${schema.entity.userId} = ${input.userId} then 0 else 1 end`,
							asc(schema.entity.name),
							asc(schema.entity.createdAt),
						),
				);
				return rows.map(toListedEntity);
			},
		);

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
							entitySchemaSlug: schema.entitySchema.slug,
						})
						.from(schema.entity)
						.innerJoin(
							schema.entitySchema,
							eq(schema.entity.entitySchemaId, schema.entitySchema.id),
						)
						.where(inArray(schema.entity.id, [...entityIds]))
						.orderBy(asc(schema.entity.id)),
				);

				return rows.map(
					(row): EntityReferenceSnapshot => ({
						name: row.name,
						id: EntityId.make(row.id),
						entitySchemaSlug: row.entitySchemaSlug,
					}),
				);
			},
		);

		const getEntitySchemaScopeForUser = Effect.fn("EntitiesRepository.getEntitySchemaScopeForUser")(
			function* (input: { userId: UserId; entitySchemaId: EntitySchemaId }) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({
							id: schema.entitySchema.id,
							slug: schema.entitySchema.slug,
							userId: schema.entitySchema.userId,
							isBuiltin: schema.entitySchema.isBuiltin,
							propertiesSchema: schema.entitySchema.propertiesSchema,
						})
						.from(schema.entitySchema)
						.where(
							and(
								eq(schema.entitySchema.id, input.entitySchemaId),
								entitySchemaVisibleToUserClause(input.userId),
							),
						)
						.limit(1),
				);

				if (!row) {
					return null;
				}

				const propertiesSchema = yield* decodeStoredAppSchema(
					row.propertiesSchema,
					"Invalid entity properties schema in database",
				);

				return {
					id: EntitySchemaId.make(row.id),
					slug: row.slug,
					propertiesSchema,
					userId: row.userId ? UserId.make(row.userId) : null,
					isBuiltin: row.isBuiltin,
				};
			},
		);

		const getEntityScopeForUser = Effect.fn("EntitiesRepository.getEntityScopeForUser")(
			function* (input: { userId: UserId; entityId: EntityId }) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({
							entityId: schema.entity.id,
							entityUserId: schema.entity.userId,
							isBuiltin: schema.entitySchema.isBuiltin,
							entitySchemaSlug: schema.entitySchema.slug,
							entitySchemaId: schema.entity.entitySchemaId,
							propertiesSchema: schema.entitySchema.propertiesSchema,
						})
						.from(schema.entity)
						.innerJoin(
							schema.entitySchema,
							eq(schema.entity.entitySchemaId, schema.entitySchema.id),
						)
						.where(
							and(eq(schema.entity.id, input.entityId), entityVisibleToUserClause(input.userId)),
						)
						.limit(1),
				);

				if (!row) {
					return null;
				}

				const propertiesSchema = yield* decodeStoredAppSchema(
					row.propertiesSchema,
					"Invalid entity properties schema in database",
				);

				return {
					...row,
					propertiesSchema,
					entityId: EntityId.make(row.entityId),
					entitySchemaId: EntitySchemaId.make(row.entitySchemaId),
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
							isBuiltin: schema.entitySchema.isBuiltin,
							entitySchemaSlug: schema.entitySchema.slug,
							entitySchemaId: schema.entity.entitySchemaId,
						})
						.from(schema.entity)
						.innerJoin(
							schema.entitySchema,
							eq(schema.entity.entitySchemaId, schema.entitySchema.id),
						)
						.where(
							and(eq(schema.entity.id, input.entityId), entityVisibleToUserClause(input.userId)),
						)
						.limit(1),
				);

				return row
					? {
							...row,
							entityId: EntityId.make(row.entityId),
							entitySchemaId: EntitySchemaId.make(row.entitySchemaId),
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
					.where(and(eq(schema.entity.id, input.entityId), entityVisibleToUserClause(input.userId)))
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

		const findEntityByExternalIdForUser = Effect.fn(
			"EntitiesRepository.findEntityByExternalIdForUser",
		)(function* (input: {
			userId: UserId;
			externalId: string;
			entitySchemaId: EntitySchemaId;
			sandboxScriptId: SandboxScriptId;
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
							eq(schema.entity.entitySchemaId, input.entitySchemaId),
							eq(schema.entity.sandboxScriptId, input.sandboxScriptId),
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
			entitySchemaId: EntitySchemaId;
			sandboxScriptId: SandboxScriptId;
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
							eq(schema.entity.entitySchemaId, input.entitySchemaId),
							eq(schema.entity.sandboxScriptId, input.sandboxScriptId),
						),
					)
					.limit(1),
			);

			return row ? toListedEntity(row) : null;
		});

		const findEntitySchemaById = Effect.fn("EntitiesRepository.findEntitySchemaById")(function* (
			entitySchemaId: EntitySchemaId,
		) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select({
						slug: schema.entitySchema.slug,
						propertiesSchema: schema.entitySchema.propertiesSchema,
					})
					.from(schema.entitySchema)
					.where(eq(schema.entitySchema.id, entitySchemaId))
					.limit(1),
			);

			if (!row) {
				return null;
			}

			const propertiesSchema = yield* decodeStoredAppSchema(
				row.propertiesSchema,
				"Invalid entity properties schema in database",
			);

			return { propertiesSchema, slug: row.slug };
		});

		const findEntitySchemaSandboxScriptBySlug = Effect.fn(
			"EntitiesRepository.findEntitySchemaSandboxScriptBySlug",
		)(function* (scriptSlug: string) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select({
						entitySchemaId: schema.entitySchemaSandboxScript.entitySchemaId,
						sandboxScriptId: schema.entitySchemaSandboxScript.sandboxScriptId,
					})
					.from(schema.sandboxScript)
					.innerJoin(
						schema.entitySchemaSandboxScript,
						eq(schema.entitySchemaSandboxScript.sandboxScriptId, schema.sandboxScript.id),
					)
					.where(
						and(eq(schema.sandboxScript.slug, scriptSlug), isNull(schema.sandboxScript.userId)),
					)
					.orderBy(desc(schema.sandboxScript.createdAt))
					.limit(1),
			);

			return row
				? {
						entitySchemaId: EntitySchemaId.make(row.entitySchemaId),
						sandboxScriptId: SandboxScriptId.make(row.sandboxScriptId),
					}
				: null;
		});

		const insertEntity = Effect.fn("EntitiesRepository.insertEntity")(function* (
			input: InsertEntityInput,
		) {
			const db = yield* CurrentDb;

			if (input.scope === "global") {
				const externalId = input.externalId;
				const sandboxScriptId = input.sandboxScriptId;
				const values = {
					userId: null,
					name: input.name,
					properties: input.properties,
					externalId: externalId ?? null,
					populatedAt: input.populatedAt,
					entitySchemaId: input.entitySchemaId,
					sandboxScriptId: sandboxScriptId ?? null,
				};

				if (!externalId || !sandboxScriptId) {
					const [row] = yield* dbEffect(() =>
						db.insert(schema.entity).values(values).returning(entitySelection),
					);
					if (!row) {
						return yield* new DbError({ message: "Global entity insert returned no row" });
					}
					return { entity: toListedEntity(row), wasInserted: true };
				}

				const inserted = yield* dbEffect(() =>
					db.insert(schema.entity).values(values).onConflictDoNothing().returning(entitySelection),
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
								eq(schema.entity.entitySchemaId, input.entitySchemaId),
								eq(schema.entity.sandboxScriptId, sandboxScriptId),
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
			const sandboxScriptId = input.sandboxScriptId;
			const values = {
				name: input.name,
				userId: input.userId,
				properties: input.properties,
				externalId: externalId ?? null,
				entitySchemaId: input.entitySchemaId,
				sandboxScriptId: sandboxScriptId ?? null,
			};

			if (externalId && sandboxScriptId) {
				const rows = yield* dbEffect(() =>
					db
						.insert(schema.entity)
						.values(values)
						.onConflictDoNothing({
							target: [
								schema.entity.userId,
								schema.entity.externalId,
								schema.entity.entitySchemaId,
								schema.entity.sandboxScriptId,
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
								eq(schema.entity.entitySchemaId, input.entitySchemaId),
								eq(schema.entity.sandboxScriptId, sandboxScriptId),
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

		const deleteBySandboxScript = Effect.fn("EntitiesRepository.deleteBySandboxScript")(function* (
			sandboxScriptId: SandboxScriptId,
		) {
			const db = yield* CurrentDb;
			const rows = yield* dbEffect(() =>
				db
					.delete(schema.entity)
					.where(eq(schema.entity.sandboxScriptId, sandboxScriptId))
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
			getEntityScopeForUser,
			deleteBySandboxScript,
			listEntityReferencesByIds,
			getEntityMergeScopeForUser,
			listMatchCandidatesBySchema,
			getEntitySchemaScopeForUser,
			findGlobalEntityByExternalId,
			findEntityByExternalIdForUser,
			findEntitySchemaSandboxScriptBySlug,
		};
	},
}) {}
