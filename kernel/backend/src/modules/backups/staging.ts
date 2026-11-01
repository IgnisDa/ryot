import { DbError } from "@ryot-app/contract/errors";
import type { BackupRunId } from "@ryot-app/contract/schema/brands";
import { and, eq, exists, inArray, lte, or, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { archiveError } from "#modules/backups/archive/error";
import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/backups";

export const BACKUP_STAGE_BATCH_SIZE = 256;
export const BACKUP_STAGE_PAGE_BYTES = 8 * 1024 * 1024;

type BackupStagingReferenceInput = Omit<typeof schema.backupStagingReference.$inferInsert, "runId">;

const mappingSchema = Schema.Struct({
	id: Schema.String,
	destinationId: Schema.String,
	inserted: Schema.optionalKey(Schema.Boolean),
});

const encodeMappings = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(mappingSchema)));

const addRetention = (date: Date) => new Date(date.getTime() + 24 * 60 * 60 * 1000);

export class BackupStaging extends Context.Service<BackupStaging>()(
	"@ryot-app/kernel-backend/modules/backups/staging/BackupStaging",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const refreshExpiry = Effect.fn("BackupStaging.refreshExpiry")(function* (
				runId: BackupRunId,
			) {
				const now = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db
						.update(schema.backupStagingRun)
						.set({ expiresAt: addRetention(now) })
						.where(eq(schema.backupStagingRun.id, runId)),
				);
			});

			const begin = Effect.fn("BackupStaging.begin")(function* (runId: BackupRunId) {
				const now = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db.delete(schema.backupStagingRun).where(eq(schema.backupStagingRun.id, runId)),
				);
				yield* session.run((db) =>
					db
						.insert(schema.backupStagingRun)
						.values({ id: runId, backupRunId: runId, expiresAt: addRetention(now) }),
				);
			});

			const cleanup = Effect.fn("BackupStaging.cleanup")(function* (runId: BackupRunId) {
				yield* session.run((db) =>
					db.delete(schema.backupStagingRun).where(eq(schema.backupStagingRun.id, runId)),
				);
			});

			const recoverAbandoned = Effect.fn("BackupStaging.recoverAbandoned")(function* () {
				const now = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db.delete(schema.backupStagingRun).where(
						or(
							lte(schema.backupStagingRun.expiresAt, now),
							exists(
								db
									.select({ id: schema.backupRun.id })
									.from(schema.backupRun)
									.where(
										and(
											eq(schema.backupRun.id, schema.backupStagingRun.backupRunId),
											inArray(schema.backupRun.status, ["completed", "failed"]),
										),
									),
							),
						),
					),
				);
			});

			const putRecords = Effect.fn("BackupStaging.putRecords")(function* (
				runId: BackupRunId,
				namespace: string,
				section: string,
				records: ReadonlyArray<{ readonly id: string; readonly value: unknown }>,
			) {
				yield* refreshExpiry(runId);
				for (let offset = 0; offset < records.length; offset += BACKUP_STAGE_BATCH_SIZE) {
					const batch = records.slice(offset, offset + BACKUP_STAGE_BATCH_SIZE);
					yield* session
						.run((db) =>
							db
								.insert(schema.backupStagingRecord)
								.values(
									batch.map(({ id, value }) => ({
										id,
										runId,
										value,
										section,
										namespace,
										inserted: false,
										destinationId: null,
									})),
								),
						)
						.pipe(
							Effect.catchIf(
								(error) => error instanceof DbError && error.code === "23505",
								() =>
									archiveError(
										"duplicate_record_id",
										`Duplicate record id in backup section '${section}'`,
										section,
									),
							),
						);
				}
			});

			const addReferences = Effect.fn("BackupStaging.addReferences")(function* (
				runId: BackupRunId,
				references: ReadonlyArray<BackupStagingReferenceInput>,
			) {
				yield* refreshExpiry(runId);
				for (let offset = 0; offset < references.length; offset += BACKUP_STAGE_BATCH_SIZE) {
					const batch = references.slice(offset, offset + BACKUP_STAGE_BATCH_SIZE);
					yield* session.run((db) =>
						db
							.insert(schema.backupStagingReference)
							.values(
								batch.map((reference) => ({
									runId,
									sourceId: reference.sourceId,
									targetId: reference.targetId,
									sourceNamespace: reference.sourceNamespace,
									targetNamespace: reference.targetNamespace,
								})),
							)
							.onConflictDoNothing(),
					);
				}
			});

			const validateReferences = Effect.fn("BackupStaging.validateReferences")(function* (
				runId: BackupRunId,
			) {
				const [row] = yield* session.run((db) =>
					db
						.select({
							hasMissing: sql<boolean>`exists (
							select 1
							from ${schema.backupStagingReference} as reference
							left join ${schema.backupStagingRecord} as target
								on target.run_id = reference.run_id
								and target.namespace = reference.target_namespace
								and target.id = reference.target_id
							where reference.run_id = ${runId}
								and target.id is null
						)`,
						})
						.from(schema.backupStagingRun)
						.where(eq(schema.backupStagingRun.id, runId)),
				);
				if (row?.hasMissing) {
					return yield* archiveError(
						"missing_reference_mapping",
						"Backup contains a reference without a staged target mapping",
					);
				}
				return yield* Effect.void;
			});

			const listRecords = Effect.fn("BackupStaging.listRecords")(function* (
				runId: BackupRunId,
				section: string,
				afterId?: string,
				limit: number = BACKUP_STAGE_BATCH_SIZE,
			) {
				yield* refreshExpiry(runId);
				const boundedLimit = Number.isFinite(limit)
					? Math.max(0, Math.min(BACKUP_STAGE_BATCH_SIZE, Math.trunc(limit)))
					: BACKUP_STAGE_BATCH_SIZE;
				return yield* session.run((db) =>
					db.execute<typeof schema.backupStagingRecord.$inferSelect>(
						sql`
							with candidates as (
								select staging.*
								from ${schema.backupStagingRecord} as staging
								where staging.run_id = ${runId}
									and staging.section = ${section}
									${afterId === undefined ? sql`` : sql`and staging.id > ${afterId}`}
								order by staging.id
								limit ${boundedLimit}
							),
							page as (
								select
									candidates.*,
									sum(octet_length(candidates.value::text)) over (
										order by candidates.id rows between unbounded preceding and current row
									) as running_bytes,
									row_number() over (order by candidates.id) as page_row_number
								from candidates
							)
							select
								page.run_id as "runId",
								page.namespace as namespace,
								page.id as id,
								page.section as section,
								page.value as value,
								page.destination_id as "destinationId",
								page.inserted as inserted
							from page
							where page.running_bytes <= ${BACKUP_STAGE_PAGE_BYTES}
								or page.page_row_number = 1
							order by page.id
						`,
						"objects",
					),
				);
			});

			const getRecords = Effect.fn("BackupStaging.getRecords")(function* (
				runId: BackupRunId,
				namespace: string,
				ids: ReadonlyArray<string>,
			) {
				if (ids.length === 0) {
					return [];
				}
				return yield* session.run((db) =>
					db
						.select()
						.from(schema.backupStagingRecord)
						.where(
							and(
								eq(schema.backupStagingRecord.runId, runId),
								eq(schema.backupStagingRecord.namespace, namespace),
								inArray(schema.backupStagingRecord.id, [...ids]),
							),
						),
				);
			});

			const setMappings = Effect.fn("BackupStaging.setMappings")(function* (
				runId: BackupRunId,
				namespace: string,
				mappings: ReadonlyArray<{
					readonly id: string;
					readonly inserted?: boolean;
					readonly destinationId: string;
				}>,
			) {
				yield* refreshExpiry(runId);
				for (let offset = 0; offset < mappings.length; offset += BACKUP_STAGE_BATCH_SIZE) {
					const batch = mappings.slice(offset, offset + BACKUP_STAGE_BATCH_SIZE);
					const encoded = yield* encodeMappings(batch).pipe(Effect.orDie);
					yield* session.run((db) =>
						db.execute(sql`
							update ${schema.backupStagingRecord} as staging
							set destination_id = mappings."destinationId",
								inserted = coalesce(mappings.inserted, staging.inserted)
							from jsonb_to_recordset(${encoded}::jsonb) as mappings(
								id text,
								"destinationId" text,
								inserted boolean
							)
							where staging.run_id = ${runId}
								and staging.namespace = ${namespace}
								and staging.id = mappings.id
						`),
					);
				}
			});

			const resolveMappings = Effect.fn("BackupStaging.resolveMappings")(function* (
				runId: BackupRunId,
				namespace: string,
				ids: ReadonlyArray<string>,
			) {
				const mappings = new Map<string, string>();
				for (let offset = 0; offset < ids.length; offset += BACKUP_STAGE_BATCH_SIZE) {
					const batch = ids.slice(offset, offset + BACKUP_STAGE_BATCH_SIZE);
					const records = yield* session.run((db) =>
						db
							.select({
								id: schema.backupStagingRecord.id,
								destinationId: schema.backupStagingRecord.destinationId,
							})
							.from(schema.backupStagingRecord)
							.where(
								and(
									eq(schema.backupStagingRecord.runId, runId),
									eq(schema.backupStagingRecord.namespace, namespace),
									inArray(schema.backupStagingRecord.id, batch),
								),
							),
					);
					for (const record of records) {
						if (record.destinationId !== null) {
							mappings.set(record.id, record.destinationId);
						}
					}
				}
				return mappings;
			});
			const getEntityIdentities = Effect.fn("BackupStaging.getEntityIdentities")(function* (
				runId: BackupRunId,
				ids: ReadonlyArray<string>,
			) {
				const readBatch = (batch: ReadonlyArray<string>) =>
					session.run((db) =>
						db
							.select({
								id: schema.backupStagingRecord.id,
								inserted: schema.backupStagingRecord.inserted,
								destinationId: schema.backupStagingRecord.destinationId,
								entitySchemaSlug: sql<string>`${schema.backupStagingRecord.value}->>'entitySchemaSlug'`,
								entitySchemaPluginKey: sql<
									null | string
								>`${schema.backupStagingRecord.value}->>'entitySchemaPluginKey'`,
							})
							.from(schema.backupStagingRecord)
							.where(
								and(
									eq(schema.backupStagingRecord.runId, runId),
									eq(schema.backupStagingRecord.namespace, "entity"),
									inArray(schema.backupStagingRecord.id, [...batch]),
								),
							),
					);
				const rows: Effect.Success<ReturnType<typeof readBatch>> = [];
				for (let offset = 0; offset < ids.length; offset += BACKUP_STAGE_BATCH_SIZE) {
					rows.push(...(yield* readBatch(ids.slice(offset, offset + BACKUP_STAGE_BATCH_SIZE))));
				}
				return rows;
			});

			return {
				begin,
				cleanup,
				putRecords,
				getRecords,
				listRecords,
				setMappings,
				addReferences,
				resolveMappings,
				recoverAbandoned,
				validateReferences,
				getEntityIdentities,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
