import { DbError } from "@ryot-app/contract/errors";
import type { PluginProjection } from "@ryot-app/contract/modules/plugins/manifest";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";

import {
	type ProjectionBindingRecord,
	sameProjectionBinding,
} from "#modules/scripts/executions/projection-bindings";
import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

export type RelationshipProjectionKey = {
	readonly userId: string;
	readonly relationshipSchemaSlug: string;
	readonly relationshipSchemaPluginId: string;
};

export const relationshipProjectionWorkId = (key: RelationshipProjectionKey) =>
	sha256Hex(
		stableStringify([key.userId, key.relationshipSchemaPluginId, key.relationshipSchemaSlug]),
	);

const relationshipsOf = (
	key: RelationshipProjectionKey,
) => sql`select r.id, ${relationshipProjectionWorkId(key)} from ${schema.relationship} r
	where r.user_id = ${key.userId} and r.relationship_schema_plugin_id = ${key.relationshipSchemaPluginId}
	and r.relationship_schema_slug = ${key.relationshipSchemaSlug}`;

const dirty = sql`${schema.relationshipProjection.projectedRevision} is distinct from ${schema.relationshipProjection.revision}`;

const currentSelection = {
	status: schema.backgroundWork.status,
	id: schema.relationshipProjectionWork.id,
	step: schema.relationshipProjectionWork.step,
	userId: schema.relationshipProjectionWork.userId,
	pluginPin: schema.relationshipProjectionWork.pluginPin,
	updatedAt: schema.relationshipProjectionWork.updatedAt,
	currentJobId: schema.relationshipProjectionWork.currentJobId,
	accountToken: schema.relationshipProjectionWork.accountToken,
	outputSchema: schema.relationshipProjectionWork.outputSchema,
	pluginRevisionId: schema.relationshipProjectionWork.pluginRevisionId,
	processorScriptId: schema.relationshipProjectionWork.processorScriptId,
	relationshipSchemaSlug: schema.relationshipProjectionWork.relationshipSchemaSlug,
	relationshipSchemaPluginId: schema.relationshipProjectionWork.relationshipSchemaPluginId,
};

