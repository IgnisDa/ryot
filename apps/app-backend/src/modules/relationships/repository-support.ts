import type { RelationshipSnapshot } from "@ryot/contract/modules/automations/schemas";
import type { UserId } from "@ryot/contract/schema/brands";
import { EntityId, RelationshipId, RelationshipSchemaId } from "@ryot/contract/schema/brands";
import { and, eq, isNull, sql } from "drizzle-orm";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";

export type RelationshipSnapshotRow = Pick<
	typeof schema.relationship.$inferSelect,
	"id" | "createdAt" | "properties" | "sourceEntityId" | "targetEntityId" | "relationshipSchemaId"
>;

export type RelationshipRow = RelationshipSnapshotRow & { readonly wasInserted: boolean };

export type SaveRelationshipInputBase = {
	sourceEntityId: EntityId;
	targetEntityId: EntityId;
	relationshipSchemaId: RelationshipSchemaId;
	onConflict: "preserveExisting" | "replaceProperties";
} & ({ scope: "global" } | { scope: "user"; userId: UserId });

export type SaveRelationshipInput = SaveRelationshipInputBase & {
	properties: Record<string, unknown>;
};

type DistributiveOmit<T, Key extends PropertyKey> = T extends unknown ? Omit<T, Key> : never;

export type RelationshipIdentityInput = DistributiveOmit<SaveRelationshipInputBase, "onConflict">;

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
	anchorEntityId: EntityId;
	direction: "incoming" | "outgoing";
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

export type SyncGlobalRelationshipsInput =
	| SelfGlobalRelationshipsSyncInput
	| AnchoredGlobalRelationshipsSyncInput;

export type GlobalRelationshipSyncOutcome = {
	afterCount: number;
	beforeCount: number;
	mutations: ReadonlyArray<{
		after?: RelationshipSnapshot;
		before?: RelationshipSnapshot;
		operation: "create" | "update" | "delete" | "noop";
	}>;
};

export type SaveRelationshipOutcome = {
	after?: RelationshipSnapshot;
	before?: RelationshipSnapshot;
	operation: "create" | "update" | "noop";
	relationship: ReturnType<typeof toSavedRelationship>;
};

export const relationshipSelection = {
	id: schema.relationship.id,
	createdAt: schema.relationship.createdAt,
	properties: schema.relationship.properties,
	wasInserted: sql<boolean>`(xmax = '0'::xid)`,
	sourceEntityId: schema.relationship.sourceEntityId,
	targetEntityId: schema.relationship.targetEntityId,
	relationshipSchemaId: schema.relationship.relationshipSchemaId,
};

export const toRelationship = (row: RelationshipSnapshotRow) => ({
	properties: row.properties,
	id: RelationshipId.make(row.id),
	createdAt: row.createdAt.toISOString(),
	sourceEntityId: EntityId.make(row.sourceEntityId),
	targetEntityId: EntityId.make(row.targetEntityId),
	relationshipSchemaId: RelationshipSchemaId.make(row.relationshipSchemaId),
});

export const toSavedRelationship = (row: RelationshipRow) => ({
	...toRelationship(row),
	wasInserted: row.wasInserted,
});

export const relationshipIdentityWhere = (input: RelationshipIdentityInput) =>
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

export const globalRelationshipIdentity = (row: {
	sourceEntityId: string;
	targetEntityId: string;
}) => `${row.sourceEntityId}:${row.targetEntityId}`;

export const buildGlobalRelationshipSyncPlan = (input: SyncGlobalRelationshipsInput) => {
	const entries = [...new Map(input.entries.map((entry) => [entry.entityId, entry])).values()];
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
					relationshipSchemaId: input.relationshipSchemaId,
					targetEntityId: input.direction === "outgoing" ? entry.entityId : input.anchorEntityId,
					sourceEntityId: input.direction === "outgoing" ? input.anchorEntityId : entry.entityId,
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
	const synchronizationLockKey =
		input.type === "self"
			? `relationship-sync:${input.relationshipSchemaId}:self`
			: `relationship-sync:${input.relationshipSchemaId}:${input.direction}:${input.anchorEntityId}`;

	return {
		entries,
		entityIds,
		relatedEntityColumn,
		relationshipValues,
		synchronizationLockKey,
		synchronizationWhere,
	};
};

const globalRelationshipConflictColumns = [
	schema.relationship.sourceEntityId,
	schema.relationship.targetEntityId,
	schema.relationship.relationshipSchemaId,
];

export const globalRelationshipConflictDoNothingTarget = {
	where: isNull(schema.relationship.userId),
	target: globalRelationshipConflictColumns,
};

export const globalRelationshipConflictDoUpdateTarget = {
	targetWhere: isNull(schema.relationship.userId),
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

export const relationshipConflictDoNothingTarget = (input: RelationshipIdentityInput) =>
	input.scope === "user"
		? userRelationshipConflictTarget
		: globalRelationshipConflictDoNothingTarget;

export const relationshipConflictDoUpdateTarget = (input: RelationshipIdentityInput) =>
	input.scope === "user"
		? userRelationshipConflictTarget
		: globalRelationshipConflictDoUpdateTarget;
