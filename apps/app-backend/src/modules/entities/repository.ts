import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect, schema } from "#lib/db";
import { DbError } from "#lib/errors";
import type { AppSchema } from "#lib/schema/core";
import { decodeStoredAppSchema } from "#lib/schema/core";

import type { StoredEntityImage } from "./types";

type EntityRow = Pick<
	typeof schema.entity.$inferSelect,
	| "id"
	| "name"
	| "image"
	| "createdAt"
	| "updatedAt"
	| "properties"
	| "externalId"
	| "populatedAt"
	| "entitySchemaId"
	| "sandboxScriptId"
>;

export type EntitySchemaScope = {
	readonly id: string;
	readonly slug: string;
	readonly isBuiltin: boolean;
	readonly userId: string | null;
	readonly propertiesSchema: AppSchema;
};

export type EntityScope = {
	readonly entityId: string;
	readonly isBuiltin: boolean;
	readonly entitySchemaId: string;
	readonly entitySchemaSlug: string;
	readonly entityUserId: string | null;
};

export type EntitySchemaScriptScope = {
	readonly entitySchemaId: string;
	readonly sandboxScriptId: string;
};

const entitySelection = {
	id: schema.entity.id,
	name: schema.entity.name,
	image: schema.entity.image,
	createdAt: schema.entity.createdAt,
	updatedAt: schema.entity.updatedAt,
	properties: schema.entity.properties,
	externalId: schema.entity.externalId,
	populatedAt: schema.entity.populatedAt,
	entitySchemaId: schema.entity.entitySchemaId,
	sandboxScriptId: schema.entity.sandboxScriptId,
};

const entitySchemaVisibleToUserClause = (userId: string) =>
	or(isNull(schema.entitySchema.userId), eq(schema.entitySchema.userId, userId));

const entityVisibleToUserClause = (userId: string) =>
	or(isNull(schema.entity.userId), eq(schema.entity.userId, userId));

const toListedEntity = (row: EntityRow) => ({
	id: row.id,
	name: row.name,
	image: row.image,
	properties: row.properties,
	externalId: row.externalId,
	entitySchemaId: row.entitySchemaId,
	sandboxScriptId: row.sandboxScriptId,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	populatedAt: row.populatedAt?.toISOString() ?? null,
});

export class EntitiesRepository extends Effect.Service<EntitiesRepository>()("EntitiesRepository", {
	sync: () => ({
		listMatchCandidatesBySchema: (input: { userId: string; entitySchemaId: string }) =>
			Effect.gen(function* () {
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
			}),
		getEntitySchemaScopeForUser: (input: { userId: string; entitySchemaId: string }) =>
			Effect.gen(function* () {
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
					id: row.id,
					slug: row.slug,
					propertiesSchema,
					userId: row.userId,
					isBuiltin: row.isBuiltin,
				};
			}),
		getEntityScopeForUser: (input: { userId: string; entityId: string }) =>
			Effect.gen(function* () {
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

				return row ?? null;
			}),
		getEntityScopeById: (entityId: string) =>
			Effect.gen(function* () {
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
						.where(eq(schema.entity.id, entityId))
						.limit(1),
				);

				return row ?? null;
			}),
		getByIdForUser: (input: { userId: string; entityId: string }) =>
			Effect.gen(function* () {
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
			}),
		findEntityByExternalIdForUser: (input: {
			userId: string;
			externalId: string;
			entitySchemaId: string;
			sandboxScriptId: string;
		}) =>
			Effect.gen(function* () {
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
			}),
		findGlobalEntityByExternalId: (input: {
			externalId: string;
			entitySchemaId: string;
			sandboxScriptId: string;
		}) =>
			Effect.gen(function* () {
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
			}),
		findEntitySchemaById: (entitySchemaId: string) =>
			Effect.gen(function* () {
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
			}),
		findEntitySchemaScriptBySlug: (scriptSlug: string) =>
			Effect.gen(function* () {
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

				return row ?? null;
			}),
		createOrUpdateGlobalEntity: (input: {
			name: string;
			externalId: string;
			entitySchemaId: string;
			sandboxScriptId: string;
			populatedAt: Date | null;
			image: StoredEntityImage | null;
			properties: Record<string, unknown>;
		}) =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
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
					return toListedEntity(inserted[0]);
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
						return toListedEntity(updated);
					}
				}

				return toListedEntity(existing);
			}),
		createEntity: (input: {
			name: string;
			userId: string;
			externalId?: string;
			entitySchemaId: string;
			sandboxScriptId?: string;
			image: StoredEntityImage | null;
			properties: Record<string, unknown>;
		}) =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
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
						return toListedEntity(created);
					}

					const existing = yield* Effect.flatMap(Effect.succeed(input), (repositoryInput) =>
						Effect.gen(function* () {
							const [row] = yield* dbEffect(() =>
								db
									.select(entitySelection)
									.from(schema.entity)
									.where(
										and(
											eq(schema.entity.userId, repositoryInput.userId),
											eq(schema.entity.externalId, externalId),
											eq(schema.entity.entitySchemaId, repositoryInput.entitySchemaId),
											eq(schema.entity.sandboxScriptId, sandboxScriptId),
										),
									)
									.limit(1),
							);

							return row ? toListedEntity(row) : null;
						}),
					);

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

				return toListedEntity(row);
			}),
	}),
}) {}
