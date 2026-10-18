import { DbError } from "@ryot-app/contract/errors";
import { relationshipEnds } from "@ryot-app/contract/modules/relationships/orientation";
import {
	EntityId,
	PluginId,
	RelationshipId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";
import { chunksOf } from "effect/Array";

import { lockSortedAdvisoryKeys, STATEMENT_CHUNK_SIZE } from "#modules/entities/repository";
import { pluginIdWhere } from "#platform/db/definition-owner";
import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

type RelationshipRow = RelationshipSnapshotRow & { readonly wasInserted: boolean };

type RelationshipSnapshotRow = Pick<
	typeof schema.relationship.$inferSelect,
	| "id"
	| "createdAt"
	| "updatedAt"
	| "properties"
	| "sourceEntityId"
	| "targetEntityId"
	| "relationshipSchemaSlug"
	| "relationshipSchemaPluginId"
>;

const relationshipIdentityFields = {
	sourceEntityId: EntityId,
	targetEntityId: EntityId,
	relationshipSchemaSlug: RelationshipSchemaSlug,
	relationshipSchemaPluginId: Schema.NullOr(Schema.String),
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
		input.relationshipSchemaPluginId,
		input.relationshipSchemaSlug,
		input.sourceEntityId,
		input.targetEntityId,
	]);

const globalRelationshipListFields = {
	relationshipSchemaSlug: RelationshipSchemaSlug,
	relationshipSchemaPluginId: Schema.NullOr(Schema.String),
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
	relationshipSchemaPluginId: schema.relationship.relationshipSchemaPluginId,
};

const relationshipSnapshotWithProvenanceSelection = {
	...relationshipSnapshotSelection,
	relationshipSchemaPluginId: schema.relationship.relationshipSchemaPluginId,
};

const relationshipSelection = {
	...relationshipSnapshotSelection,
	wasInserted: sql<boolean>`(xmax = '0'::xid)`,
};

const ownedRelationshipSelection = {
	...relationshipSnapshotSelection,
	userId: schema.relationship.userId,
};

const toRelationship = (row: RelationshipSnapshotRow) => ({
	properties: row.properties,
	id: RelationshipId.make(row.id),
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	sourceEntityId: EntityId.make(row.sourceEntityId),
	targetEntityId: EntityId.make(row.targetEntityId),
	relationshipSchemaSlug: RelationshipSchemaSlug.make(row.relationshipSchemaSlug),
	relationshipSchemaPluginId:
		row.relationshipSchemaPluginId === null ? null : PluginId.make(row.relationshipSchemaPluginId),
});

const toSavedRelationship = (row: RelationshipRow) => ({
	...toRelationship(row),
	wasInserted: row.wasInserted,
});

const storedRelationshipKey = (row: RelationshipSnapshotRow & { readonly userId: null | string }) =>
	relationshipMutationLockKey({
		sourceEntityId: EntityId.make(row.sourceEntityId),
		targetEntityId: EntityId.make(row.targetEntityId),
		relationshipSchemaPluginId: row.relationshipSchemaPluginId,
		relationshipSchemaSlug: RelationshipSchemaSlug.make(row.relationshipSchemaSlug),
		...(row.userId === null
			? { scope: "global" as const }
			: { scope: "user" as const, userId: UserId.make(row.userId) }),
	});

const relationshipValues = (input: CreateRelationshipInput) => ({
	properties: input.properties,
	sourceEntityId: input.sourceEntityId,
	targetEntityId: input.targetEntityId,
	userId: input.scope === "user" ? input.userId : null,
	relationshipSchemaSlug: input.relationshipSchemaSlug,
	relationshipSchemaPluginId: input.relationshipSchemaPluginId ?? null,
});

const relationshipSchemaPluginWhere = (pluginId: null | string) =>
	pluginIdWhere(schema.relationship.relationshipSchemaPluginId, pluginId);

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

