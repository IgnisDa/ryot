import { and, eq, isNull, or, sql } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/db/service";
import { DbError } from "#lib/errors";
import type { UserId } from "#lib/schema/brands";
import { EntityId, RelationshipId, RelationshipSchemaId } from "#lib/schema/brands";

type RelationshipRow = Pick<
	typeof schema.relationship.$inferSelect,
	"id" | "createdAt" | "properties" | "sourceEntityId" | "targetEntityId" | "relationshipSchemaId"
> & {
	readonly wasInserted: boolean;
};

type RelationshipSnapshotRow = Pick<
	typeof schema.relationship.$inferSelect,
	"id" | "createdAt" | "properties" | "sourceEntityId" | "targetEntityId" | "relationshipSchemaId"
>;

export type SaveRelationshipInputBase = {
	sourceEntityId: EntityId;
	targetEntityId: EntityId;
	relationshipSchemaId: RelationshipSchemaId;
	onConflict: "preserveExisting" | "replaceProperties";
} & ({ scope: "global" } | { scope: "user"; userId: UserId });

export type SaveRelationshipInput = SaveRelationshipInputBase & {
	properties: Record<string, unknown>;
};

const relationshipSelection = {
	id: schema.relationship.id,
	createdAt: schema.relationship.createdAt,
	properties: schema.relationship.properties,
	sourceEntityId: schema.relationship.sourceEntityId,
	targetEntityId: schema.relationship.targetEntityId,
	relationshipSchemaId: schema.relationship.relationshipSchemaId,
	wasInserted: sql<boolean>`(xmax = '0'::xid)`,
};

const toSavedRelationship = (row: RelationshipRow) => ({
	properties: row.properties,
	wasInserted: row.wasInserted,
	id: RelationshipId.make(row.id),
	createdAt: row.createdAt.toISOString(),
	sourceEntityId: EntityId.make(row.sourceEntityId),
	targetEntityId: EntityId.make(row.targetEntityId),
	relationshipSchemaId: RelationshipSchemaId.make(row.relationshipSchemaId),
});

const toDeletedRelationship = (row: RelationshipSnapshotRow) => ({
	properties: row.properties,
	id: RelationshipId.make(row.id),
	createdAt: row.createdAt.toISOString(),
	sourceEntityId: EntityId.make(row.sourceEntityId),
	targetEntityId: EntityId.make(row.targetEntityId),
	relationshipSchemaId: RelationshipSchemaId.make(row.relationshipSchemaId),
});

const relationshipIdentityWhere = (input: SaveRelationshipInput) =>
	input.scope === "user"
		? and(
				eq(schema.relationship.userId, input.userId),
				eq(schema.relationship.sourceEntityId, input.sourceEntityId),
				eq(schema.relationship.targetEntityId, input.targetEntityId),
				eq(schema.relationship.relationshipSchemaId, input.relationshipSchemaId),
			)
		: and(
				isNull(schema.relationship.userId),
				eq(schema.relationship.sourceEntityId, input.sourceEntityId),
				eq(schema.relationship.targetEntityId, input.targetEntityId),
				eq(schema.relationship.relationshipSchemaId, input.relationshipSchemaId),
			);

const relationshipConflictTarget = (input: SaveRelationshipInput) =>
	input.scope === "user"
		? {
				target: [
					schema.relationship.userId,
					schema.relationship.sourceEntityId,
					schema.relationship.targetEntityId,
					schema.relationship.relationshipSchemaId,
				],
			}
		: {
				targetWhere: isNull(schema.relationship.userId),
				target: [
					schema.relationship.sourceEntityId,
					schema.relationship.targetEntityId,
					schema.relationship.relationshipSchemaId,
				],
			};

