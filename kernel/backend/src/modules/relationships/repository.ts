import { DbError } from "@ryot-app/contract/errors";
import {
	EntityId,
	RelationshipId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

type RelationshipSnapshotRow = Pick<
	typeof schema.relationship.$inferSelect,
	"id" | "createdAt" | "properties" | "sourceEntityId" | "targetEntityId" | "relationshipSchemaSlug"
>;

type RelationshipSnapshotWithProvenanceRow = RelationshipSnapshotRow & {
	readonly relationshipSchemaPluginId: string | null;
};

type RelationshipRow = RelationshipSnapshotRow & { readonly wasInserted: boolean };

export type RelationshipIdentityInput = {
	sourceEntityId: EntityId;
	targetEntityId: EntityId;
	relationshipSchemaSlug: RelationshipSchemaSlug;
	relationshipSchemaPluginId?: string | null | undefined;
} & ({ scope: "global" } | { scope: "user"; userId: UserId });

export type CreateRelationshipInput = RelationshipIdentityInput & {
	properties: Record<string, unknown>;
};

export type UpdateRelationshipInput = RelationshipIdentityInput & {
	properties: Record<string, unknown>;
};

type RestoreRelationshipInput = Pick<
	typeof schema.relationship.$inferInsert,
	| "id"
	| "userId"
	| "createdAt"
	| "properties"
	| "sourceEntityId"
	| "targetEntityId"
	| "relationshipSchemaPluginId"
	| "relationshipSchemaSlug"
>;

export type GlobalRelationshipListInput = {
	relationshipSchemaSlug: RelationshipSchemaSlug;
	relationshipSchemaPluginId?: string | null | undefined;
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
	relationshipSchemaSlug: schema.relationship.relationshipSchemaSlug,
};

const relationshipSnapshotWithProvenanceSelection = {
	...relationshipSnapshotSelection,
	relationshipSchemaPluginId: schema.relationship.relationshipSchemaPluginId,
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
	relationshipSchemaSlug: RelationshipSchemaSlug.make(row.relationshipSchemaSlug),
});

const toRelationshipWithProvenance = (row: RelationshipSnapshotWithProvenanceRow) => ({
	...toRelationship(row),
	relationshipSchemaPluginId: row.relationshipSchemaPluginId,
});

const toSavedRelationship = (row: RelationshipRow) => ({
	...toRelationship(row),
	wasInserted: row.wasInserted,
});

const relationshipSchemaPluginWhere = (pluginId: string | null | undefined) =>
	pluginId == null
		? isNull(schema.relationship.relationshipSchemaPluginId)
		: eq(schema.relationship.relationshipSchemaPluginId, pluginId);

const relationshipIdentityWhere = (input: RelationshipIdentityInput) =>
	input.scope === "user"
		? and(
				eq(schema.relationship.userId, input.userId),
				eq(schema.relationship.sourceEntityId, input.sourceEntityId),
				eq(schema.relationship.targetEntityId, input.targetEntityId),
				eq(schema.relationship.relationshipSchemaSlug, input.relationshipSchemaSlug),
				relationshipSchemaPluginWhere(input.relationshipSchemaPluginId),
			)
		: and(
				isNull(schema.relationship.userId),
				eq(schema.relationship.sourceEntityId, input.sourceEntityId),
				eq(schema.relationship.targetEntityId, input.targetEntityId),
				eq(schema.relationship.relationshipSchemaSlug, input.relationshipSchemaSlug),
				relationshipSchemaPluginWhere(input.relationshipSchemaPluginId),
			);

const globalRelationshipConflictColumns = [
	schema.relationship.userId,
	schema.relationship.sourceEntityId,
	schema.relationship.targetEntityId,
	schema.relationship.relationshipSchemaSlug,
	schema.relationship.relationshipSchemaPluginId,
];

const globalRelationshipConflictDoNothingTarget = {
	target: globalRelationshipConflictColumns,
};

