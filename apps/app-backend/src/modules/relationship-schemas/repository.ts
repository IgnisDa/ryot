import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Effect } from "effect";

import { entitySchemaAccessScopeSelection } from "#lib/db/schema/access-scope";
import * as schema from "#lib/db/schema/tables/combined";
import { CurrentDb, dbEffect, isUniqueConstraintError } from "#lib/db/service";
import { DbError, conflict } from "#lib/errors";
import type { Slug, UserId } from "#lib/schema/brands";
import { EntitySchemaId, RelationshipSchemaId } from "#lib/schema/brands";
import { decodeStoredAppSchema } from "#lib/schema/core";
import type { AppSchema } from "#lib/schema/property-schema";

type Row = typeof schema.relationshipSchema.$inferSelect;

const relationshipSchemaUserSlugConstraint = "relationship_schema_user_slug_unique";

const entitySchemaIdCondition = (column: AnyPgColumn, value: EntitySchemaId | null | undefined) => {
	if (value === undefined) {
		return undefined;
	}
	return value === null ? isNull(column) : eq(column, value);
};

const sourceEntitySchemaIdCondition = (value: EntitySchemaId | null | undefined) =>
	entitySchemaIdCondition(schema.relationshipSchema.sourceEntitySchemaId, value);

const targetEntitySchemaIdCondition = (value: EntitySchemaId | null | undefined) =>
	entitySchemaIdCondition(schema.relationshipSchema.targetEntitySchemaId, value);

const toScope = Effect.fn(function* (row: Row) {
	const propertiesSchema = yield* decodeStoredAppSchema(
		row.propertiesSchema,
		`Invalid propertiesSchema for relationship schema ${row.id}`,
	);

	return {
		id: RelationshipSchemaId.make(row.id),
		slug: row.slug,
		name: row.name,
		propertiesSchema,
		isBuiltin: row.isBuiltin,
		sourceEntitySchemaId: row.sourceEntitySchemaId
			? EntitySchemaId.make(row.sourceEntitySchemaId)
			: null,
		targetEntitySchemaId: row.targetEntitySchemaId
			? EntitySchemaId.make(row.targetEntitySchemaId)
			: null,
	};
});