const relationshipConflictTarget = {
	target: [
		schema.relationship.userId,
		schema.relationship.sourceEntityId,
		schema.relationship.targetEntityId,
		schema.relationship.relationshipSchemaSlug,
		schema.relationship.relationshipSchemaPluginId,
	],
};

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
					schema.relationship[`${relationshipEnds(input.direction).anchor}EntityId`],
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

export type RelationshipSyncGroupKey = {
	anchorEntityId: EntityId;
	direction: "incoming" | "outgoing";
	relationshipSchemaPluginId: null | string;
	relationshipSchemaSlug: RelationshipSchemaSlug;
};

const relationshipSyncGroupLockKey = (key: RelationshipSyncGroupKey) =>
	JSON.stringify([
		"relationship-sync-generation",
		key.anchorEntityId,
		key.direction,
		key.relationshipSchemaSlug,
		key.relationshipSchemaPluginId ?? "kernel",
	]);

const relationshipSyncGroupWhere = (key: RelationshipSyncGroupKey) =>
	and(
		eq(schema.relationshipSyncGeneration.anchorEntityId, key.anchorEntityId),
		eq(schema.relationshipSyncGeneration.direction, key.direction),
		eq(schema.relationshipSyncGeneration.relationshipSchemaSlug, key.relationshipSchemaSlug),
		pluginIdWhere(
			schema.relationshipSyncGeneration.relationshipSchemaPluginId,
			key.relationshipSchemaPluginId,
		),
	);