const userRelationshipConflictTarget = {
	target: [
		schema.relationship.userId,
		schema.relationship.sourceEntityId,
		schema.relationship.targetEntityId,
		schema.relationship.relationshipSchemaSlug,
		schema.relationship.relationshipSchemaPluginId,
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
				eq(schema.relationship.relationshipSchemaSlug, input.relationshipSchemaSlug),
				relationshipSchemaPluginWhere(input.relationshipSchemaPluginId),
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
				eq(schema.relationship.relationshipSchemaSlug, input.relationshipSchemaSlug),
				relationshipSchemaPluginWhere(input.relationshipSchemaPluginId),
			);

const globalRelationshipLockKey = (input: GlobalRelationshipListInput) =>
	input.type === "self"
		? `self:${input.relationshipSchemaSlug}:${input.relationshipSchemaPluginId ?? "kernel"}`
		: `anchored:${input.direction}:${input.anchorEntityId}:${input.relationshipSchemaSlug}:${input.relationshipSchemaPluginId ?? "kernel"}`;

export class RelationshipsRepository extends Context.Service<RelationshipsRepository>()(
	"RelationshipsRepository",
	{
		make: Effect.sync(() => {
			const listUserRelationshipsForBackup = Effect.fn(
				"RelationshipsRepository.listUserRelationshipsForBackup",
			)(function* (userId: UserId) {
				const db = yield* Database;
				return yield* mapDatabaseErrors(
					db
						.select(relationshipSnapshotWithProvenanceSelection)
						.from(schema.relationship)
						.where(eq(schema.relationship.userId, userId))
						.orderBy(asc(schema.relationship.id)),
				);
			});

			const restoreRelationship = Effect.fn("RelationshipsRepository.restoreRelationship")(
				function* (input: RestoreRelationshipInput) {
					const db = yield* Database;
					const [row] = yield* mapDatabaseErrors(
						db.insert(schema.relationship).values(input).returning({ id: schema.relationship.id }),
					);
					return row
						? RelationshipId.make(row.id)
						: yield* new DbError({ message: "Relationship restore returned no row" });
				},
			);

			const findRelationshipProperties = Effect.fn(
				"RelationshipsRepository.findRelationshipProperties",
			)(function* (input: {
				userId: UserId;
				sourceEntityId: EntityId;
				targetEntityId: EntityId;
				relationshipSchemaSlug: RelationshipSchemaSlug;
				relationshipSchemaPluginId?: string | null | undefined;
			}) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
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
				const db = yield* Database;
				const values = {
					properties: input.properties,
					sourceEntityId: input.sourceEntityId,
					targetEntityId: input.targetEntityId,
					userId: input.scope === "user" ? input.userId : null,
					relationshipSchemaSlug: input.relationshipSchemaSlug,
					relationshipSchemaPluginId: input.relationshipSchemaPluginId ?? null,
				};

				const [inserted] = yield* mapDatabaseErrors(
					db
						.insert(schema.relationship)
						.values(values)
						.onConflictDoNothing(relationshipConflictDoNothingTarget(input))
						.returning(relationshipSelection),
				);

				if (inserted) {
					return toSavedRelationship(inserted);
				}

				const [existing] = yield* mapDatabaseErrors(
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
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
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
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.delete(schema.relationship)
						.where(relationshipIdentityWhere(input))
						.returning(relationshipSnapshotSelection),
				);

				return row ? toRelationship(row) : null;
			});

			const deleteUserRelationshipById = Effect.fn(
				"RelationshipsRepository.deleteUserRelationshipById",
			)(function* (userId: UserId, relationshipId: RelationshipId) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.delete(schema.relationship)
						.where(
							and(
								eq(schema.relationship.id, relationshipId),
								eq(schema.relationship.userId, userId),
							),
						)
						.returning({ id: schema.relationship.id }),
				);
				return row !== undefined;
			});

			const listUserRelationshipsForEntity = Effect.fn(
				"RelationshipsRepository.listUserRelationshipsForEntity",
			)(function* (input: { userId: UserId; entityId: EntityId }) {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
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
			const listUserRelationshipsForEntityWithProvenance = Effect.fn(
				"RelationshipsRepository.listUserRelationshipsForEntityWithProvenance",
			)(function* (input: { userId: UserId; entityId: EntityId }) {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select(relationshipSnapshotWithProvenanceSelection)
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
				return rows.map(toRelationshipWithProvenance);
			});

			const listEnabledOwnersForSubject = Effect.fn(
				"RelationshipsRepository.listEnabledOwnersForSubject",
			)(function* (input: {
				subjectEntityId: EntityId;
				subjectSide: "source" | "target";
				relationshipSchemaSlug: RelationshipSchemaSlug;
				relationshipSchemaPluginId?: string | null | undefined;
			}) {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.selectDistinct({ userId: schema.relationship.userId })
						.from(schema.relationship)
						.innerJoin(schema.user, eq(schema.user.id, schema.relationship.userId))
						.where(
							and(
								isNotNull(schema.relationship.userId),
								isNull(schema.user.disabledAt),
								eq(schema.relationship.relationshipSchemaSlug, input.relationshipSchemaSlug),
								relationshipSchemaPluginWhere(input.relationshipSchemaPluginId),
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
					const db = yield* Database;
					yield* mapDatabaseErrors(
						db.execute(
							sql`select pg_advisory_xact_lock(hashtext(${globalRelationshipLockKey(input)}))`,
						),
					);
					const rows = yield* mapDatabaseErrors(
						db
							.select(relationshipSnapshotSelection)
							.from(schema.relationship)
							.where(globalRelationshipWhere(input))
							.for("update"),
					);

					return rows.map(toRelationship);
				},
			);

			return {
				createRelationship,
				updateRelationship,
				deleteRelationship,
				restoreRelationship,
				listGlobalRelationships,
				deleteUserRelationshipById,
				findRelationshipProperties,
				listEnabledOwnersForSubject,
				listUserRelationshipsForEntity,
				listUserRelationshipsForBackup,
				listUserRelationshipsForEntityWithProvenance,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