export class RelationshipsRepository extends Effect.Service<RelationshipsRepository>()(
	"RelationshipsRepository",
	{
		sync: () => {
			const findRelationshipProperties = Effect.fn(
				"RelationshipsRepository.findRelationshipProperties",
			)(function* (input: {
				userId: UserId;
				sourceEntityId: EntityId;
				targetEntityId: EntityId;
				relationshipSchemaId: RelationshipSchemaId;
			}) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({ properties: schema.relationship.properties })
						.from(schema.relationship)
						.where(
							and(
								eq(schema.relationship.userId, input.userId),
								eq(schema.relationship.sourceEntityId, input.sourceEntityId),
								eq(schema.relationship.targetEntityId, input.targetEntityId),
								eq(schema.relationship.relationshipSchemaId, input.relationshipSchemaId),
							),
						)
						.limit(1),
				);
				return row?.properties ?? null;
			});

			const saveRelationship = Effect.fn("RelationshipsRepository.saveRelationship")(function* (
				input: SaveRelationshipInput,
			) {
				const db = yield* CurrentDb;
				const values = {
					properties: input.properties,
					sourceEntityId: input.sourceEntityId,
					targetEntityId: input.targetEntityId,
					relationshipSchemaId: input.relationshipSchemaId,
					userId: input.scope === "user" ? input.userId : null,
				};

				if (input.onConflict === "preserveExisting") {
					const [inserted] = yield* dbEffect(() =>
						db
							.insert(schema.relationship)
							.values(values)
							.onConflictDoNothing(relationshipConflictTarget(input))
							.returning(relationshipSelection),
					);

					if (inserted) {
						return toSavedRelationship(inserted);
					}

					const [existing] = yield* dbEffect(() =>
						db
							.select(relationshipSelection)
							.from(schema.relationship)
							.where(relationshipIdentityWhere(input))
							.limit(1),
					);

					if (!existing) {
						return yield* new DbError({ message: "Relationship insert conflict but not found" });
					}

					return toSavedRelationship({ ...existing, wasInserted: false });
				}

				const [row] = yield* dbEffect(() =>
					db
						.insert(schema.relationship)
						.values(values)
						.onConflictDoUpdate({
							set: { properties: input.properties },
							...relationshipConflictTarget(input),
						})
						.returning(relationshipSelection),
				);

				if (!row) {
					return yield* new DbError({ message: "Relationship upsert returned no row" });
				}

				return toSavedRelationship(row);
			});

			const deleteUserRelationshipsForEntity = Effect.fn(
				"RelationshipsRepository.deleteUserRelationshipsForEntity",
			)(function* (input: { userId: UserId; entityId: EntityId }) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.delete(schema.relationship)
						.where(
							and(
								eq(schema.relationship.userId, input.userId),
								or(
									eq(schema.relationship.sourceEntityId, input.entityId),
									eq(schema.relationship.targetEntityId, input.entityId),
								),
							),
						)
						.returning({ id: schema.relationship.id }),
				);

				return rows.length;
			});

			const moveUserRelationshipsBetweenEntities = Effect.fn(
				"RelationshipsRepository.moveUserRelationshipsBetweenEntities",
			)(function* (input: { userId: UserId; mergeFrom: EntityId; mergeInto: EntityId }) {
				const db = yield* CurrentDb;
				const result = yield* dbEffect(() =>
					db.execute<{ count: string }>(sql`
						with candidates as (
							select
								md5("id" || ':merge:' || ${input.mergeInto}) as "id",
								"user_id",
								"properties",
								"relationship_schema_id",
								case
									when "source_entity_id" = ${input.mergeFrom} then ${input.mergeInto}
									else "source_entity_id"
								end as "source_entity_id",
								case
									when "target_entity_id" = ${input.mergeFrom} then ${input.mergeInto}
									else "target_entity_id"
								end as "target_entity_id"
							from "relationship"
							where "user_id" = ${input.userId}
								and (
									"source_entity_id" = ${input.mergeFrom}
									or "target_entity_id" = ${input.mergeFrom}
								)
						), inserted as (
							insert into "relationship" (
								"id",
								"user_id",
								"properties",
								"source_entity_id",
								"target_entity_id",
								"relationship_schema_id"
							)
							select
								"id",
								"user_id",
								"properties",
								"source_entity_id",
								"target_entity_id",
								"relationship_schema_id"
							from candidates
							where "source_entity_id" <> "target_entity_id"
							on conflict (
								"user_id",
								"source_entity_id",
								"target_entity_id",
								"relationship_schema_id"
							) do nothing
							returning "id"
						), deleted as (
							delete from "relationship"
							where "user_id" = ${input.userId}
								and (
									"source_entity_id" = ${input.mergeFrom}
									or "target_entity_id" = ${input.mergeFrom}
								)
							returning "id"
						)
						select count(*)::text as "count" from deleted
					`),
				);

				return Number(result.rows[0]?.count ?? 0);
			});

			const deleteUserRelationship = Effect.fn("RelationshipsRepository.deleteUserRelationship")(
				function* (input: {
					userId: UserId;
					sourceEntityId: EntityId;
					targetEntityId: EntityId;
					relationshipSchemaId: RelationshipSchemaId;
				}) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.delete(schema.relationship)
							.where(
								and(
									eq(schema.relationship.userId, input.userId),
									eq(schema.relationship.sourceEntityId, input.sourceEntityId),
									eq(schema.relationship.targetEntityId, input.targetEntityId),
									eq(schema.relationship.relationshipSchemaId, input.relationshipSchemaId),
								),
							)
							.returning({
								id: schema.relationship.id,
								createdAt: schema.relationship.createdAt,
								properties: schema.relationship.properties,
								sourceEntityId: schema.relationship.sourceEntityId,
								targetEntityId: schema.relationship.targetEntityId,
								relationshipSchemaId: schema.relationship.relationshipSchemaId,
							}),
					);

					return row ? toDeletedRelationship(row) : null;
				},
			);

			return {
				saveRelationship,
				deleteUserRelationship,
				findRelationshipProperties,
				deleteUserRelationshipsForEntity,
				moveUserRelationshipsBetweenEntities,
			};
		},
	},
) {}
