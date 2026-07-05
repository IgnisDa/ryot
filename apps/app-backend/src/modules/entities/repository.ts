import { DbError } from "@ryot/contract/errors";
import type { SandboxScriptId } from "@ryot/contract/schema/brands";
import { EntityId, EntitySchemaSlug, UserId } from "@ryot/contract/schema/brands";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import type { EntityReferenceSnapshot } from "./mutation-outcomes";
import {
	entitySelection,
	entityVisibleToUserClause,
	toListedEntity,
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
	effect: Effect.gen(function* () {
		const definitions = yield* DefinitionRegistry;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const listMatchCandidatesBySchema = Effect.fn("EntitiesRepository.listMatchCandidatesBySchema")(
			function* (input: { userId: UserId; entitySchemaSlug: EntitySchemaSlug }) {
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
							entitySchemaSlug: schema.entity.entitySchemaSlug,
						})
						.from(schema.entity)
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
			(input: { userId: UserId; entitySchemaSlug: EntitySchemaSlug }) => {
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
							eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
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
			entitySchemaSlug: EntitySchemaSlug;
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
							eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
							eq(schema.entity.sandboxScriptId, input.sandboxScriptId),
						),
					)
					.limit(1),
			);

			return row ? toListedEntity(row) : null;
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

		const findEntitySchemaSandboxScriptBySlug = Effect.fn(
			"EntitiesRepository.findEntitySchemaSandboxScriptBySlug",
		)((scriptSlug: string) =>
			pluginRuntime
				.findSchemaScriptBySlug(scriptSlug)
				.pipe(
					Effect.map((resolved) =>
						resolved
							? { sandboxScriptId: resolved.script.id, entitySchemaSlug: resolved.entitySchemaSlug }
							: null,
					),
				),
		);

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
					entitySchemaSlug: input.entitySchemaSlug,
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
								eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
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
				entitySchemaSlug: input.entitySchemaSlug,
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
								schema.entity.entitySchemaSlug,
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
								eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
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
			getEntityMergeScopeForUser,
			listMatchCandidatesBySchema,
			getEntitySchemaScopeForUser,
			findGlobalEntityByExternalId,
			findEntityByExternalIdForUser,
			findEntitySchemaSandboxScriptBySlug,
		};
	}),
}) {}