export class RelationshipsRepository extends Context.Service<RelationshipsRepository>()(
	"RelationshipsRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const findRelationship = Effect.fn("RelationshipsRepository.findRelationship")(function* (
				input: RelationshipIdentityInput,
			) {
				const [row] = yield* session.run((db) =>
					db
						.select(relationshipSnapshotSelection)
						.from(schema.relationship)
						.where(relationshipIdentityWhere(input))
						.limit(1)
						.for("update"),
				);
				return row ? toRelationship(row) : null;
			});
			const findRelationships = Effect.fn("RelationshipsRepository.findRelationships")(function* (
				inputs: ReadonlyArray<RelationshipIdentityInput>,
			) {
				const rows = yield* Effect.forEach(chunksOf(inputs, STATEMENT_CHUNK_SIZE), (chunk) =>
					session.run((db) =>
						db
							.select(ownedRelationshipSelection)
							.from(schema.relationship)
							.where(or(...chunk.map(relationshipIdentityWhere)))
							.orderBy(asc(schema.relationship.id))
							.for("update"),
					),
				);
				return new Map(rows.flat().map((row) => [storedRelationshipKey(row), toRelationship(row)]));
			});
			const findUserRelationshipById = Effect.fn(
				"RelationshipsRepository.findUserRelationshipById",
			)(function* (userId: UserId, relationshipId: RelationshipId) {
				const [row] = yield* session.run((db) =>
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
				return row ? toRelationship(row) : null;
			});
			const lockRelationshipMutations = Effect.fn(
				"RelationshipsRepository.lockRelationshipMutations",
			)(function* (inputs: ReadonlyArray<RelationshipIdentityInput>) {
				yield* lockSortedAdvisoryKeys(
					session,
					inputs.map(relationshipMutationLockKey),
					sql`hashtextextended(k, 0)`,
				);
			});
			const listUserRelationshipsForBackup = Effect.fn(
				"RelationshipsRepository.listUserRelationshipsForBackup",
			)(function* (userId: UserId) {
				return yield* session.run((db) =>
					db
						.select(relationshipSnapshotWithProvenanceSelection)
						.from(schema.relationship)
						.where(eq(schema.relationship.userId, userId))
						.orderBy(asc(schema.relationship.id)),
				);
			});

			const findRelationshipProperties = Effect.fn(
				"RelationshipsRepository.findRelationshipProperties",
			)(function* (input: {
				userId: UserId;
				sourceEntityId: EntityId;
				targetEntityId: EntityId;
				relationshipSchemaPluginId: null | string;
				relationshipSchemaSlug: RelationshipSchemaSlug;
			}) {
				const [row] = yield* session.run((db) =>
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
				const [inserted] = yield* session.run((db) =>
					db
						.insert(schema.relationship)
						.values(relationshipValues(input))
						.onConflictDoNothing(relationshipConflictTarget)
						.returning(relationshipSelection),
				);

				if (inserted) {
					return toSavedRelationship(inserted);
				}

				const [existing] = yield* session.run((db) =>
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

			const createRelationships = Effect.fn("RelationshipsRepository.createRelationships")(
				function* (inputs: ReadonlyArray<CreateRelationshipInput>) {
					const inserted = yield* Effect.forEach(chunksOf(inputs, STATEMENT_CHUNK_SIZE), (chunk) =>
						session.run((db) =>
							db
								.insert(schema.relationship)
								.values(chunk.map(relationshipValues))
								.onConflictDoNothing(relationshipConflictTarget)
								.returning({ ...relationshipSelection, userId: schema.relationship.userId }),
						),
					);
					const saved = new Map(
						inserted.flat().map((row) => [storedRelationshipKey(row), toSavedRelationship(row)]),
					);
					const conflicted = inputs.filter(
						(input) => !saved.has(relationshipMutationLockKey(input)),
					);
					const existing = yield* findRelationships(conflicted);
					for (const input of conflicted) {
						const key = relationshipMutationLockKey(input);
						const row = existing.get(key);
						if (!row) {
							return yield* new DbError({ message: "Relationship insert conflict but not found" });
						}
						saved.set(key, { ...row, wasInserted: false });
					}
					return saved;
				},
			);

			const updateRelationshipsById = Effect.fn("RelationshipsRepository.updateRelationshipsById")(
				function* (
					updates: ReadonlyArray<{ id: RelationshipId; properties: Record<string, unknown> }>,
				) {
					const rows = yield* Effect.forEach(chunksOf(updates, STATEMENT_CHUNK_SIZE), (chunk) =>
						session.run((db) =>
							db
								.update(schema.relationship)
								.set({
									properties: sql`(case ${schema.relationship.id} ${sql.join(
										chunk.map(
											({ id, properties }) =>
												sql`when ${id} then ${JSON.stringify(properties)}::jsonb`,
										),
										sql` `,
									)} end)`,
								})
								.where(
									inArray(
										schema.relationship.id,
										chunk.map(({ id }) => id),
									),
								)
								.returning(relationshipSnapshotSelection),
						),
					);
					return new Map(
						rows
							.flat()
							.map((row) => [
								RelationshipId.make(row.id),
								toSavedRelationship({ ...row, wasInserted: false }),
							]),
					);
				},
			);

			const deleteRelationshipsById = Effect.fn("RelationshipsRepository.deleteRelationshipsById")(
				function* (ids: ReadonlyArray<RelationshipId>) {
					const rows = yield* Effect.forEach(chunksOf(ids, STATEMENT_CHUNK_SIZE), (chunk) =>
						session.run((db) =>
							db
								.delete(schema.relationship)
								.where(inArray(schema.relationship.id, chunk))
								.returning(relationshipSnapshotSelection),
						),
					);
					return new Map(
						rows.flat().map((row) => [RelationshipId.make(row.id), toRelationship(row)]),
					);
				},
			);

			const updatePreparedRelationship = Effect.fn(
				"RelationshipsRepository.updatePreparedRelationship",
			)(function* (input: UpdateRelationshipInput & { before: ReturnType<typeof toRelationship> }) {
				const [row] = yield* session.run((db) =>
					db
						.update(schema.relationship)
						.set({ properties: input.properties })
						.where(and(relationshipIdentityWhere(input), preparedRelationshipWhere(input.before)))
						.returning(relationshipSnapshotSelection),
				);

				return row ? toSavedRelationship({ ...row, wasInserted: false }) : null;
			});

			const deletePreparedRelationship = Effect.fn(
				"RelationshipsRepository.deletePreparedRelationship",
			)(function* (
				input: RelationshipIdentityInput & { before: ReturnType<typeof toRelationship> },
			) {
				const [row] = yield* session.run((db) =>
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
				const [row] = yield* session.run((db) =>
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
				const rows = yield* session.run((db) =>
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
			const listUserEditorRelationships = Effect.fn(
				"RelationshipsRepository.listUserEditorRelationships",
			)(function* (input: {
				lock: boolean;
				userId: UserId;
				entityId: EntityId;
				pluginId: null | string;
				outgoingSlugs: ReadonlyArray<RelationshipSchemaSlug>;
				incomingSlugs: ReadonlyArray<RelationshipSchemaSlug>;
			}) {
				const ends = [
					...(input.outgoingSlugs.length === 0
						? []
						: [
								and(
									eq(schema.relationship.sourceEntityId, input.entityId),
									inArray(schema.relationship.relationshipSchemaSlug, [...input.outgoingSlugs]),
								),
							]),
					...(input.incomingSlugs.length === 0
						? []
						: [
								and(
									eq(schema.relationship.targetEntityId, input.entityId),
									inArray(schema.relationship.relationshipSchemaSlug, [...input.incomingSlugs]),
								),
							]),
				];
				if (ends.length === 0) {
					return [];
				}
				const rows = yield* session.run((db) => {
					const query = db
						.select(relationshipSnapshotSelection)
						.from(schema.relationship)
						.where(
							and(
								eq(schema.relationship.userId, input.userId),
								relationshipSchemaPluginWhere(input.pluginId),
								or(...ends),
							),
						)
						.orderBy(
							asc(schema.relationship.relationshipSchemaSlug),
							asc(schema.relationship.sourceEntityId),
							asc(schema.relationship.targetEntityId),
						);
					return input.lock ? query.for("update") : query;
				});
				return rows.map(toRelationship);
			});
			const listUserRelationshipsForEntitiesWithProvenance = Effect.fn(
				"RelationshipsRepository.listUserRelationshipsForEntitiesWithProvenance",
			)(function* (input: { userId: UserId; entityIds: ReadonlyArray<EntityId> }) {
				const rows = yield* Effect.forEach(
					chunksOf(input.entityIds, STATEMENT_CHUNK_SIZE),
					(entityIds) =>
						session.run((db) =>
							db
								.select(relationshipSnapshotWithProvenanceSelection)
								.from(schema.relationship)
								.where(
									and(
										eq(schema.relationship.userId, input.userId),
										or(
											inArray(schema.relationship.sourceEntityId, entityIds),
											inArray(schema.relationship.targetEntityId, entityIds),
										),
									),
								)
								.orderBy(asc(schema.relationship.id))
								.for("update"),
						),
				);
				const byId = new Map(rows.flat().map((row) => [row.id, row]));
				return [...byId.values()]
					.sort((left, right) => left.id.localeCompare(right.id))
					.map(toRelationship);
			});

			const listEnabledOwnersForSubject = Effect.fn(
				"RelationshipsRepository.listEnabledOwnersForSubject",
			)(function* (input: {
				subjectEntityId: EntityId;
				subjectSide: "source" | "target";
				relationshipSchemaPluginId: null | string;
				relationshipSchemaSlug: RelationshipSchemaSlug;
			}) {
				const rows = yield* session.run((db) =>
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
				yield* session.run((db) =>
					db.execute(
						sql`select pg_advisory_xact_lock(hashtextextended(${relationshipReconciliationLockKey(input)}, 0))`,
					),
				);
				const rows = yield* session.run((db) =>
					db
						.select(relationshipSnapshotSelection)
						.from(schema.relationship)
						.where(relationshipReconciliationWhere(input))
						.orderBy(asc(schema.relationship.id))
						.for("update"),
				);

				return rows.map(toRelationship);
			});
			const listRelationshipsOutsideGeneration = Effect.fn(
				"RelationshipsRepository.listRelationshipsOutsideGeneration",
			)(function* (input: RelationshipReconciliationListInput, generation: string) {
				yield* session.run((db) =>
					db.execute(
						sql`select pg_advisory_xact_lock(hashtextextended(${relationshipReconciliationLockKey(input)}, 0))`,
					),
				);
				const rows = yield* session.run((db) =>
					db
						.select(relationshipSnapshotSelection)
						.from(schema.relationship)
						.where(
							and(
								relationshipReconciliationWhere(input),
								sql`${schema.relationship.syncGeneration} is distinct from ${generation}`,
							),
						)
						.orderBy(asc(schema.relationship.id))
						.for("update"),
				);
				return rows.map(toRelationship);
			});
			const stampRelationshipGeneration = Effect.fn(
				"RelationshipsRepository.stampRelationshipGeneration",
			)(function* (inputs: ReadonlyArray<RelationshipIdentityInput>, generation: string) {
				yield* Effect.forEach(chunksOf(inputs, STATEMENT_CHUNK_SIZE), (chunk) =>
					session.run((db) =>
						db
							.update(schema.relationship)
							.set({ syncGeneration: generation, updatedAt: schema.relationship.updatedAt })
							.where(
								and(
									or(...chunk.map(relationshipIdentityWhere)),
									sql`${schema.relationship.syncGeneration} is distinct from ${generation}`,
								),
							),
					),
				);
			});
			const claimRelationshipSyncGeneration = Effect.fn(
				"RelationshipsRepository.claimRelationshipSyncGeneration",
			)(function* (key: RelationshipSyncGroupKey, generation: string, startedAt: Date) {
				yield* session.run((db) =>
					db.execute(
						sql`select pg_advisory_xact_lock(hashtextextended(${relationshipSyncGroupLockKey(key)}, 0))`,
					),
				);
				yield* session.run((db) =>
					db
						.insert(schema.relationshipSyncGeneration)
						.values({ ...key, startedAt, generation })
						.onConflictDoUpdate({
							set: { startedAt, generation },
							target: [
								schema.relationshipSyncGeneration.anchorEntityId,
								schema.relationshipSyncGeneration.relationshipSchemaSlug,
								schema.relationshipSyncGeneration.relationshipSchemaPluginId,
								schema.relationshipSyncGeneration.direction,
							],
						}),
				);
			});
			const holdsRelationshipSyncGeneration = Effect.fn(
				"RelationshipsRepository.holdsRelationshipSyncGeneration",
			)(function* (key: RelationshipSyncGroupKey, generation: string) {
				yield* session.run((db) =>
					db.execute(
						sql`select pg_advisory_xact_lock(hashtextextended(${relationshipSyncGroupLockKey(key)}, 0))`,
					),
				);
				const [row] = yield* session.run((db) =>
					db
						.select({ generation: schema.relationshipSyncGeneration.generation })
						.from(schema.relationshipSyncGeneration)
						.where(relationshipSyncGroupWhere(key))
						.limit(1),
				);
				return row?.generation === generation;
			});
			const listGlobalRelationships = (input: GlobalRelationshipListInput) =>
				listRelationshipsForReconciliation({ ...input, scope: "global" });

			return {
				findRelationship,
				findRelationships,
				createRelationship,
				createRelationships,
				updateRelationshipsById,
				deleteRelationshipsById,
				listGlobalRelationships,
				findUserRelationshipById,
				lockRelationshipMutations,
				updatePreparedRelationship,
				deletePreparedRelationship,
				deleteUserRelationshipById,
				findRelationshipProperties,
				listEnabledOwnersForSubject,
				stampRelationshipGeneration,
				listUserEditorRelationships,
				listUserRelationshipsForEntity,
				listUserRelationshipsForBackup,
				holdsRelationshipSyncGeneration,
				claimRelationshipSyncGeneration,
				listRelationshipsForReconciliation,
				listRelationshipsOutsideGeneration,
				listUserRelationshipsForEntitiesWithProvenance,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
