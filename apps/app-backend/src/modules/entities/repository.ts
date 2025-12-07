import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";
import * as schema from "#lib/db/schema/tables";
import { DbError } from "#lib/errors";
import { EntityId, EntitySchemaId, SandboxScriptId, UserId } from "#lib/schema/brands";
import { decodeStoredAppSchema } from "#lib/schema/core";

import {
	entitySelection,
	entityVisibleToUserClause,
	entitySchemaVisibleToUserClause,
	toListedEntity,
} from "./repository-support";
import type { StoredEntityImage } from "./types";

export type SaveEntityInputBase = {
	name: string;
	entitySchemaId: EntitySchemaId;
	image: StoredEntityImage | null;
} & (
	| {
			scope: "global";
			externalId: string;
			populatedAt: Date | null;
			sandboxScriptId: SandboxScriptId;
	  }
	| {
			scope: "user";
			userId: UserId;
			externalId?: string;
			sandboxScriptId?: SandboxScriptId;
	  }
);

export type SaveEntityInput = SaveEntityInputBase & { properties: Record<string, unknown> };

export type {
	EntityScope,
	EntityMergeScope,
	EntitySchemaScope,
	EntitySchemaScriptScope,
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
				return yield* Effect.forEach(rows, toListedEntity);
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

			return row ? yield* toListedEntity(row) : null;
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

			return row ? yield* toListedEntity(row) : null;
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

			return row ? yield* toListedEntity(row) : null;
		});

		const findEntitySchemaById = Effect.fn("EntitiesRepository.findEntitySchemaById")(function* (
			entitySchemaId: EntitySchemaId,
		) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select({ propertiesSchema: schema.entitySchema.propertiesSchema })
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

			return { propertiesSchema };
		});

		const findEntitySchemaScriptBySlug = Effect.fn(
			"EntitiesRepository.findEntitySchemaScriptBySlug",
		)(function* (scriptSlug: string) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select({
						entitySchemaId: schema.entitySchemaScript.entitySchemaId,
						sandboxScriptId: schema.entitySchemaScript.sandboxScriptId,
					})
					.from(schema.sandboxScript)
					.innerJoin(
						schema.entitySchemaScript,
						eq(schema.entitySchemaScript.sandboxScriptId, schema.sandboxScript.id),
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

		const saveEntity = Effect.fn("EntitiesRepository.saveEntity")(function* (
			input: SaveEntityInput,
		) {
			const db = yield* CurrentDb;

			if (input.scope === "global") {
				const values = {
					userId: null,
					name: input.name,
					image: input.image,
					properties: input.properties,
					externalId: input.externalId,
					populatedAt: input.populatedAt,
					entitySchemaId: input.entitySchemaId,
					sandboxScriptId: input.sandboxScriptId,
				};

				const inserted = yield* dbEffect(() =>
					db.insert(schema.entity).values(values).onConflictDoNothing().returning(entitySelection),
				);

				if (inserted[0]) {
					return yield* toListedEntity(inserted[0]);
				}

				const [existing] = yield* dbEffect(() =>
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

				if (!existing) {
					return yield* new DbError({ message: "Global entity insert conflict but not found" });
				}

				if (input.populatedAt !== null && existing.populatedAt === null) {
					const [updated] = yield* dbEffect(() =>
						db
							.update(schema.entity)
							.set({
								name: input.name,
								image: input.image,
								properties: input.properties,
								populatedAt: input.populatedAt,
							})
							.where(and(eq(schema.entity.id, existing.id), isNull(schema.entity.populatedAt)))
							.returning(entitySelection),
					);

					if (updated) {
						return yield* toListedEntity(updated);
					}
				}

				return yield* toListedEntity(existing);
			}

			const externalId = input.externalId;
			const sandboxScriptId = input.sandboxScriptId;
			const values = {
				name: input.name,
				image: input.image,
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
					return yield* toListedEntity(created);
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
						.limit(1),
				);

				const existing = row ? yield* toListedEntity(row) : null;

				if (existing) {
					return existing;
				}

				return yield* new DbError({ message: "Entity insert returned no row" });
			}

			const [row] = yield* dbEffect(() =>
				db.insert(schema.entity).values(values).returning(entitySelection),
			);

			if (!row) {
				return yield* new DbError({ message: "Entity insert returned no row" });
			}

			return yield* toListedEntity(row);
		});

		return {
			saveEntity,
			getByIdForUser,
			findEntitySchemaById,
			getEntityScopeForUser,
			getEntityMergeScopeForUser,
			listMatchCandidatesBySchema,
			getEntitySchemaScopeForUser,
			findEntitySchemaScriptBySlug,
			findGlobalEntityByExternalId,
			findEntityByExternalIdForUser,
		};
	},
}) {}
