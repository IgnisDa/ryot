import { DbError } from "@ryot-app/contract/errors";
import { AutomationTriggerPayload } from "@ryot-app/contract/modules/automations/lifecycle";
import type { AutomationTriggerId } from "@ryot-app/contract/schema/brands";
import {
	EntityId,
	RelationshipId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

type RelationshipSnapshotRow = Pick<
	typeof schema.relationship.$inferSelect,
	| "id"
	| "createdAt"
	| "updatedAt"
	| "properties"
	| "sourceEntityId"
	| "targetEntityId"
	| "relationshipSchemaSlug"
>;

type RelationshipSnapshotWithProvenanceRow = RelationshipSnapshotRow & {
	readonly relationshipSchemaPluginId: string | null;
};

type RelationshipRow = RelationshipSnapshotRow & { readonly wasInserted: boolean };

const relationshipIdentityFields = {
	sourceEntityId: EntityId,
	targetEntityId: EntityId,
	relationshipSchemaSlug: RelationshipSchemaSlug,
	relationshipSchemaPluginId: Schema.optional(Schema.NullOr(Schema.String)),
};

export const RelationshipIdentityInput = Schema.Union([
	Schema.Struct({ ...relationshipIdentityFields, scope: Schema.Literal("global") }),
	Schema.Struct({ ...relationshipIdentityFields, userId: UserId, scope: Schema.Literal("user") }),
]);

export type RelationshipIdentityInput = typeof RelationshipIdentityInput.Type;

export type CreateRelationshipInput = RelationshipIdentityInput & {
	properties: Record<string, unknown>;
};

export type UpdateRelationshipInput = RelationshipIdentityInput & {
	properties: Record<string, unknown>;
};

export const relationshipMutationLockKey = (input: RelationshipIdentityInput) =>
	JSON.stringify([
		"relationship",
		input.scope,
		input.scope === "user" ? input.userId : "global",
		input.relationshipSchemaPluginId ?? "kernel",
		input.relationshipSchemaSlug,
		input.sourceEntityId,
		input.targetEntityId,
	]);

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

const globalRelationshipListFields = {
	relationshipSchemaSlug: RelationshipSchemaSlug,
	relationshipSchemaPluginId: Schema.optional(Schema.NullOr(Schema.String)),
};

export const GlobalRelationshipListInput = Schema.Union([
	Schema.Struct({ ...globalRelationshipListFields, type: Schema.Literal("self") }),
	Schema.Struct({
		...globalRelationshipListFields,
		anchorEntityId: EntityId,
		type: Schema.Literal("anchored"),
		direction: Schema.Literals(["incoming", "outgoing"]),
	}),
]);

export type GlobalRelationshipListInput = typeof GlobalRelationshipListInput.Type;

export type RelationshipReconciliationListInput = GlobalRelationshipListInput &
	({ scope: "global" } | { scope: "user"; userId: UserId });

const relationshipSnapshotSelection = {
	id: schema.relationship.id,
	createdAt: schema.relationship.createdAt,
	updatedAt: schema.relationship.updatedAt,
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
	updatedAt: row.updatedAt.toISOString(),
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

const preparedRelationshipWhere = (before: ReturnType<typeof toRelationship>) =>
	and(
		eq(schema.relationship.id, before.id),
		sql`${schema.relationship.properties} = ${JSON.stringify(before.properties)}::jsonb`,
	);

const globalRelationshipConflictColumns = [
	schema.relationship.userId,
	schema.relationship.sourceEntityId,
	schema.relationship.targetEntityId,
	schema.relationship.relationshipSchemaSlug,
	schema.relationship.relationshipSchemaPluginId,
];

const globalRelationshipConflictDoNothingTarget = { target: globalRelationshipConflictColumns };

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

const relationshipReconciliationWhere = (input: RelationshipReconciliationListInput) =>
	and(
		input.scope === "user"
			? eq(schema.relationship.userId, input.userId)
			: isNull(schema.relationship.userId),
		eq(schema.relationship.relationshipSchemaSlug, input.relationshipSchemaSlug),
		relationshipSchemaPluginWhere(input.relationshipSchemaPluginId),
		input.type === "self"
			? eq(schema.relationship.sourceEntityId, schema.relationship.targetEntityId)
			: eq(
					input.direction === "outgoing"
						? schema.relationship.sourceEntityId
						: schema.relationship.targetEntityId,
					input.anchorEntityId,
				),
	);

const relationshipReconciliationLockKey = (input: RelationshipReconciliationListInput) =>
	JSON.stringify([
		"relationship-reconciliation",
		input.scope,
		input.scope === "user" ? input.userId : "global",
		input.relationshipSchemaPluginId ?? "kernel",
		input.relationshipSchemaSlug,
		input.type,
		input.type === "anchored" ? input.direction : null,
		input.type === "anchored" ? input.anchorEntityId : null,
	]);

export class RelationshipsRepository extends Context.Service<RelationshipsRepository>()(
	"RelationshipsRepository",
	{
		make: Effect.sync(() => {
			const findLifecyclePayload = Effect.fn("RelationshipsRepository.findLifecyclePayload")(
				function* (id: AutomationTriggerId) {
					const db = yield* Database;
					const [row] = yield* mapDatabaseErrors(
						db
							.select({ payload: schema.automationTrigger.payload })
							.from(schema.automationTrigger)
							.where(eq(schema.automationTrigger.id, id)),
					);
					if (!row) {
						return null;
					}
					return yield* decodeStoredSchema(
						row.payload,
						AutomationTriggerPayload,
						"Relationship command payload is invalid or pruned",
					);
				},
			);
			const findRelationship = Effect.fn("RelationshipsRepository.findRelationship")(function* (
				input: RelationshipIdentityInput,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select(relationshipSnapshotSelection)
						.from(schema.relationship)
						.where(relationshipIdentityWhere(input))
						.limit(1)
						.for("update"),
				);
				return row ? toRelationship(row) : null;
			});
			const findUserRelationshipById = Effect.fn(
				"RelationshipsRepository.findUserRelationshipById",
			)(function* (userId: UserId, relationshipId: RelationshipId) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select(relationshipSnapshotWithProvenanceSelection)
						.from(schema.relationship)
						.where(
							and(
								eq(schema.relationship.id, relationshipId),
								eq(schema.relationship.userId, userId),
							),
						)
						.limit(1),
				);
				return row ? toRelationshipWithProvenance(row) : null;
			});
			const lockRelationshipMutations = Effect.fn(
				"RelationshipsRepository.lockRelationshipMutations",
			)(function* (inputs: ReadonlyArray<RelationshipIdentityInput>) {
				const db = yield* Database;
				const keys = [...new Set(inputs.map(relationshipMutationLockKey))].sort();
				for (const key of keys) {
					yield* mapDatabaseErrors(
						db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`),
					);
				}
			});
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

			const updatePreparedRelationship = Effect.fn(
				"RelationshipsRepository.updatePreparedRelationship",
			)(function* (input: UpdateRelationshipInput & { before: ReturnType<typeof toRelationship> }) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.update(schema.relationship)
						.set({ properties: input.properties })
						.where(and(relationshipIdentityWhere(input), preparedRelationshipWhere(input.before)))
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

			const deletePreparedRelationship = Effect.fn(
				"RelationshipsRepository.deletePreparedRelationship",
			)(function* (
				input: RelationshipIdentityInput & { before: ReturnType<typeof toRelationship> },
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.delete(schema.relationship)
						.where(and(relationshipIdentityWhere(input), preparedRelationshipWhere(input.before)))
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

			const listRelationshipsForReconciliation = Effect.fn(
				"RelationshipsRepository.listRelationshipsForReconciliation",
			)(function* (input: RelationshipReconciliationListInput) {
				const db = yield* Database;
				yield* mapDatabaseErrors(
					db.execute(
						sql`select pg_advisory_xact_lock(hashtextextended(${relationshipReconciliationLockKey(input)}, 0))`,
					),
				);
				const rows = yield* mapDatabaseErrors(
					db
						.select(relationshipSnapshotSelection)
						.from(schema.relationship)
						.where(relationshipReconciliationWhere(input))
						.for("update"),
				);

				return rows.map(toRelationship);
			});
			const listGlobalRelationships = (input: GlobalRelationshipListInput) =>
				listRelationshipsForReconciliation({ ...input, scope: "global" });

			return {
				findRelationship,
				createRelationship,
				updateRelationship,
				deleteRelationship,
				restoreRelationship,
				findLifecyclePayload,
				listGlobalRelationships,
				findUserRelationshipById,
				lockRelationshipMutations,
				updatePreparedRelationship,
				deletePreparedRelationship,
				deleteUserRelationshipById,
				findRelationshipProperties,
				listEnabledOwnersForSubject,
				listUserRelationshipsForEntity,
				listUserRelationshipsForBackup,
				listRelationshipsForReconciliation,
				listUserRelationshipsForEntityWithProvenance,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
