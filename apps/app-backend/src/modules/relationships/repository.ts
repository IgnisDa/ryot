import type { RelationshipSnapshot } from "@ryot/contract/modules/automations/schemas";
import type { UserId } from "@ryot/contract/schema/brands";
import { EntityId, RelationshipId, RelationshipSchemaId } from "@ryot/contract/schema/brands";
import { stableStringify } from "@ryot/ts-utils/json";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Effect, Runtime } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

import {
	buildGlobalRelationshipSyncPlan,
	globalRelationshipConflictDoNothingTarget,
	globalRelationshipIdentity,
	relationshipConflictDoNothingTarget,
	relationshipIdentityWhere,
	relationshipSelection,
	toRelationship,
	toSavedRelationship,
	type RelationshipRow,
	type RelationshipSnapshotRow,
	type SaveRelationshipInput,
	type SaveRelationshipOutcome,
	type SyncGlobalRelationshipsInput,
} from "./repository-support";

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
				const runtime = yield* Effect.runtime();
				const values = {
					properties: input.properties,
					sourceEntityId: input.sourceEntityId,
					targetEntityId: input.targetEntityId,
					relationshipSchemaId: input.relationshipSchemaId,
					userId: input.scope === "user" ? input.userId : null,
				};

				return yield* dbEffect(() =>
					db.transaction((tx) =>
						Runtime.runPromise(runtime)(
							Effect.gen(function* () {
								const endpointIds = [...new Set([input.sourceEntityId, input.targetEntityId])];
								const endpointRows = yield* Effect.promise(() =>
									tx
										.select({
											id: schema.entity.id,
											name: schema.entity.name,
											entitySchemaSlug: schema.entitySchema.slug,
										})
										.from(schema.entity)
										.innerJoin(
											schema.entitySchema,
											eq(schema.entity.entitySchemaId, schema.entitySchema.id),
										)
										.where(inArray(schema.entity.id, endpointIds)),
								);
								const endpoints = new Map(endpointRows.map((row) => [row.id, row]));
								const [relationshipSchemaRow] = yield* Effect.promise(() =>
									tx
										.select({ slug: schema.relationshipSchema.slug })
										.from(schema.relationshipSchema)
										.where(eq(schema.relationshipSchema.id, input.relationshipSchemaId))
										.limit(1),
								);
								if (!relationshipSchemaRow) {
									throw new Error("Relationship schema not found during save");
								}

								const snapshot = (value: RelationshipSnapshotRow): RelationshipSnapshot => {
									const source = endpoints.get(value.sourceEntityId);
									const target = endpoints.get(value.targetEntityId);
									if (!source || !target) {
										throw new Error("Relationship endpoint not found during save");
									}
									return {
										id: RelationshipId.make(value.id),
										source: { ...source, id: EntityId.make(source.id) },
										target: { ...target, id: EntityId.make(target.id) },
										properties: value.properties,
										relationshipSchemaSlug: relationshipSchemaRow.slug,
										relationshipSchemaId: RelationshipSchemaId.make(value.relationshipSchemaId),
									};
								};

								const classifyExisting = (
									existing: RelationshipRow,
								): Effect.Effect<SaveRelationshipOutcome> =>
									Effect.gen(function* () {
										if (
											input.onConflict === "replaceProperties" &&
											stableStringify(existing.properties) !== stableStringify(values.properties)
										) {
											const [updated] = yield* Effect.promise(() =>
												tx
													.update(schema.relationship)
													.set({ properties: values.properties })
													.where(eq(schema.relationship.id, existing.id))
													.returning(relationshipSelection),
											);
											if (!updated) {
												throw new Error("Relationship update returned no row");
											}
											return {
												operation: "update",
												relationship: toSavedRelationship({ ...updated, wasInserted: false }),
												before: snapshot(existing),
												after: snapshot(updated),
											};
										}
										return {
											operation: "noop",
											relationship: toSavedRelationship({ ...existing, wasInserted: false }),
											before: snapshot(existing),
											after: snapshot(existing),
										};
									});

								const [locked] = yield* Effect.promise(() =>
									tx
										.select(relationshipSelection)
										.from(schema.relationship)
										.where(relationshipIdentityWhere(input))
										.limit(1)
										.for("update"),
								);
								if (locked) {
									return yield* classifyExisting(locked);
								}

								const [inserted] = yield* Effect.promise(() =>
									tx
										.insert(schema.relationship)
										.values(values)
										.onConflictDoNothing(relationshipConflictDoNothingTarget(input))
										.returning(relationshipSelection),
								);
								if (inserted) {
									const createOutcome: SaveRelationshipOutcome = {
										operation: "create",
										relationship: toSavedRelationship({ ...inserted, wasInserted: true }),
										after: snapshot(inserted),
									};
									return createOutcome;
								}

								const [concurrent] = yield* Effect.promise(() =>
									tx
										.select(relationshipSelection)
										.from(schema.relationship)
										.where(relationshipIdentityWhere(input))
										.limit(1),
								);
								if (!concurrent) {
									throw new Error("Relationship insert conflict but not found");
								}
								return yield* classifyExisting(concurrent);
							}),
						),
					),
				);
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
					const runtime = yield* Effect.runtime();
					const { relationshipValues, synchronizationLockKey, synchronizationWhere } =
						buildGlobalRelationshipSyncPlan(input);

					return yield* dbEffect(() =>
						db.transaction((tx) =>
							Runtime.runPromise(runtime)(
								Effect.gen(function* () {
									yield* Effect.promise(() =>
										tx.execute(
											sql`select pg_advisory_xact_lock(hashtextextended(${synchronizationLockKey}, 0))`,
										),
									);
									const existingRows = yield* Effect.promise(() =>
										tx
											.select(relationshipSelection)
											.from(schema.relationship)
											.where(synchronizationWhere)
											.for("update"),
									);
									const existingByIdentity = new Map(
										existingRows.map((row) => [globalRelationshipIdentity(row), row]),
									);
									const desiredIdentities = new Set(
										relationshipValues.map(globalRelationshipIdentity),
									);
									const mutations: Array<{
										after?: RelationshipSnapshotRow;
										before?: RelationshipSnapshotRow;
										operation: "create" | "update" | "delete" | "noop";
									}> = [];

									for (const values of relationshipValues) {
										const existing = existingByIdentity.get(globalRelationshipIdentity(values));
										if (!existing) {
											const [inserted] = yield* Effect.promise(() =>
												tx
													.insert(schema.relationship)
													.values(values)
													.onConflictDoNothing(globalRelationshipConflictDoNothingTarget)
													.returning(relationshipSelection),
											);
											if (inserted) {
												mutations.push({ operation: "create", after: inserted });
												continue;
											}
											const [concurrent] = yield* Effect.promise(() =>
												tx
													.select(relationshipSelection)
													.from(schema.relationship)
													.where(
														and(
															isNull(schema.relationship.userId),
															eq(schema.relationship.sourceEntityId, values.sourceEntityId),
															eq(schema.relationship.targetEntityId, values.targetEntityId),
															eq(
																schema.relationship.relationshipSchemaId,
																values.relationshipSchemaId,
															),
														),
													)
													.limit(1),
											);
											if (!concurrent) {
												throw new Error("Concurrent relationship insert conflict but not found");
											}
											existingRows.push(concurrent);
											existingByIdentity.set(globalRelationshipIdentity(concurrent), concurrent);
											if (
												input.onConflict === "replaceProperties" &&
												stableStringify(concurrent.properties) !==
													stableStringify(values.properties)
											) {
												const [updated] = yield* Effect.promise(() =>
													tx
														.update(schema.relationship)
														.set({ properties: values.properties })
														.where(eq(schema.relationship.id, concurrent.id))
														.returning(relationshipSelection),
												);
												if (!updated) {
													throw new Error("Concurrent relationship update returned no row");
												}
												mutations.push({ operation: "update", before: concurrent, after: updated });
												continue;
											}
											mutations.push({ operation: "noop", after: concurrent, before: concurrent });
											continue;
										}

										if (
											input.onConflict === "replaceProperties" &&
											stableStringify(existing.properties) !== stableStringify(values.properties)
										) {
											const [updated] = yield* Effect.promise(() =>
												tx
													.update(schema.relationship)
													.set({ properties: values.properties })
													.where(eq(schema.relationship.id, existing.id))
													.returning(relationshipSelection),
											);
											if (!updated) {
												throw new Error("Relationship update returned no row");
											}
											mutations.push({ operation: "update", before: existing, after: updated });
										} else {
											mutations.push({ operation: "noop", before: existing, after: existing });
										}
									}

									if (input.synchronization === "authoritative") {
										for (const existing of existingRows) {
											if (desiredIdentities.has(globalRelationshipIdentity(existing))) {
												continue;
											}
											yield* Effect.promise(() =>
												tx
													.delete(schema.relationship)
													.where(eq(schema.relationship.id, existing.id)),
											);
											mutations.push({ operation: "delete", before: existing });
										}
									}

									const endpointIds = [
										...new Set(
											mutations.flatMap((mutation) => {
												const row = mutation.after ?? mutation.before;
												return row ? [row.sourceEntityId, row.targetEntityId] : [];
											}),
										),
									];
									const endpointRows = yield* Effect.promise(() =>
										endpointIds.length === 0
											? Promise.resolve([])
											: tx
													.select({
														id: schema.entity.id,
														name: schema.entity.name,
														entitySchemaSlug: schema.entitySchema.slug,
													})
													.from(schema.entity)
													.innerJoin(
														schema.entitySchema,
														eq(schema.entity.entitySchemaId, schema.entitySchema.id),
													)
													.where(inArray(schema.entity.id, endpointIds)),
									);
									const endpoints = new Map(endpointRows.map((row) => [row.id, row]));
									const [relationshipSchema] = yield* Effect.promise(() =>
										tx
											.select({ slug: schema.relationshipSchema.slug })
											.from(schema.relationshipSchema)
											.where(eq(schema.relationshipSchema.id, input.relationshipSchemaId))
											.limit(1),
									);
									if (!relationshipSchema) {
										throw new Error("Relationship schema not found during synchronization");
									}
									return {
										beforeCount: existingRows.length,
										afterCount:
											existingRows.length +
											mutations.filter((m) => m.operation === "create").length -
											mutations.filter((m) => m.operation === "delete").length,
										mutations: mutations.map((mutation) => {
											const row = mutation.after ?? mutation.before;
											if (!row) {
												throw new Error("Relationship mutation has no snapshot");
											}
											const source = endpoints.get(row.sourceEntityId);
											const target = endpoints.get(row.targetEntityId);
											if (!source || !target) {
												throw new Error("Relationship endpoint not found during synchronization");
											}
											const snapshot = (value: RelationshipSnapshotRow) => ({
												id: RelationshipId.make(value.id),
												source: { ...source, id: EntityId.make(source.id) },
												target: { ...target, id: EntityId.make(target.id) },
												properties: value.properties,
												relationshipSchemaSlug: relationshipSchema.slug,
												relationshipSchemaId: RelationshipSchemaId.make(value.relationshipSchemaId),
											});
											return Object.assign(
												{ operation: mutation.operation },
												mutation.after ? { after: snapshot(mutation.after) } : {},
												mutation.before ? { before: snapshot(mutation.before) } : {},
											);
										}),
									};
								}),
							),
						),
					);
				},
			);

			return {
				saveRelationship,
				deleteUserRelationship,
				syncGlobalRelationships,
				findRelationshipProperties,
				deleteUserRelationshipsForEntity,
				moveUserRelationshipsBetweenEntities,
			};
		},
	},
) {}
