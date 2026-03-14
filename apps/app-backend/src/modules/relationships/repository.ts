import { DbError } from "@ryot/contract/errors";
import {
	EntityId,
	RelationshipId,
	RelationshipSchemaId,
	UserId,
	type SandboxScriptId,
} from "@ryot/contract/schema/brands";
import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

type RelationshipSnapshotRow = Pick<
	typeof schema.relationship.$inferSelect,
	"id" | "createdAt" | "properties" | "sourceEntityId" | "targetEntityId" | "relationshipSchemaId"
>;

type RelationshipRow = RelationshipSnapshotRow & { readonly wasInserted: boolean };

export type RelationshipIdentityInput = {
	sourceEntityId: EntityId;
	targetEntityId: EntityId;
	relationshipSchemaId: RelationshipSchemaId;
} & ({ scope: "global" } | { scope: "user"; userId: UserId });

export type CreateRelationshipInput = RelationshipIdentityInput & {
	properties: Record<string, unknown>;
};

export type UpdateRelationshipInput = RelationshipIdentityInput & {
	properties: Record<string, unknown>;
};

export type GlobalRelationshipListInput = {
	relationshipSchemaId: RelationshipSchemaId;
} & (
	| { type: "self" }
	| {
			type: "anchored";
			direction: "incoming" | "outgoing";
			anchorEntityId: EntityId;
	  }
);

const relationshipSnapshotSelection = {
	id: schema.relationship.id,
	createdAt: schema.relationship.createdAt,
	properties: schema.relationship.properties,
	sourceEntityId: schema.relationship.sourceEntityId,
	targetEntityId: schema.relationship.targetEntityId,
	relationshipSchemaId: schema.relationship.relationshipSchemaId,
};