export class RelationshipSchemasRepository extends Effect.Service<RelationshipSchemasRepository>()(
	"RelationshipSchemasRepository",
	{
		sync: () => {
			const createRelationshipSchema = Effect.fn(
				"RelationshipSchemasRepository.createRelationshipSchema",
			)(function* (input: {
				slug: Slug;
				name: string;
				userId: UserId;
				propertiesSchema: AppSchema;
				sourceEntitySchemaId: EntitySchemaId | null;
				targetEntitySchemaId: EntitySchemaId | null;
			}) {
				const db = yield* CurrentDb;
				const result = yield* dbEffect(() =>
					db
						.insert(schema.relationshipSchema)
						.values({
							isBuiltin: false,
							name: input.name,
							slug: input.slug,
							userId: input.userId,
							propertiesSchema: input.propertiesSchema,
							sourceEntitySchemaId: input.sourceEntitySchemaId,
							targetEntitySchemaId: input.targetEntitySchemaId,
						})
						.returning(),
				).pipe(
					Effect.mapError((error) =>
						isUniqueConstraintError(relationshipSchemaUserSlugConstraint)(error)
							? conflict("Relationship schema slug already exists")
							: error,
					),
				);

				const row = result[0];
				if (!row) {
					return yield* new DbError({ message: "Relationship schema insert returned no row" });
				}

				return yield* toScope(row);
			});

			const findBuiltinBySlug = Effect.fn("RelationshipSchemasRepository.findBuiltinBySlug")(
				function* (slug: string) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select()
							.from(schema.relationshipSchema)
							.where(
								and(
									eq(schema.relationshipSchema.slug, slug),
									isNull(schema.relationshipSchema.userId),
									eq(schema.relationshipSchema.isBuiltin, true),
								),
							)
							.limit(1),
					);

					if (!row) {
						return null;
					}
					return yield* toScope(row);
				},
			);

			const findBySlugForUser = Effect.fn("RelationshipSchemasRepository.findBySlugForUser")(
				function* (input: { userId: UserId; slug: string }) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select({ id: schema.relationshipSchema.id })
							.from(schema.relationshipSchema)
							.where(
								and(
									eq(schema.relationshipSchema.userId, input.userId),
									eq(schema.relationshipSchema.slug, input.slug),
								),
							)
							.limit(1),
					);

					return row ? { id: RelationshipSchemaId.make(row.id) } : null;
				},
			);

			const findGlobalBySchemaIds = Effect.fn(
				"RelationshipSchemasRepository.findGlobalBySchemaIds",
			)(function* (input: {
				sourceEntitySchemaId: EntitySchemaId;
				targetEntitySchemaId: EntitySchemaId;
			}) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select()
						.from(schema.relationshipSchema)
						.where(
							and(
								isNull(schema.relationshipSchema.userId),
								eq(schema.relationshipSchema.sourceEntitySchemaId, input.sourceEntitySchemaId),
								eq(schema.relationshipSchema.targetEntitySchemaId, input.targetEntitySchemaId),
							),
						)
						.orderBy(desc(schema.relationshipSchema.isBuiltin))
						.limit(1),
				);

				if (!row) {
					return null;
				}
				return yield* toScope(row);
			});

			const findById = Effect.fn("RelationshipSchemasRepository.findById")(function* (
				id: RelationshipSchemaId,
				userId: UserId | null,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select()
						.from(schema.relationshipSchema)
						.where(
							and(
								eq(schema.relationshipSchema.id, id),
								userId !== null
									? or(
											isNull(schema.relationshipSchema.userId),
											eq(schema.relationshipSchema.userId, userId),
										)
									: isNull(schema.relationshipSchema.userId),
							),
						)
						.limit(1),
				);

				if (!row) {
					return null;
				}
				return yield* toScope(row);
			});

			const getEntitySchemaScopeById = Effect.fn(
				"RelationshipSchemasRepository.getEntitySchemaScopeById",
			)(function* (input: { entitySchemaId: EntitySchemaId; userId: UserId }) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select(entitySchemaAccessScopeSelection)
						.from(schema.entitySchema)
						.where(
							and(
								eq(schema.entitySchema.id, input.entitySchemaId),
								or(
									isNull(schema.entitySchema.userId),
									eq(schema.entitySchema.userId, input.userId),
								),
							),
						)
						.limit(1),
				);

				return row ? { ...row, id: EntitySchemaId.make(row.id) } : null;
			});

			const listByUser = Effect.fn("RelationshipSchemasRepository.listByUser")(function* (input: {
				userId: UserId;
				slugs?: ReadonlyArray<string>;
				sourceEntitySchemaId?: EntitySchemaId | null;
				targetEntitySchemaId?: EntitySchemaId | null;
			}) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select()
						.from(schema.relationshipSchema)
						.where(
							and(
								or(
									isNull(schema.relationshipSchema.userId),
									eq(schema.relationshipSchema.userId, input.userId),
								),
								input.slugs && input.slugs.length > 0
									? inArray(schema.relationshipSchema.slug, [...input.slugs])
									: undefined,
								sourceEntitySchemaIdCondition(input.sourceEntitySchemaId),
								targetEntitySchemaIdCondition(input.targetEntitySchemaId),
							),
						)
						.orderBy(asc(schema.relationshipSchema.name), asc(schema.relationshipSchema.createdAt)),
				);

				return yield* Effect.forEach(rows, toScope);
			});

			return {
				createRelationshipSchema,
				findBuiltinBySlug,
				findBySlugForUser,
				findGlobalBySchemaIds,
				findById,
				getEntitySchemaScopeById,
				listByUser,
			};
		},
	},
) {}
