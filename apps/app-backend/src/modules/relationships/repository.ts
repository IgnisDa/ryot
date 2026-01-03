import { DbError } from "@ryot/contract/errors";
import type { UserId } from "@ryot/contract/schema/brands";
import { EntityId, RelationshipId, RelationshipSchemaId } from "@ryot/contract/schema/brands";
import { and, eq, isNull, notInArray, or, sql } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

type RelationshipSnapshotRow = Pick<
	typeof schema.relationship.$inferSelect,
	"id" | "createdAt" | "properties" | "sourceEntityId" | "targetEntityId" | "relationshipSchemaId"
>;

type RelationshipRow = RelationshipSnapshotRow & { readonly wasInserted: boolean };

export type SaveRelationshipInputBase = {
	sourceEntityId: EntityId;
	targetEntityId: EntityId;
	relationshipSchemaId: RelationshipSchemaId;
	onConflict: "preserveExisting" | "replaceProperties";
} & ({ scope: "global" } | { scope: "user"; userId: UserId });

export type SaveRelationshipInput = SaveRelationshipInputBase & {
	properties: Record<string, unknown>;
};

type RelationshipIdentityInput = {
	sourceEntityId: EntityId;
	targetEntityId: EntityId;
	relationshipSchemaId: RelationshipSchemaId;
} & ({ scope: "global" } | { scope: "user"; userId: UserId });

type GlobalRelationshipEntry = {
	entityId: EntityId;
	properties: Record<string, unknown>;
};

type SyncGlobalRelationshipsInputBase = {
	entries: ReadonlyArray<GlobalRelationshipEntry>;
	relationshipSchemaId: RelationshipSchemaId;
};

type AnchoredGlobalRelationshipsSyncInput = SyncGlobalRelationshipsInputBase & {
	type: "anchored";
	direction: "incoming" | "outgoing";
	anchorEntityId: EntityId;
} & (
		| { synchronization: "additive"; onConflict: "preserveExisting" }
		| {
				synchronization: "authoritative";
				onConflict: "preserveExisting" | "replaceProperties";
		  }
	);

type SelfGlobalRelationshipsSyncInput = SyncGlobalRelationshipsInputBase & {
	type: "self";
	onConflict: "replaceProperties";
	synchronization: "authoritative";
};

type SyncGlobalRelationshipsInput =
	| AnchoredGlobalRelationshipsSyncInput
	| SelfGlobalRelationshipsSyncInput;

const relationshipSelection = {
	id: schema.relationship.id,
	createdAt: schema.relationship.createdAt,
	properties: schema.relationship.properties,
	sourceEntityId: schema.relationship.sourceEntityId,
	targetEntityId: schema.relationship.targetEntityId,
	relationshipSchemaId: schema.relationship.relationshipSchemaId,
	wasInserted: sql<boolean>`(xmax = '0'::xid)`,
};

const toRelationship = (row: RelationshipSnapshotRow) => ({
	properties: row.properties,
	id: RelationshipId.make(row.id),
	createdAt: row.createdAt.toISOString(),
	sourceEntityId: EntityId.make(row.sourceEntityId),
	targetEntityId: EntityId.make(row.targetEntityId),
	relationshipSchemaId: RelationshipSchemaId.make(row.relationshipSchemaId),
});

const toSavedRelationship = (row: RelationshipRow) => ({
	...toRelationship(row),
	wasInserted: row.wasInserted,
});

const relationshipIdentityWhere = (input: RelationshipIdentityInput) =>
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

const globalRelationshipConflictTarget = {
	targetWhere: isNull(schema.relationship.userId),
	target: [
		schema.relationship.sourceEntityId,
		schema.relationship.targetEntityId,
		schema.relationship.relationshipSchemaId,
	],
};

const relationshipConflictTarget = (input: RelationshipIdentityInput) =>
	input.scope === "user"
		? {
				target: [
					schema.relationship.userId,
					schema.relationship.sourceEntityId,
					schema.relationship.targetEntityId,
					schema.relationship.relationshipSchemaId,
				],
			}
		: globalRelationshipConflictTarget;

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
						.where(relationshipIdentityWhere({ ...input, scope: "user" }))
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
							.where(relationshipIdentityWhere({ ...input, scope: "user" }))
							.returning({
								id: schema.relationship.id,
								createdAt: schema.relationship.createdAt,
								properties: schema.relationship.properties,
								sourceEntityId: schema.relationship.sourceEntityId,
								targetEntityId: schema.relationship.targetEntityId,
								relationshipSchemaId: schema.relationship.relationshipSchemaId,
							}),
					);

					return row ? toRelationship(row) : null;
				},
			);

			const syncGlobalRelationships = Effect.fn("RelationshipsRepository.syncGlobalRelationships")(
				function* (input: SyncGlobalRelationshipsInput) {
					const db = yield* CurrentDb;
					const entries = [
						...new Map(input.entries.map((entry) => [entry.entityId, entry])).values(),
					];
					const entityIds = entries.map((entry) => entry.entityId);
					const relationshipValues =
						input.type === "self"
							? entries.map((entry) => ({
									userId: null,
									properties: entry.properties,
									targetEntityId: entry.entityId,
									sourceEntityId: entry.entityId,
									relationshipSchemaId: input.relationshipSchemaId,
								}))
							: entries.map((entry) => ({
									userId: null,
									properties: entry.properties,
									targetEntityId:
										input.direction === "outgoing" ? entry.entityId : input.anchorEntityId,
									sourceEntityId:
										input.direction === "outgoing" ? input.anchorEntityId : entry.entityId,
									relationshipSchemaId: input.relationshipSchemaId,
								}));
					const synchronizationWhere =
						input.type === "self"
							? and(
									isNull(schema.relationship.userId),
									eq(schema.relationship.relationshipSchemaId, input.relationshipSchemaId),
									eq(schema.relationship.sourceEntityId, schema.relationship.targetEntityId),
								)
							: and(
									isNull(schema.relationship.userId),
									eq(
										input.direction === "outgoing"
											? schema.relationship.sourceEntityId
											: schema.relationship.targetEntityId,
										input.anchorEntityId,
									),
									eq(schema.relationship.relationshipSchemaId, input.relationshipSchemaId),
								);
					const relatedEntityColumn =
						input.type === "self" || input.direction === "incoming"
							? schema.relationship.sourceEntityId
							: schema.relationship.targetEntityId;

					yield* dbEffect(() =>
						db.transaction((tx) => {
							const synchronize = () => {
								if (input.synchronization === "additive") {
									return Promise.resolve();
								}
								if (entityIds.length === 0) {
									return tx
										.delete(schema.relationship)
										.where(synchronizationWhere)
										.then(() => undefined);
								}

								return tx
									.delete(schema.relationship)
									.where(and(synchronizationWhere, notInArray(relatedEntityColumn, entityIds)))
									.then(() => undefined);
							};

							if (entries.length === 0) {
								return synchronize();
							}
							if (input.onConflict === "preserveExisting") {
								return tx
									.insert(schema.relationship)
									.values(relationshipValues)
									.onConflictDoNothing()
									.then(synchronize);
							}

							return tx
								.insert(schema.relationship)
								.values(relationshipValues)
								.onConflictDoUpdate({
									set: { properties: sql.raw('excluded."properties"') },
									...globalRelationshipConflictTarget,
								})
								.then(synchronize);
						}),
					);
				},
			);

			return {
				saveRelationship,
				deleteUserRelationship,
				findRelationshipProperties,
				syncGlobalRelationships,
				deleteUserRelationshipsForEntity,
				moveUserRelationshipsBetweenEntities,
			};
		},
	},
) {}
