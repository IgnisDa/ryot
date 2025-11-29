import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";
import * as schema from "#lib/db/schema/tables";
import { DbError } from "#lib/errors";
import { EntityId, EntitySchemaId, SandboxScriptId, UserId } from "#lib/schema/brands";
import { decodeStoredAppSchema } from "#lib/schema/core";
import type { AppSchema } from "#lib/schema/property-schema";

import { EntityImage } from "./schemas";
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
	readonly id: EntitySchemaId;
	readonly slug: string;
	readonly isBuiltin: boolean;
	readonly userId: UserId | null;
	readonly propertiesSchema: AppSchema;
};

export type EntityScope = {
	readonly entityId: EntityId;
	readonly isBuiltin: boolean;
	readonly entitySchemaId: EntitySchemaId;
	readonly entitySchemaSlug: string;
	readonly entityUserId: UserId | null;
};

export type EntityMergeScope = EntityScope & {
	readonly properties: Record<string, unknown>;
};

export type EntitySchemaScriptScope = {
	readonly entitySchemaId: EntitySchemaId;
	readonly sandboxScriptId: SandboxScriptId;
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

const entitySchemaVisibleToUserClause = (userId: UserId) =>
	or(isNull(schema.entitySchema.userId), eq(schema.entitySchema.userId, userId));

const entityVisibleToUserClause = (userId: UserId) =>
	or(isNull(schema.entity.userId), eq(schema.entity.userId, userId));

const decodeStoredEntityImage = (image: EntityRow["image"]) =>
	image === null
		? Effect.succeed(null)
		: Schema.decodeUnknown(EntityImage)(image).pipe(
				Effect.mapError(() => new DbError({ message: "Invalid entity image in database" })),
			);

const toListedEntity = Effect.fn("toListedEntity")(function* (row: EntityRow) {
	const image = yield* decodeStoredEntityImage(row.image);

	return {
		image,
		name: row.name,
		properties: row.properties,
		externalId: row.externalId,
		id: EntityId.make(row.id),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		populatedAt: row.populatedAt?.toISOString() ?? null,
		entitySchemaId: EntitySchemaId.make(row.entitySchemaId),
		sandboxScriptId: row.sandboxScriptId ? SandboxScriptId.make(row.sandboxScriptId) : null,
	};
});

export class EntitiesRepository extends Effect.Service<EntitiesRepository>()("EntitiesRepository", {
	sync: () => ({
		listMatchCandidatesBySchema: Effect.fn("EntitiesRepository.listMatchCandidatesBySchema")(
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
		),
		getEntitySchemaScopeForUser: Effect.fn("EntitiesRepository.getEntitySchemaScopeForUser")(
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
		),
		getEntityScopeForUser: Effect.fn("EntitiesRepository.getEntityScopeForUser")(function* (input: {
			userId: UserId;
			entityId: EntityId;
		}) {
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
					.innerJoin(schema.entitySchema, eq(schema.entity.entitySchemaId, schema.entitySchema.id))
					.where(and(eq(schema.entity.id, input.entityId), entityVisibleToUserClause(input.userId)))
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
		}),
		getEntityMergeScopeForUser: Effect.fn("EntitiesRepository.getEntityMergeScopeForUser")(
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
		),
		getEntityScopeById: Effect.fn("EntitiesRepository.getEntityScopeById")(function* (
			entityId: EntityId,
		) {
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
					.innerJoin(schema.entitySchema, eq(schema.entity.entitySchemaId, schema.entitySchema.id))
					.where(eq(schema.entity.id, entityId))
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
		}),
		getByIdForUser: Effect.fn("EntitiesRepository.getByIdForUser")(function* (input: {
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
		}),
		findEntityByExternalIdForUser: Effect.fn("EntitiesRepository.findEntityByExternalIdForUser")(
			function* (input: {
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
			},
		),
		findGlobalEntityByExternalId: Effect.fn("EntitiesRepository.findGlobalEntityByExternalId")(
			function* (input: {
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
			},
		),
		findEntitySchemaById: Effect.fn("EntitiesRepository.findEntitySchemaById")(function* (
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
		}),
		findEntitySchemaScriptBySlug: Effect.fn("EntitiesRepository.findEntitySchemaScriptBySlug")(
			function* (scriptSlug: string) {
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
			},
		),
		createOrUpdateGlobalEntity: Effect.fn("EntitiesRepository.createOrUpdateGlobalEntity")(
			function* (input: {
				name: string;
				externalId: string;
				entitySchemaId: EntitySchemaId;
				populatedAt: Date | null;
				sandboxScriptId: SandboxScriptId;
				image: StoredEntityImage | null;
				properties: Record<string, unknown>;
			}) {
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
			},
		),
		createEntity: Effect.fn("EntitiesRepository.createEntity")(function* (input: {
			name: string;
			userId: UserId;
			externalId?: string;
			entitySchemaId: EntitySchemaId;
			image: StoredEntityImage | null;
			sandboxScriptId?: SandboxScriptId;
			properties: Record<string, unknown>;
		}) {
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
					return yield* toListedEntity(created);
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

						return row ? yield* toListedEntity(row) : null;
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

			return yield* toListedEntity(row);
		}),
	}),
}) {}
