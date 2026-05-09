import { and, eq, isNull, or, sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect, schema } from "#lib/db";
import { DbError } from "#lib/errors";

type RelationshipRow = Pick<
	typeof schema.relationship.$inferSelect,
	"id" | "createdAt" | "properties" | "sourceEntityId" | "targetEntityId" | "relationshipSchemaId"
> & {
	readonly wasInserted: boolean;
};

type MembershipRow = Pick<
	typeof schema.relationship.$inferSelect,
	"id" | "createdAt" | "properties" | "sourceEntityId" | "targetEntityId" | "relationshipSchemaId"
>;

export type SavedRelationship = {
	readonly id: string;
	readonly createdAt: string;
	readonly wasInserted: boolean;
	readonly sourceEntityId: string;
	readonly targetEntityId: string;
	readonly relationshipSchemaId: string;
	readonly properties: Record<string, unknown>;
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
	id: row.id,
	properties: row.properties,
	wasInserted: row.wasInserted,
	sourceEntityId: row.sourceEntityId,
	targetEntityId: row.targetEntityId,
	createdAt: row.createdAt.toISOString(),
	relationshipSchemaId: row.relationshipSchemaId,
});

const toMembershipRelationship = (row: MembershipRow) => ({
	id: row.id,
	properties: row.properties,
	sourceEntityId: row.sourceEntityId,
	targetEntityId: row.targetEntityId,
	createdAt: row.createdAt.toISOString(),
	relationshipSchemaId: row.relationshipSchemaId,
});

export class RelationshipsRepository extends Effect.Service<RelationshipsRepository>()(
	"RelationshipsRepository",
	{
		sync: () => ({
			findRelationshipProperties: (input: {
				userId: string;
				sourceEntityId: string;
				targetEntityId: string;
				relationshipSchemaId: string;
			}) =>
				Effect.gen(function* () {
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
				}),
			insertRelationship: (input: {
				userId: string;
				sourceEntityId: string;
				targetEntityId: string;
				relationshipSchemaId: string;
				properties: Record<string, unknown>;
			}) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					yield* dbEffect(() =>
						db
							.insert(schema.relationship)
							.values({
								userId: input.userId,
								properties: input.properties,
								sourceEntityId: input.sourceEntityId,
								targetEntityId: input.targetEntityId,
								relationshipSchemaId: input.relationshipSchemaId,
							})
							.onConflictDoNothing({
								target: [
									schema.relationship.userId,
									schema.relationship.sourceEntityId,
									schema.relationship.targetEntityId,
									schema.relationship.relationshipSchemaId,
								],
							}),
					);
				}),
			upsertRelationship: (input: {
				userId: string;
				sourceEntityId: string;
				targetEntityId: string;
				relationshipSchemaId: string;
				properties: Record<string, unknown>;
			}) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.insert(schema.relationship)
							.values({
								userId: input.userId,
								properties: input.properties,
								sourceEntityId: input.sourceEntityId,
								targetEntityId: input.targetEntityId,
								relationshipSchemaId: input.relationshipSchemaId,
							})
							.onConflictDoUpdate({
								set: { properties: input.properties },
								target: [
									schema.relationship.userId,
									schema.relationship.sourceEntityId,
									schema.relationship.targetEntityId,
									schema.relationship.relationshipSchemaId,
								],
							})
							.returning(relationshipSelection),
					);

					if (!row) {
						return yield* new DbError({ message: "Relationship upsert returned no row" });
					}

					return toSavedRelationship(row);
				}),
			upsertEntityRelationship: (input: {
				sourceEntityId: string;
				targetEntityId: string;
				relationshipSchemaId: string;
				properties: Record<string, unknown>;
			}) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					yield* dbEffect(() =>
						db
							.insert(schema.relationship)
							.values({
								userId: null,
								properties: input.properties,
								sourceEntityId: input.sourceEntityId,
								targetEntityId: input.targetEntityId,
								relationshipSchemaId: input.relationshipSchemaId,
							})
							.onConflictDoUpdate({
								set: { properties: input.properties },
								targetWhere: isNull(schema.relationship.userId),
								target: [
									schema.relationship.sourceEntityId,
									schema.relationship.targetEntityId,
									schema.relationship.relationshipSchemaId,
								],
							}),
					);
				}),
			deleteUserRelationshipsForEntity: (input: { userId: string; entityId: string }) =>
				Effect.gen(function* () {
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
				}),
			upsertMembership: (input: {
				userId: string;
				entityId: string;
				collectionId: string;
				relationshipSchemaId: string;
				properties: Record<string, unknown>;
			}) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.insert(schema.relationship)
							.values({
								userId: input.userId,
								properties: input.properties,
								sourceEntityId: input.entityId,
								targetEntityId: input.collectionId,
								relationshipSchemaId: input.relationshipSchemaId,
							})
							.onConflictDoUpdate({
								set: { properties: input.properties },
								target: [
									schema.relationship.userId,
									schema.relationship.sourceEntityId,
									schema.relationship.targetEntityId,
									schema.relationship.relationshipSchemaId,
								],
							})
							.returning(relationshipSelection),
					);

					if (!row) {
						return yield* new DbError({ message: "Membership upsert returned no row" });
					}

					return {
						...toMembershipRelationship(row),
						wasInserted: row.wasInserted,
					};
				}),
			deleteMembership: (input: {
				userId: string;
				entityId: string;
				collectionId: string;
				relationshipSchemaId: string;
			}) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.delete(schema.relationship)
							.where(
								and(
									eq(schema.relationship.userId, input.userId),
									eq(schema.relationship.sourceEntityId, input.entityId),
									eq(schema.relationship.targetEntityId, input.collectionId),
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

					return row ? toMembershipRelationship(row) : null;
				}),
		}),
	},
) {}