const relationshipSelection = {
	...relationshipSnapshotSelection,
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

const globalRelationshipConflictColumns = [
	schema.relationship.sourceEntityId,
	schema.relationship.targetEntityId,
	schema.relationship.relationshipSchemaId,
];

const globalRelationshipConflictDoNothingTarget = {
	where: isNull(schema.relationship.userId),
	target: globalRelationshipConflictColumns,
};

const userRelationshipConflictTarget = {
	target: [
		schema.relationship.userId,
		schema.relationship.sourceEntityId,
		schema.relationship.targetEntityId,
		schema.relationship.relationshipSchemaId,
	],
};

const relationshipConflictDoNothingTarget = (input: RelationshipIdentityInput) =>
	input.scope === "user"
		? userRelationshipConflictTarget
		: globalRelationshipConflictDoNothingTarget;

const globalRelationshipWhere = (input: GlobalRelationshipListInput) =>
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

const globalRelationshipLockKey = (input: GlobalRelationshipListInput) =>
	input.type === "self"
		? `self:${input.relationshipSchemaId}`
		: `anchored:${input.direction}:${input.anchorEntityId}:${input.relationshipSchemaId}`;

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
						.limit(1)
						.for("update"),
				);
				return row?.properties ?? null;
			});

			const createRelationship = Effect.fn("RelationshipsRepository.createRelationship")(function* (
				input: CreateRelationshipInput,
			) {
				const db = yield* CurrentDb;
				const values = {
					properties: input.properties,
					sourceEntityId: input.sourceEntityId,
					targetEntityId: input.targetEntityId,
					relationshipSchemaId: input.relationshipSchemaId,
					userId: input.scope === "user" ? input.userId : null,
				};

				const [inserted] = yield* dbEffect(() =>
					db
						.insert(schema.relationship)
						.values(values)
						.onConflictDoNothing(relationshipConflictDoNothingTarget(input))
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
						.limit(1)
						.for("update"),
				);

				if (!existing) {
					return yield* new DbError({ message: "Relationship insert conflict but not found" });
				}

				return toSavedRelationship({ ...existing, wasInserted: false });
			});

			const updateRelationship = Effect.fn("RelationshipsRepository.updateRelationship")(function* (
				input: UpdateRelationshipInput,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.update(schema.relationship)
						.set({ properties: input.properties })
						.where(relationshipIdentityWhere(input))
						.returning(relationshipSnapshotSelection),
				);

				return row ? toSavedRelationship({ ...row, wasInserted: false }) : null;
			});

			const deleteRelationship = Effect.fn("RelationshipsRepository.deleteRelationship")(function* (
				input: RelationshipIdentityInput,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.delete(schema.relationship)
						.where(relationshipIdentityWhere(input))
						.returning(relationshipSnapshotSelection),
				);

				return row ? toRelationship(row) : null;
			});

			const listUserRelationshipsForEntity = Effect.fn(
				"RelationshipsRepository.listUserRelationshipsForEntity",
			)(function* (input: { userId: UserId; entityId: EntityId }) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select(relationshipSnapshotSelection)
						.from(schema.relationship)
						.where(
							and(
								eq(schema.relationship.userId, input.userId),
								or(
									eq(schema.relationship.sourceEntityId, input.entityId),
									eq(schema.relationship.targetEntityId, input.entityId),
								),
							),
						)
						.for("update"),
				);

				return rows.map(toRelationship);
			});

			const listEnabledOwnersForSubject = Effect.fn(
				"RelationshipsRepository.listEnabledOwnersForSubject",
			)(function* (input: {
				subjectEntityId: EntityId;
				subjectSide: "source" | "target";
				relationshipSchemaId: RelationshipSchemaId;
			}) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.selectDistinct({ userId: schema.relationship.userId })
						.from(schema.relationship)
						.innerJoin(schema.user, eq(schema.user.id, schema.relationship.userId))
						.where(
							and(
								isNotNull(schema.relationship.userId),
								isNull(schema.user.disabledAt),
								eq(schema.relationship.relationshipSchemaId, input.relationshipSchemaId),
								eq(
									input.subjectSide === "source"
										? schema.relationship.sourceEntityId
										: schema.relationship.targetEntityId,
									input.subjectEntityId,
								),
							),
						)
						.orderBy(asc(schema.relationship.userId)),
				);
				return rows.flatMap((row) => (row.userId ? [UserId.make(row.userId)] : []));
			});

			const listGlobalRelationships = Effect.fn("RelationshipsRepository.listGlobalRelationships")(
				function* (input: GlobalRelationshipListInput) {
					const db = yield* CurrentDb;
					yield* dbEffect(() =>
						db.execute(
							sql`select pg_advisory_xact_lock(hashtext(${globalRelationshipLockKey(input)}))`,
						),
					);
					const rows = yield* dbEffect(() =>
						db
							.select(relationshipSnapshotSelection)
							.from(schema.relationship)
							.where(globalRelationshipWhere(input))
							.for("update"),
					);

					return rows.map(toRelationship);
				},
			);

			const deleteTouchingEntitiesOfSandboxScript = Effect.fn(
				"RelationshipsRepository.deleteTouchingEntitiesOfSandboxScript",
			)(function* (sandboxScriptId: SandboxScriptId) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.delete(schema.relationship)
						.where(
							or(
								sql`${schema.relationship.sourceEntityId} in (select ${schema.entity.id} from ${schema.entity} where ${schema.entity.sandboxScriptId} = ${sandboxScriptId})`,
								sql`${schema.relationship.targetEntityId} in (select ${schema.entity.id} from ${schema.entity} where ${schema.entity.sandboxScriptId} = ${sandboxScriptId})`,
							),
						)
						.returning({ id: schema.relationship.id }),
				);
				return rows.length;
			});

			return {
				createRelationship,
				updateRelationship,
				deleteRelationship,
				listGlobalRelationships,
				findRelationshipProperties,
				listEnabledOwnersForSubject,
				listUserRelationshipsForEntity,
				deleteTouchingEntitiesOfSandboxScript,
			};
		},
	},
) {}