export class RelationshipProjectionRepository extends Context.Service<RelationshipProjectionRepository>()(
	"@ryot-app/kernel-backend/modules/relationships/projections/repository/RelationshipProjectionRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const requireTransaction = session.requireTransaction.pipe(
				Effect.mapError(
					() =>
						new DbError({
							message: "Relationship projection writes require an active transaction",
						}),
				),
			);

			const readState = (id: string) =>
				session
					.run((db) =>
						db
							.select(currentSelection)
							.from(schema.relationshipProjectionWork)
							.leftJoin(
								schema.backgroundWork,
								eq(schema.backgroundWork.id, schema.relationshipProjectionWork.currentJobId),
							)
							.where(eq(schema.relationshipProjectionWork.id, id))
							.limit(1),
					)
					.pipe(Effect.map((rows) => rows[0] ?? null));

			const lockWork = (id: string) =>
				session
					.run((db) =>
						db
							.select({ currentJobId: schema.relationshipProjectionWork.currentJobId })
							.from(schema.relationshipProjectionWork)
							.where(eq(schema.relationshipProjectionWork.id, id))
							.for("update"),
					)
					.pipe(Effect.map((rows) => rows[0] ?? null));

			const bind = Effect.fn("RelationshipProjectionRepository.bind")(function* (
				key: RelationshipProjectionKey,
				binding: ProjectionBindingRecord,
			) {
				yield* requireTransaction;
				const id = relationshipProjectionWorkId(key);
				yield* session.run((db) =>
					db
						.insert(schema.relationshipProjectionWork)
						.values({ id, ...key, ...binding })
						.onConflictDoNothing(),
				);
				yield* lockWork(id);
				const work = yield* readState(id);
				if (!work) {
					return yield* new DbError({
						message: "Relationship projection work insert returned no row",
					});
				}
				const now = yield* DateTime.nowAsDate;
				const changed = !sameProjectionBinding(work, binding);
				yield* session.run((db) =>
					db
						.update(schema.relationshipProjectionWork)
						.set({ ...binding, updatedAt: now, ...(changed ? { currentJobId: null } : {}) })
						.where(eq(schema.relationshipProjectionWork.id, id)),
				);
				if (changed) {
					yield* session.run((db) =>
						db
							.update(schema.relationshipProjection)
							.set({ revision: sql`${schema.relationshipProjection.revision} + 1` })
							.where(eq(schema.relationshipProjection.workId, id)),
					);
				}
				return id;
			});

			const mark = Effect.fn("RelationshipProjectionRepository.mark")(function* (
				key: RelationshipProjectionKey,
				sourceEntityIds: ReadonlyArray<string>,
			) {
				yield* requireTransaction;
				const rows = yield* session.run((db) =>
					db.execute<{ relationshipId: string }>(
						sql`insert into ${schema.relationshipProjection} (relationship_id, work_id)
							${relationshipsOf(key)} and r.source_entity_id in (${sql.join(
								sourceEntityIds.map((entityId) => sql`${entityId}`),
								sql`, `,
							)})
							order by r.id
							on conflict (relationship_id) do update set work_id = excluded.work_id,
								revision = ${schema.relationshipProjection}.revision + 1
							returning relationship_id as "relationshipId"`,
						"objects",
					),
				);
				return rows.length;
			});

			const fill = Effect.fn("RelationshipProjectionRepository.fill")(function* (
				key: RelationshipProjectionKey,
			) {
				yield* requireTransaction;
				yield* session.run((db) =>
					db.execute(
						sql`insert into ${schema.relationshipProjection} (relationship_id, work_id)
							${relationshipsOf(key)} order by r.id
							on conflict (relationship_id) do nothing`,
					),
				);
				return relationshipProjectionWorkId(key);
			});

			const prepare = Effect.fn("RelationshipProjectionRepository.prepare")(function* (id: string) {
				yield* requireTransaction;
				if (!(yield* lockWork(id))) {
					return null;
				}
				return yield* readState(id);
			});

			const claimable = Effect.fn("RelationshipProjectionRepository.claimable")(function* (
				id: string,
				limit: number,
			) {
				return yield* session.run((db) =>
					db
						.select({
							revision: schema.relationshipProjection.revision,
							sourceEntityId: schema.relationship.sourceEntityId,
							targetEntityId: schema.relationship.targetEntityId,
							relationshipId: schema.relationshipProjection.relationshipId,
						})
						.from(schema.relationshipProjection)
						.innerJoin(
							schema.relationship,
							eq(schema.relationship.id, schema.relationshipProjection.relationshipId),
						)
						.where(and(eq(schema.relationshipProjection.workId, id), dirty))
						.orderBy(asc(schema.relationshipProjection.relationshipId))
						.limit(limit),
				);
			});

			const reserve = Effect.fn("RelationshipProjectionRepository.reserve")(function* (
				id: string,
				jobId: string,
			) {
				yield* requireTransaction;
				yield* session.run((db) =>
					db
						.update(schema.relationshipProjectionWork)
						.set({ currentJobId: jobId, step: sql`${schema.relationshipProjectionWork.step} + 1` })
						.where(eq(schema.relationshipProjectionWork.id, id)),
				);
			});

			const currentClaim = Effect.fn("RelationshipProjectionRepository.currentClaim")(function* (
				id: string,
				jobId: string,
			) {
				yield* requireTransaction;
				const work = yield* lockWork(id);
				const [job] = yield* session.run((db) =>
					db
						.select({ status: schema.backgroundWork.status })
						.from(schema.backgroundWork)
						.where(eq(schema.backgroundWork.id, jobId))
						.for("update"),
				);
				return work?.currentJobId === jobId && job?.status === "running";
			});

			const publish = Effect.fn("RelationshipProjectionRepository.publish")(function* (
				id: string,
				updates: ReadonlyArray<{
					readonly revision: number;
					readonly relationshipId: string;
					readonly properties: Record<string, JsonValue>;
				}>,
			) {
				yield* requireTransaction;
				if (updates.length === 0) {
					return [];
				}
				const values = sql.join(
					updates.map(
						(update) =>
							sql`(${update.relationshipId}, ${update.revision}::integer, ${JSON.stringify(update.properties)}::jsonb)`,
					),
					sql`, `,
				);
				const rows = yield* session.run((db) =>
					db.execute<{ sourceEntityId: string }>(
						sql`update ${schema.relationshipProjection} p
							set properties = v.properties, projected_revision = v.revision, updated_at = now()
							from (values ${values}) as v(relationship_id, revision, properties), ${schema.relationship} r
							where p.relationship_id = v.relationship_id and p.work_id = ${id}
							and p.revision = v.revision and r.id = p.relationship_id
							returning r.source_entity_id as "sourceEntityId"`,
						"objects",
					),
				);
				return [...new Set(rows.map((row) => row.sourceEntityId))];
			});

			const release = Effect.fn("RelationshipProjectionRepository.release")(function* (
				id: string,
				jobId: string,
			) {
				yield* requireTransaction;
				const updatedAt = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db
						.update(schema.relationshipProjectionWork)
						.set({ updatedAt, currentJobId: null })
						.where(
							and(
								eq(schema.relationshipProjectionWork.id, id),
								eq(schema.relationshipProjectionWork.currentJobId, jobId),
							),
						),
				);
			});

			const listCandidates = Effect.fn("RelationshipProjectionRepository.listCandidates")(
				function* (limit: number, after?: string) {
					return yield* session.run((db) =>
						db
							.select({ id: schema.relationshipProjectionWork.id })
							.from(schema.relationshipProjectionWork)
							.where(
								and(
									after === undefined ? undefined : gt(schema.relationshipProjectionWork.id, after),
									isNull(schema.relationshipProjectionWork.currentJobId),
									sql`exists (select 1 from ${schema.relationshipProjection} where ${schema.relationshipProjection.workId} = ${schema.relationshipProjectionWork.id} and ${dirty})`,
								),
							)
							.orderBy(asc(schema.relationshipProjectionWork.id))
							.limit(limit),
					);
				},
			);

			const postponeCandidate = Effect.fn("RelationshipProjectionRepository.postponeCandidate")(
				function* (id: string) {
					const updatedAt = yield* DateTime.nowAsDate;
					yield* session.run((db) =>
						db
							.update(schema.relationshipProjectionWork)
							.set({ updatedAt })
							.where(
								and(
									eq(schema.relationshipProjectionWork.id, id),
									isNull(schema.relationshipProjectionWork.currentJobId),
								),
							),
					);
				},
			);

			const bindingCandidates = Effect.fn("RelationshipProjectionRepository.bindingCandidates")(
				function* (input: { limit: number; after?: RelationshipProjectionKey }) {
					const after = input.after;
					return yield* session.run((db) =>
						db.execute<RelationshipProjectionKey & { projection: PluginProjection }>(
							sql`select d.user_id as "userId", d.plugin_id as "relationshipSchemaPluginId",
								d.slug as "relationshipSchemaSlug", d.projection
								from ${schema.userRelationshipSchema} d
								inner join "user" u on u.id = d.user_id and u.disabled_at is null
								inner join ${schema.userPlugin} up on up.user_id = d.user_id and up.plugin_id = d.plugin_id
									and up.is_executable
								left join ${schema.relationshipProjectionWork} w on w.user_id = d.user_id
									and w.relationship_schema_plugin_id = d.plugin_id and w.relationship_schema_slug = d.slug
								where d.is_effective and d.projection is not null
								${after ? sql`and (d.user_id, d.plugin_id, d.slug) > (${after.userId}, ${after.relationshipSchemaPluginId}, ${after.relationshipSchemaSlug})` : sql``}
								and exists (select 1 from ${schema.relationship} r where r.user_id = d.user_id
									and r.relationship_schema_plugin_id = d.plugin_id and r.relationship_schema_slug = d.slug)
								and (w.id is null
									or w.account_token is distinct from u.account_generation
									or w.plugin_revision_id is distinct from up.active_revision_id
									or w.plugin_pin ->> 'configRevisionId' is distinct from up.config_revision_id
									or exists (select 1 from ${schema.relationship} r where r.user_id = d.user_id
										and r.relationship_schema_plugin_id = d.plugin_id and r.relationship_schema_slug = d.slug
										and not exists (select 1 from ${schema.relationshipProjection} p where p.relationship_id = r.id)))
								order by d.user_id, d.plugin_id, d.slug
								limit ${input.limit}`,
							"objects",
						),
					);
				},
			);

			const usersWithRelationships = Effect.fn(
				"RelationshipProjectionRepository.usersWithRelationships",
			)(function* (
				pluginId: string,
				relationshipSchemaSlug: string,
				sourceEntityIds: ReadonlyArray<string>,
			) {
				const rows = yield* session.run((db) =>
					db.execute<{ userId: string }>(
						sql`select distinct r.user_id as "userId" from ${schema.relationship} r
							where r.user_id is not null and r.relationship_schema_plugin_id = ${pluginId}
							and r.relationship_schema_slug = ${relationshipSchemaSlug}
							and r.source_entity_id in (${sql.join(
								sourceEntityIds.map((entityId) => sql`${entityId}`),
								sql`, `,
							)})
							order by 1`,
						"objects",
					),
				);
				return rows.map((row) => row.userId);
			});

			return {
				bind,
				mark,
				fill,
				prepare,
				publish,
				release,
				reserve,
				claimable,
				currentClaim,
				get: readState,
				listCandidates,
				bindingCandidates,
				postponeCandidate,
				usersWithRelationships,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
