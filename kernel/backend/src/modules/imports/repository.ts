import { DbError } from "@ryot-app/contract/errors";
import { dataJsonSource } from "@ryot-app/contract/modules/imports/data-json";
import {
	IngestionActivity,
	IngestionBatch,
	IngestionCapture,
	IngestionIssue,
	IngestionOutcome,
	IngestionRun,
	IngestionBlockReason,
	IngestionPins,
	IngestionPlan,
	type IngestionScope,
	type IngestionSummary,
} from "@ryot-app/contract/modules/imports/ingestion";
import type {
	ImportRunFailureReason,
	ListedImportRun,
} from "@ryot-app/contract/modules/imports/schemas";
import type { ImportRunSource } from "@ryot-app/contract/modules/imports/types";
import type { IntegrationLot } from "@ryot-app/contract/modules/integrations/types";
import { ImportRunId, IntegrationId, type UserId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, asc, desc, eq, gt, lte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";

import { isUniqueConstraintError } from "#lib/infrastructure/db/errors";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";

import { PreparedIngestionRelease } from "./runtime/prepared-release";
import type { IngestionRecoveryCursor } from "./runtime/recovery-cursor";

type ImportRunRow = typeof schema.importRun.$inferSelect;

export type ImportRunExecutionKind = "source" | "integration";

const normalizeRun = (row: ImportRunRow): ListedImportRun => ({
	source: row.source,
	status: row.status,
	id: ImportRunId.make(row.id),
	inputSummary: row.inputSummary,
	failureReason: row.failureReason,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	startedAt: row.startedAt?.toISOString() ?? null,
	finishedAt: row.finishedAt?.toISOString() ?? null,
});

const owned = (scope: IngestionScope) =>
	and(
		eq(schema.importRun.id, scope.runId),
		eq(schema.importRun.userId, scope.userId),
		eq(schema.importRun.userId, scope.accountGeneration.userId),
		eq(schema.importRun.accountGeneration, scope.accountGeneration.token),
		sql`${schema.importRun.accountGeneration} = (select account_generation from "user" where id = ${scope.userId})`,
	);

const executableOwner = () => sql`
	(${schema.importRun.integrationId} is null or exists (select 1 from ${schema.integration} where ${schema.integration.id} = ${schema.importRun.integrationId} and not ${schema.integration.retiring}))
	and (${schema.importRun.pluginInstallationId} is null or exists (select 1 from ${schema.pluginInstallation} where ${schema.pluginInstallation.id} = ${schema.importRun.pluginInstallationId} and not ${schema.pluginInstallation.ingestionRetiring} and ${schema.pluginInstallation.uninstalledAt} is null))
`;

export class ImportsRepository extends Context.Service<ImportsRepository>()("ImportsRepository", {
	make: Effect.gen(function* () {
		const database = yield* DatabaseSession;
		const assertAdmissionOwner = Effect.fn("ImportsRepository.assertAdmissionOwner")(
			function* (input: {
				userId: UserId;
				integrationId: IntegrationId | null;
				pluginInstallationId: string | null;
			}) {
				yield* database.requireTransaction;
				yield* database.acquireUserWriteLock(input.userId);
				const integrationId = input.integrationId;
				const pluginInstallationId = input.pluginInstallationId;
				if (integrationId !== null) {
					const [owner] = yield* database.run((db) =>
						db
							.select({ id: schema.integration.id })
							.from(schema.integration)
							.where(
								and(
									eq(schema.integration.id, integrationId),
									eq(schema.integration.userId, input.userId),
									eq(schema.integration.retiring, false),
								),
							)
							.limit(1),
					);
					if (!owner) {
						return yield* new DbError({ message: "Integration ingestion owner has retired" });
					}
				}
				if (pluginInstallationId !== null) {
					const [owner] = yield* database.run((db) =>
						db
							.select({ id: schema.pluginInstallation.id })
							.from(schema.pluginInstallation)
							.where(
								and(
									eq(schema.pluginInstallation.id, pluginInstallationId),
									eq(schema.pluginInstallation.userId, input.userId),
									eq(schema.pluginInstallation.ingestionRetiring, false),
									isNull(schema.pluginInstallation.uninstalledAt),
								),
							)
							.limit(1),
					);
					if (!owner) {
						return yield* new DbError({ message: "Installation ingestion owner has retired" });
					}
				}
				return yield* Effect.void;
			},
		);
		const insertRun = Effect.fn("ImportsRepository.insertRun")(function* (input: {
			userId: UserId;
			source: ImportRunSource;
			pluginInstallationId: string | null;
			inputSummary: Record<string, unknown>;
			integrationId: IntegrationId | null;
			integrationLot: IntegrationLot | null;
		}) {
			yield* assertAdmissionOwner(input);
			const [row] = yield* database.run((db) =>
				db
					.insert(schema.importRun)
					.values({
						userId: input.userId,
						source: input.source,
						inputSummary: input.inputSummary,
						integrationId: input.integrationId,
						integrationLot: input.integrationLot,
						pluginInstallationId: input.pluginInstallationId,
						accountGeneration: sql`(select account_generation from "user" where id = ${input.userId})`,
					})
					.returning(),
			);
			if (!row) {
				return yield* new DbError({ message: "Import run insert returned no row" });
			}
			return normalizeRun(row);
		});

		const createManualRun = Effect.fn("ImportsRepository.createManualRun")(function* (input: {
			userId: UserId;
			source: ImportRunSource;
			pluginInstallationId: string | null;
			inputSummary: Record<string, unknown>;
		}) {
			return yield* insertRun({ ...input, integrationId: null, integrationLot: null });
		});

		const createIntegrationRun = Effect.fn("ImportsRepository.createIntegrationRun")(
			function* (input: {
				userId: UserId;
				source: ImportRunSource;
				integrationId: IntegrationId;
				integrationLot: IntegrationLot;
				pluginInstallationId: string | null;
				inputSummary: Record<string, unknown>;
			}) {
				return yield* insertRun(input);
			},
		);

		const createIntegrationRunIfIdle = Effect.fn("ImportsRepository.createIntegrationRunIfIdle")(
			function* (input: {
				userId: UserId;
				source: ImportRunSource;
				integrationId: IntegrationId;
				pluginInstallationId: string;
				inputSummary: Record<string, unknown>;
			}) {
				return yield* createIntegrationRun({ ...input, integrationLot: "yank" }).pipe(
					Effect.catchIf(isUniqueConstraintError("import_run_integration_active_unique"), () =>
						Effect.succeed(null),
					),
				);
			},
		);

		const admitDataSubmission = Effect.fn("ImportsRepository.admitDataSubmission")(
			function* (input: {
				runId: ImportRunId;
				payload: IngestionCapture["payload"];
				accountGeneration: IngestionScope["accountGeneration"];
				userId: UserId;
				digest: string;
				submissionKey: string | null;
				uploadTokenHash: string | null;
				integrationId: IntegrationId | null;
				inputSummary: Record<string, unknown>;
			}) {
				yield* assertAdmissionOwner({
					userId: input.userId,
					pluginInstallationId: null,
					integrationId: input.integrationId,
				});
				const runId = input.runId;
				const submissionKey = input.submissionKey;
				if (submissionKey !== null) {
					const [claim] = yield* database.run((db) =>
						db
							.insert(schema.dataImportSubmission)
							.values({
								runId,
								key: submissionKey,
								digest: input.digest,
								userId: input.userId,
								integrationId: input.integrationId,
								uploadTokenHashes: input.uploadTokenHash === null ? [] : [input.uploadTokenHash],
							})
							.onConflictDoNothing()
							.returning(),
					);
					if (!claim) {
						const [existing] = yield* database.run((db) =>
							db
								.select()
								.from(schema.dataImportSubmission)
								.where(
									and(
										eq(schema.dataImportSubmission.userId, input.userId),
										eq(schema.dataImportSubmission.key, submissionKey),
										sql`coalesce(${schema.dataImportSubmission.integrationId}, '') = ${input.integrationId ?? ""}`,
									),
								)
								.limit(1),
						);
						if (!existing) {
							return yield* new DbError({ message: "Submission claim is unavailable" });
						}
						if (existing.digest === input.digest && input.uploadTokenHash !== null) {
							yield* database.run((db) =>
								db
									.update(schema.dataImportSubmission)
									.set({
										uploadTokenHashes: sql`case when ${input.uploadTokenHash} = any(${schema.dataImportSubmission.uploadTokenHashes}) then ${schema.dataImportSubmission.uploadTokenHashes} else array_append(${schema.dataImportSubmission.uploadTokenHashes}, ${input.uploadTokenHash}) end`,
									})
									.where(
										and(
											eq(schema.dataImportSubmission.userId, input.userId),
											eq(schema.dataImportSubmission.runId, existing.runId),
										),
									),
							);
						}
						return {
							created: false,
							digest: existing.digest,
							runId: ImportRunId.make(existing.runId),
						};
					}
				}
				yield* database.run((db) =>
					db
						.insert(schema.importRun)
						.values({
							id: runId,
							userId: input.userId,
							source: dataJsonSource,
							inputSummary: input.inputSummary,
							integrationId: input.integrationId,
							accountGeneration: input.accountGeneration.token,
							integrationLot: input.integrationId === null ? null : "sink",
						}),
				);
				if (!input.payload) {
					return yield* new DbError({ message: "Data ingestion payload is missing" });
				}
				const scope = { runId, userId: input.userId, accountGeneration: input.accountGeneration };
				yield* reservePayload(scope, {
					ordinal: 0,
					checkpoint: null,
					id: "admitted-data",
					recoveryBytes: null,
					captureState: "sealed",
					payload: input.payload,
					capturePhase: "collection",
					inputFingerprint: input.payload.checksum,
				});
				return { runId, created: true, digest: input.digest };
			},
		);

		const findDataUploadRetry = Effect.fn("ImportsRepository.findDataUploadRetry")(
			function* (input: { userId: UserId; key: string; uploadTokenHash: string }) {
				const [row] = yield* database.run((db) =>
					db
						.select({ runId: schema.dataImportSubmission.runId })
						.from(schema.dataImportSubmission)
						.where(
							and(
								eq(schema.dataImportSubmission.userId, input.userId),
								eq(schema.dataImportSubmission.key, input.key),
								isNull(schema.dataImportSubmission.integrationId),
								sql`${input.uploadTokenHash} = any(${schema.dataImportSubmission.uploadTokenHashes})`,
							),
						)
						.limit(1),
				);
				return row ? ImportRunId.make(row.runId) : null;
			},
		);

		const getRunById = Effect.fn("ImportsRepository.getRunById")(function* (input: {
			userId: UserId;
			runId: ImportRunId;
		}) {
			const [row] = yield* database.run((db) =>
				db
					.select()
					.from(schema.importRun)
					.where(
						and(eq(schema.importRun.id, input.runId), eq(schema.importRun.userId, input.userId)),
					)
					.limit(1),
			);
			return row ? normalizeRun(row) : null;
		});

		const getRunControlForUser = Effect.fn("ImportsRepository.getRunControlForUser")(
			function* (input: { userId: UserId; runId: ImportRunId }) {
				const [row] = yield* database.run((db) =>
					db
						.select({
							id: schema.importRun.id,
							status: schema.importRun.status,
							integrationId: schema.importRun.integrationId,
						})
						.from(schema.importRun)
						.where(
							and(eq(schema.importRun.id, input.runId), eq(schema.importRun.userId, input.userId)),
						)
						.limit(1),
				);
				return row
					? {
							status: row.status,
							id: ImportRunId.make(row.id),
							executionKind:
								row.integrationId === null ? ("source" as const) : ("integration" as const),
						}
					: null;
			},
		);

		const listRecentStatusesByIntegrationId = Effect.fn(
			"ImportsRepository.listRecentStatusesByIntegrationId",
		)(function* (input: { integrationId: IntegrationId; limit: number }) {
			return yield* database.run((db) =>
				db
					.select({ status: schema.importRun.status })
					.from(schema.importRun)
					.where(eq(schema.importRun.integrationId, input.integrationId))
					.orderBy(desc(schema.importRun.createdAt))
					.limit(input.limit),
			);
		});

		const updateInputSummary = Effect.fn("ImportsRepository.updateInputSummary")(function* (input: {
			runId: ImportRunId;
			inputSummary: Record<string, unknown>;
		}) {
			const rows = yield* database.run((db) =>
				db
					.update(schema.importRun)
					.set({ inputSummary: input.inputSummary })
					.where(and(eq(schema.importRun.id, input.runId), eq(schema.importRun.status, "pending")))
					.returning({ id: schema.importRun.id }),
			);
			return rows.length > 0;
		});

		const deleteRunById = Effect.fn("ImportsRepository.deleteRunById")(function* (input: {
			userId: UserId;
			runId: ImportRunId;
		}) {
			yield* database.run((db) =>
				db
					.delete(schema.importRun)
					.where(
						and(eq(schema.importRun.id, input.runId), eq(schema.importRun.userId, input.userId)),
					),
			);
		});

		const lockProjection = Effect.fn("ImportsRepository.lockProjection")(function* (
			scope: IngestionScope,
			statuses: ReadonlyArray<ImportRunRow["status"]> = ["running"],
		) {
			yield* database.requireTransaction;
			yield* database.acquireUserWriteLock(scope.userId);
			const [run] = yield* database.run((db) =>
				db
					.select()
					.from(schema.importRun)
					.where(and(owned(scope), inArray(schema.importRun.status, [...statuses])))
					.for("update")
					.limit(1),
			);
			if (!run) {
				return yield* new DbError({ message: "Ingestion owner is not active" });
			}
			return run;
		});
		const reservePayload = Effect.fn("ImportsRepository.reservePayload")(function* (
			scope: IngestionScope,
			input: Omit<
				typeof schema.importPayloadReservation.$inferInsert,
				"runId" | "released" | "ordinal"
			> & { ordinal: number | null },
		) {
			yield* lockProjection(scope, ["pending", "blocked", "running"]);
			const [inserted] = yield* database.run((db) =>
				db
					.insert(schema.importPayloadReservation)
					.values({
						...input,
						runId: scope.runId,
						checkpoint: sql`${stableStringify(input.checkpoint)}::jsonb`,
					})
					.onConflictDoNothing()
					.returning(),
			);
			const row =
				inserted ??
				(yield* database.run((db) =>
					db
						.select()
						.from(schema.importPayloadReservation)
						.where(
							and(
								eq(schema.importPayloadReservation.runId, scope.runId),
								eq(schema.importPayloadReservation.id, input.id),
							),
						),
				))[0];
			if (
				!row ||
				row.released ||
				row.retiring ||
				row.ordinal !== input.ordinal ||
				row.stagingExecutionId !== (input.stagingExecutionId ?? null) ||
				(input.ordinal === null &&
					stableStringify(row.payload) !== stableStringify(input.payload)) ||
				row.inputFingerprint !== input.inputFingerprint ||
				row.captureState !== input.captureState ||
				row.capturePhase !== input.capturePhase ||
				stableStringify(row.checkpoint) !== stableStringify(input.checkpoint)
			) {
				return yield* new DbError({ message: "Ingestion payload reservation identity changed" });
			}
			return row;
		});
		const listPayloadReservations = Effect.fn("ImportsRepository.listPayloadReservations")(
			function* (input: { userId: UserId; runId?: ImportRunId }) {
				return yield* database.run((db) =>
					db
						.select({
							runId: schema.importRun.id,
							reservation: schema.importPayloadReservation,
							accountGeneration: schema.importRun.accountGeneration,
						})
						.from(schema.importPayloadReservation)
						.innerJoin(
							schema.importRun,
							eq(schema.importRun.id, schema.importPayloadReservation.runId),
						)
						.where(
							and(
								eq(schema.importRun.userId, input.userId),
								input.runId === undefined ? undefined : eq(schema.importRun.id, input.runId),
							),
						),
				);
			},
		);
		const getPayloadReservation = Effect.fn("ImportsRepository.getPayloadReservation")(function* (
			scope: IngestionScope,
			id: string,
		) {
			const [row] = yield* database.run((db) =>
				db
					.select({ reservation: schema.importPayloadReservation })
					.from(schema.importPayloadReservation)
					.innerJoin(
						schema.importRun,
						eq(schema.importRun.id, schema.importPayloadReservation.runId),
					)
					.where(and(owned(scope), eq(schema.importPayloadReservation.id, id)))
					.limit(1),
			);
			return row?.reservation ?? null;
		});
		const getStagingOwner = Effect.fn("ImportsRepository.getStagingOwner")(function* (
			userId: UserId,
			accountGeneration: IngestionScope["accountGeneration"],
			executionId: string,
		) {
			const [run] = yield* database.run((db) =>
				db
					.select({ id: schema.importRun.id })
					.from(schema.importRun)
					.where(
						and(
							eq(schema.importRun.userId, userId),
							eq(schema.importRun.accountGeneration, accountGeneration.token),
							sql`${schema.importRun.pins}->>'executionId' = ${executionId}`,
						),
					)
					.limit(1),
			);
			return run
				? yield* getIngestionRun({ userId, accountGeneration, runId: ImportRunId.make(run.id) })
				: null;
		});
		const startPayloadWrite = Effect.fn("ImportsRepository.startPayloadWrite")(function* (
			scope: IngestionScope,
			id: string,
		) {
			yield* lockProjection(scope, ["pending", "blocked", "running"]);
			const rows = yield* database.run((db) =>
				db
					.update(schema.importPayloadReservation)
					.set({ writeStarted: true })
					.where(
						and(
							eq(schema.importPayloadReservation.runId, scope.runId),
							eq(schema.importPayloadReservation.id, id),
							eq(schema.importPayloadReservation.retiring, false),
							eq(schema.importPayloadReservation.released, false),
						),
					)
					.returning({ id: schema.importPayloadReservation.id }),
			);
			if (rows.length === 0) {
				return yield* new DbError({ message: "Ingestion payload owner is retiring" });
			}
			return yield* Effect.void;
		});
		const stopPayloadWrites = Effect.fn("ImportsRepository.stopPayloadWrites")(function* (input: {
			userId: UserId;
			runId?: ImportRunId;
		}) {
			yield* database.requireTransaction;
			yield* database.acquireUserWriteLock(input.userId);
			yield* database.run((db) =>
				db
					.update(schema.importPayloadReservation)
					.set({ retiring: true })
					.where(
						and(
							sql`exists (select 1 from ${schema.importRun} where ${schema.importRun.id} = ${schema.importPayloadReservation.runId} and ${schema.importRun.userId} = ${input.userId})`,
							input.runId === undefined
								? undefined
								: eq(schema.importPayloadReservation.runId, input.runId),
						),
					),
			);
			return yield* listPayloadReservations(input);
		});
		const releasePayloadReservation = Effect.fn("ImportsRepository.releasePayloadReservation")(
			function* (scope: IngestionScope, id: string) {
				yield* database.run((db) =>
					db
						.update(schema.importPayloadReservation)
						.set({ released: true, recoveryBytes: null })
						.where(
							and(
								eq(schema.importPayloadReservation.runId, scope.runId),
								eq(schema.importPayloadReservation.id, id),
								sql`exists (select 1 from ${schema.importRun} where ${schema.importRun.id} = ${scope.runId} and ${schema.importRun.userId} = ${scope.userId} and ${schema.importRun.accountGeneration} = ${scope.accountGeneration.token})`,
							),
						),
				);
			},
		);
		const clearPayloadRecovery = Effect.fn("ImportsRepository.clearPayloadRecovery")(function* (
			scope: IngestionScope,
			id: string,
		) {
			yield* lockProjection(scope, ["pending", "blocked", "running"]);
			yield* database.run((db) =>
				db
					.update(schema.importPayloadReservation)
					.set({ recoveryBytes: null })
					.where(
						and(
							eq(schema.importPayloadReservation.runId, scope.runId),
							eq(schema.importPayloadReservation.id, id),
						),
					),
			);
		});
		const purgePayloadReservations = Effect.fn("ImportsRepository.purgePayloadReservations")(
			function* (input: { userId: UserId; runId?: ImportRunId; integrationId?: IntegrationId }) {
				yield* database.requireTransaction;
				yield* database.run((db) =>
					db
						.delete(schema.importPayloadReservation)
						.where(
							and(
								eq(schema.importPayloadReservation.released, true),
								sql`exists (select 1 from ${schema.importRun} where ${schema.importRun.id} = ${schema.importPayloadReservation.runId} and ${schema.importRun.userId} = ${input.userId})`,
								input.runId === undefined
									? undefined
									: eq(schema.importPayloadReservation.runId, input.runId),
								input.integrationId === undefined
									? undefined
									: sql`exists (select 1 from ${schema.importRun} where ${schema.importRun.id} = ${schema.importPayloadReservation.runId} and ${schema.importRun.integrationId} = ${input.integrationId})`,
							),
						),
				);
			},
		);
		const createBlockedRun = Effect.fn("ImportsRepository.createBlockedRun")(function* (input: {
			accountGeneration: IngestionScope["accountGeneration"];
			userId: UserId;
			source: ImportRunSource;
			integrationId: IntegrationId;
			pluginInstallationId: string | null;
			inputSummary: Record<string, unknown>;
			acceptedAt: Date;
			blockReasons: ReadonlyArray<IngestionBlockReason>;
		}) {
			yield* database.requireTransaction;
			yield* database.acquireUserWriteLock(input.userId);
			yield* assertAdmissionOwner(input);
			const [owner] = yield* database.run((db) =>
				db
					.select({ id: schema.user.id })
					.from(schema.user)
					.where(
						and(
							eq(schema.user.id, input.userId),
							eq(schema.user.id, input.accountGeneration.userId),
							eq(schema.user.accountGeneration, input.accountGeneration.token),
						),
					)
					.for("update")
					.limit(1),
			);
			if (!owner) {
				return yield* new DbError({ message: "Blocked ingestion account generation has retired" });
			}
			const blockReasons = yield* Schema.decodeEffect(Schema.Array(IngestionBlockReason))(
				input.blockReasons,
			);
			const [run] = yield* database.run((db) =>
				db
					.insert(schema.importRun)
					.values({
						...input,
						blockReasons,
						status: "blocked",
						integrationLot: "sink",
						createdAt: input.acceptedAt,
						accountGeneration: input.accountGeneration.token,
						blockDeadline: new Date(input.acceptedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
					})
					.returning(),
			);
			if (!run) {
				return yield* new DbError({ message: "Blocked run insert returned no row" });
			}
			return ImportRunId.make(run.id);
		});
		const releaseBlocked = Effect.fn("ImportsRepository.releaseBlocked")(function* (input: {
			scope: IngestionScope;
			now: Date;
			plan: IngestionPlan;
			pins: IngestionPins;
		}) {
			const plan = yield* Schema.decodeEffect(IngestionPlan)(input.plan);
			const pins = yield* Schema.decodeEffect(IngestionPins)(input.pins);
			const rows = yield* database.run((db) =>
				db
					.update(schema.importRun)
					.set({ plan, pins, blockReasons: [], status: "pending" })
					.where(
						and(
							owned(input.scope),
							eq(schema.importRun.status, "blocked"),
							executableOwner(),
							sql`${schema.importRun.preparedRelease} is null or (${schema.importRun.preparedRelease}->'plan' = ${JSON.stringify(plan)}::jsonb and ${schema.importRun.pins} = ${JSON.stringify(pins)}::jsonb)`,
							sql`${schema.importRun.blockDeadline} > ${input.now}`,
						),
					)
					.returning({ id: schema.importRun.id }),
			);
			return rows.length > 0;
		});
		const expireBlocked = Effect.fn("ImportsRepository.expireBlocked")(function* (input: {
			scope: IngestionScope;
			now: Date;
		}) {
			const rows = yield* database.run((db) =>
				db
					.update(schema.importRun)
					.set({ status: "expired", finishedAt: input.now, expiryReason: "setup-deadline-expired" })
					.where(
						and(
							owned(input.scope),
							eq(schema.importRun.status, "blocked"),
							sql`${schema.importRun.blockDeadline} <= ${input.now}`,
						),
					)
					.returning({ id: schema.importRun.id }),
			);
			return rows.length > 0;
		});
		const rejectBlocked = Effect.fn("ImportsRepository.rejectBlocked")(function* (input: {
			scope: IngestionScope;
			finishedAt: Date;
			failureReason: ImportRunFailureReason;
		}) {
			yield* database.requireTransaction;
			const rows = yield* database.run((db) =>
				db
					.update(schema.importRun)
					.set({
						status: "failed",
						finishedAt: input.finishedAt,
						failureReason: input.failureReason,
					})
					.where(and(owned(input.scope), eq(schema.importRun.status, "blocked")))
					.returning({ id: schema.importRun.id }),
			);
			return rows.length > 0;
		});
		const startIngestion = Effect.fn("ImportsRepository.startIngestion")(function* (input: {
			scope: IngestionScope;
			startedAt: Date;
		}) {
			const rows = yield* database.run((db) =>
				db
					.update(schema.importRun)
					.set({ status: "running", startedAt: input.startedAt })
					.where(
						and(
							owned(input.scope),
							eq(schema.importRun.status, "pending"),
							executableOwner(),
							sql`${schema.importRun.plan} is not null and ${schema.importRun.pins} is not null`,
						),
					)
					.returning({ id: schema.importRun.id }),
			);
			return rows.length > 0;
		});
		const startIntegrationIngestion = Effect.fn("ImportsRepository.startIntegrationIngestion")(
			function* (input: { scope: IngestionScope; integrationId: IntegrationId; startedAt: Date }) {
				return yield* database.transaction(
					Effect.gen(function* () {
						yield* database.acquireUserWriteLock(input.scope.userId);
						const [active] = yield* database.run((db) =>
							db
								.select({ id: schema.importRun.id })
								.from(schema.importRun)
								.where(
									and(
										eq(schema.importRun.integrationId, input.integrationId),
										eq(schema.importRun.userId, input.scope.userId),
										eq(schema.importRun.accountGeneration, input.scope.accountGeneration.token),
										inArray(schema.importRun.status, ["running", "cancelling"]),
									),
								)
								.limit(1),
						);
						if (active) {
							return active.id === input.scope.runId;
						}
						return yield* startIngestion(input);
					}),
				);
			},
		);
		const publishCapture = Effect.fn("ImportsRepository.publishCapture")(function* (
			scope: IngestionScope,
			capture: IngestionCapture,
		) {
			const data = yield* Schema.decodeEffect(IngestionCapture)(capture);
			const run = yield* lockProjection(scope, ["pending", "blocked", "running"]);
			const [existing] = yield* database.run((db) =>
				db
					.select()
					.from(schema.importCapture)
					.where(
						and(eq(schema.importCapture.runId, scope.runId), eq(schema.importCapture.id, data.id)),
					)
					.limit(1),
			);
			if (existing) {
				if (stableStringify(existing.data) !== stableStringify(data)) {
					return yield* new DbError({ message: "Capture identity conflict" });
				}
				return false;
			}
			if (run.collectionSealed && data.phase === "collection") {
				return yield* new DbError({ message: "Collection is sealed" });
			}
			if (data.payload === null || data.state === "released") {
				return yield* new DbError({
					message: "Capture publication requires durable payload metadata",
				});
			}
			yield* database.run((db) =>
				db
					.insert(schema.importCapture)
					.values({
						data,
						id: data.id,
						phase: data.phase,
						runId: scope.runId,
						ordinal: data.ordinal,
					}),
			);
			return true;
		});
		const sealCollection = Effect.fn("ImportsRepository.sealCollection")(function* (
			scope: IngestionScope,
		) {
			yield* lockProjection(scope);
			yield* database.run((db) =>
				db.update(schema.importRun).set({ collectionSealed: true }).where(owned(scope)),
			);
		});
		const registerBatch = Effect.fn("ImportsRepository.registerBatch")(function* (
			scope: IngestionScope,
			batch: IngestionBatch,
			operationIds: ReadonlyArray<string>,
			execution: Pick<typeof schema.importBatch.$inferInsert, "workflowName" | "executionId">,
		) {
			const data = yield* Schema.decodeEffect(IngestionBatch)(batch);
			yield* lockProjection(scope);
			const [existing] = yield* database.run((db) =>
				db
					.select()
					.from(schema.importBatch)
					.where(and(eq(schema.importBatch.runId, scope.runId), eq(schema.importBatch.id, data.id)))
					.limit(1),
			);
			if (existing) {
				if (
					stableStringify(existing.operationIds) !== stableStringify([...operationIds].sort()) ||
					existing.workflowName !== execution.workflowName ||
					existing.executionId !== execution.executionId ||
					existing.data.inputFingerprint !== data.inputFingerprint ||
					existing.captureId !== data.captureId ||
					existing.ordinal !== data.ordinal
				) {
					return yield* new DbError({ message: "Batch identity conflict" });
				}
				return false;
			}
			if (data.state !== "pending" || data.summary.length > 0) {
				return yield* new DbError({ message: "Batch must be registered pending" });
			}
			if (operationIds.length > 1000 || new Set(operationIds).size !== operationIds.length) {
				return yield* new DbError({
					message: "Batch operation identities are not bounded and unique",
				});
			}
			const operationArray = sql`ARRAY[${sql.join(
				operationIds.map((id) => sql`${id}`),
				sql`, `,
			)}]::text[]`;
			const overlaps = yield* database.run((db) =>
				db
					.select({ id: schema.importBatch.id })
					.from(schema.importBatch)
					.where(
						and(
							eq(schema.importBatch.runId, scope.runId),
							sql`${schema.importBatch.operationIds} && ${operationArray}`,
						),
					)
					.limit(1),
			);
			if (overlaps.length > 0) {
				return yield* new DbError({ message: "Ingestion operation belongs to another batch" });
			}
			yield* database.run((db) =>
				db
					.insert(schema.importBatch)
					.values({
						data,
						operationIds: [...operationIds].sort(),
						...execution,
						id: data.id,
						runId: scope.runId,
						ordinal: data.ordinal,
						captureId: data.captureId,
					}),
			);
			return true;
		});
		const projectBatch = Effect.fn("ImportsRepository.projectBatch")(function* (
			scope: IngestionScope,
			batch: IngestionBatch,
		) {
			const data = yield* Schema.decodeEffect(IngestionBatch)(batch);
			yield* lockProjection(scope, ["running", "cancelling"]);
			const [existing] = yield* database.run((db) =>
				db
					.select()
					.from(schema.importBatch)
					.where(and(eq(schema.importBatch.runId, scope.runId), eq(schema.importBatch.id, data.id)))
					.limit(1),
			);
			if (
				!existing ||
				existing.data.inputFingerprint !== data.inputFingerprint ||
				existing.captureId !== data.captureId ||
				existing.ordinal !== data.ordinal
			) {
				return yield* new DbError({ message: "Batch identity conflict" });
			}
			if (existing.data.state === "applied") {
				if (stableStringify(existing.data) !== stableStringify(data)) {
					return yield* new DbError({ message: "Applied batch projection conflict" });
				}
				return false;
			}
			if (data.state !== "applied") {
				return yield* new DbError({ message: "Only confirmed batch summaries may be projected" });
			}
			const summaries = yield* database.run((db) =>
				db
					.select({ data: schema.importBatch.data })
					.from(schema.importBatch)
					.where(eq(schema.importBatch.runId, scope.runId)),
			);
			const dimensions = new Set(
				[...data.summary, ...summaries.flatMap((row) => row.data.summary)].map((row) =>
					stableStringify([row.recordKind, row.unit]),
				),
			);
			if (dimensions.size > 100) {
				return yield* new DbError({ message: "Ingestion summary exceeds its record-kind limit" });
			}
			yield* database.run((db) =>
				db
					.update(schema.importBatch)
					.set({ data })
					.where(
						and(eq(schema.importBatch.runId, scope.runId), eq(schema.importBatch.id, data.id)),
					),
			);
			return true;
		});
		const writeActivity = Effect.fn("ImportsRepository.writeActivity")(function* (
			scope: IngestionScope,
			activity: IngestionActivity,
			statuses: ReadonlyArray<ImportRunRow["status"]>,
		) {
			const data = yield* Schema.decodeEffect(IngestionActivity)(activity);
			yield* lockProjection(scope, statuses);
			if (data.exactTotal !== null && data.completed > data.exactTotal) {
				return yield* new DbError({ message: "Activity exceeds exact total" });
			}
			const [existing] = yield* database.run((db) =>
				db
					.select()
					.from(schema.importActivity)
					.where(
						and(
							eq(schema.importActivity.runId, scope.runId),
							eq(schema.importActivity.id, data.id),
						),
					)
					.limit(1),
			);
			if (
				existing &&
				(existing.data.kind !== data.kind ||
					existing.data.unit !== data.unit ||
					existing.data.parentId !== data.parentId ||
					existing.data.batchId !== data.batchId ||
					existing.data.completed > data.completed ||
					existing.data.lastAdvancedAt > data.lastAdvancedAt ||
					(existing.data.exactTotal !== null && existing.data.exactTotal !== data.exactTotal))
			) {
				return yield* new DbError({ message: "Activity identity or progress conflict" });
			}
			yield* database.run((db) =>
				db
					.insert(schema.importActivity)
					.values({
						data,
						id: data.id,
						runId: scope.runId,
						batchId: data.batchId,
						parentId: data.parentId,
					})
					.onConflictDoUpdate({
						set: { data },
						target: [schema.importActivity.runId, schema.importActivity.id],
					}),
			);
			return undefined;
		});
		const putActivity = Effect.fn("ImportsRepository.putActivity")(
			(scope: IngestionScope, activity: IngestionActivity) =>
				writeActivity(scope, activity, ["running"]),
		);
		const putSettlementActivity = Effect.fn("ImportsRepository.putSettlementActivity")(
			(scope: IngestionScope, activity: IngestionActivity) =>
				writeActivity(scope, activity, ["running", "cancelling"]),
		);
		const recordOutcome = Effect.fn("ImportsRepository.recordOutcome")(function* (
			scope: IngestionScope,
			outcome: IngestionOutcome,
		) {
			const data = yield* Schema.decodeEffect(IngestionOutcome)(outcome);
			yield* lockProjection(scope, ["running", "cancelling"]);
			if (["created", "updated", "unchanged"].includes(data.result)) {
				const [receipt] = yield* database.run((db) =>
					db
						.select({ id: schema.mutationReceipt.id })
						.from(schema.mutationReceipt)
						.where(
							and(
								eq(schema.mutationReceipt.id, data.receiptId ?? ""),
								eq(schema.mutationReceipt.ownerUserId, scope.userId),
								eq(schema.mutationReceipt.rootExecutionId, scope.runId),
								eq(schema.mutationReceipt.itemIdentity, data.operationId),
								eq(schema.mutationReceipt.receiptType, "item"),
								eq(schema.mutationReceipt.inputFingerprint, data.inputFingerprint),
								sql`${schema.mutationReceipt.accountGeneration}->>'token' = ${scope.accountGeneration.token}`,
							),
						)
						.limit(1),
				);
				if (!receipt) {
					return yield* new DbError({ message: "Committed outcome requires its mutation receipt" });
				}
			}
			const [existing] = yield* database.run((db) =>
				db
					.select()
					.from(schema.importOutcome)
					.where(
						and(
							eq(schema.importOutcome.runId, scope.runId),
							eq(schema.importOutcome.operationId, data.operationId),
						),
					)
					.limit(1),
			);
			if (existing) {
				if (stableStringify(existing.data) !== stableStringify(data)) {
					return yield* new DbError({ message: "Operation identity conflict" });
				}
				return false;
			}
			yield* database.run((db) =>
				db
					.insert(schema.importOutcome)
					.values({ data, runId: scope.runId, operationId: data.operationId }),
			);
			return true;
		});
		const recordIssue = Effect.fn("ImportsRepository.recordIssue")(function* (
			scope: IngestionScope,
			issue: IngestionIssue,
		) {
			const data = yield* Schema.decodeEffect(IngestionIssue)(issue);
			yield* lockProjection(scope, ["running", "cancelling"]);
			const [existing] = yield* database.run((db) =>
				db
					.select()
					.from(schema.importIssue)
					.where(and(eq(schema.importIssue.runId, scope.runId), eq(schema.importIssue.id, data.id)))
					.limit(1),
			);
			if (existing) {
				if (stableStringify(existing.data) !== stableStringify(data)) {
					return yield* new DbError({ message: "Issue identity conflict" });
				}
				return false;
			}
			yield* database.run((db) =>
				db.insert(schema.importIssue).values({ data, id: data.id, runId: scope.runId }),
			);
			return true;
		});
		const getIngestionRun = Effect.fn("ImportsRepository.getIngestionRun")(function* (
			scope: IngestionScope,
		) {
			const [run] = yield* database.run((db) =>
				db.select().from(schema.importRun).where(owned(scope)).limit(1),
			);
			if (!run) {
				return null;
			}
			const batches = yield* database.run((db) =>
				db
					.select()
					.from(schema.importBatch)
					.where(eq(schema.importBatch.runId, scope.runId))
					.orderBy(asc(schema.importBatch.ordinal)),
			);
			const activities = yield* database.run((db) =>
				db
					.select()
					.from(schema.importActivity)
					.where(eq(schema.importActivity.runId, scope.runId))
					.orderBy(asc(schema.importActivity.id)),
			);
			const summary: Array<IngestionSummary[number]> = [];
			for (const batch of batches) {
				for (const item of batch.data.summary) {
					const existing = summary.find(
						(entry) => entry.unit === item.unit && entry.recordKind === item.recordKind,
					);
					if (!existing) {
						summary.push({ ...item, counts: { ...item.counts } });
					} else {
						summary[summary.indexOf(existing)] = {
							...existing,
							counts: {
								created: existing.counts.created + item.counts.created,
								updated: existing.counts.updated + item.counts.updated,
								skipped: existing.counts.skipped + item.counts.skipped,
								unchanged: existing.counts.unchanged + item.counts.unchanged,
								unsuccessful: existing.counts.unsuccessful + item.counts.unsuccessful,
							},
						};
					}
				}
			}
			return yield* Schema.decodeEffect(IngestionRun)({
				summary,
				id: run.id,
				plan: run.plan,
				pins: run.pins,
				userId: run.userId,
				source: run.source,
				status: run.status,
				blockReasons: run.blockReasons,
				expiryReason: run.expiryReason,
				integrationId: run.integrationId,
				collectionSealed: run.collectionSealed,
				acceptedAt: run.createdAt.toISOString(),
				pluginInstallationId: run.pluginInstallationId,
				startedAt: run.startedAt?.toISOString() ?? null,
				finishedAt: run.finishedAt?.toISOString() ?? null,
				blockDeadline: run.blockDeadline?.toISOString() ?? null,
				activities: activities.map((activity) => activity.data),
				executionKind: run.integrationId === null ? "source" : "integration",
				accountGeneration: { userId: run.userId, token: run.accountGeneration },
			});
		});
		const cancelIngestion = Effect.fn("ImportsRepository.cancelIngestion")(function* (
			scope: IngestionScope,
		) {
			const rows = yield* database.run((db) =>
				db
					.update(schema.importRun)
					.set({ status: "cancelling" })
					.where(
						and(owned(scope), inArray(schema.importRun.status, ["pending", "blocked", "running"])),
					)
					.returning({ id: schema.importRun.id }),
			);
			return rows.length > 0;
		});
		const pinIngestion = Effect.fn("ImportsRepository.pinIngestion")(function* (input: {
			scope: IngestionScope;
			plan: IngestionPlan;
			pins: IngestionPins;
		}) {
			const plan = yield* Schema.decodeEffect(IngestionPlan)(input.plan);
			const pins = yield* Schema.decodeEffect(IngestionPins)(input.pins);
			const rows = yield* database.run((db) =>
				db
					.update(schema.importRun)
					.set({ plan, pins })
					.where(
						and(
							owned(input.scope),
							eq(schema.importRun.status, "pending"),
							isNull(schema.importRun.plan),
							executableOwner(),
							sql`${schema.importRun.preparedRelease} is null or ${schema.importRun.preparedRelease}->'plan' = ${JSON.stringify(plan)}::jsonb`,
							or(
								isNull(schema.importRun.pins),
								sql`${schema.importRun.pins} = ${JSON.stringify(pins)}::jsonb`,
							),
						),
					)
					.returning({ id: schema.importRun.id }),
			);
			return rows.length > 0;
		});
		const advanceBatch = Effect.fn("ImportsRepository.advanceBatch")(function* (
			scope: IngestionScope,
			batchId: string,
			state: "preparing" | "applying",
		) {
			yield* lockProjection(scope);
			const rows = yield* database.run((db) =>
				db
					.update(schema.importBatch)
					.set({
						data: sql`jsonb_set(${schema.importBatch.data}, '{state}', ${JSON.stringify(state)}::jsonb)`,
					})
					.where(
						and(
							eq(schema.importBatch.runId, scope.runId),
							eq(schema.importBatch.id, batchId),
							sql`${schema.importBatch.data}->>'state' = ${state === "preparing" ? "pending" : "preparing"}`,
						),
					)
					.returning({ id: schema.importBatch.id }),
			);
			return rows.length > 0;
		});
		const settleIngestion = Effect.fn("ImportsRepository.settleIngestion")(function* (input: {
			scope: IngestionScope;
			status: "completed" | "failed" | "cancelled";
			finishedAt: Date;
			failureReason?: ImportRunFailureReason;
		}) {
			const rows = yield* database.run((db) =>
				db
					.update(schema.importRun)
					.set({
						status: input.status,
						finishedAt: input.finishedAt,
						failureReason: input.failureReason ?? null,
					})
					.where(
						and(
							owned(input.scope),
							eq(schema.importRun.status, input.status === "cancelled" ? "cancelling" : "running"),
						),
					)
					.returning({ id: schema.importRun.id }),
			);
			return rows.length > 0;
		});
		const finishActivities = Effect.fn("ImportsRepository.finishActivities")(function* (
			scope: IngestionScope,
			status: "completed" | "failed" | "cancelled",
		) {
			const run = yield* lockProjection(scope, [
				"running",
				"cancelling",
				"completed",
				"failed",
				"cancelled",
				"expired",
			]);
			if (["completed", "failed", "cancelled", "expired"].includes(run.status)) {
				return null;
			}
			const state = run.status === "cancelling" ? "cancelled" : status;
			yield* database.run((db) =>
				db
					.update(schema.importActivity)
					.set({
						data: sql`jsonb_set(${schema.importActivity.data}, '{state}', ${JSON.stringify(state)}::jsonb)`,
					})
					.where(
						and(
							eq(schema.importActivity.runId, scope.runId),
							sql`${schema.importActivity.data}->>'state' in ('pending', 'running', 'waiting')`,
						),
					),
			);
			return state;
		});
		const listCaptures = Effect.fn("ImportsRepository.listCaptures")(function* (
			scope: IngestionScope,
		) {
			return yield* database.run((db) =>
				db
					.select({ data: schema.importCapture.data })
					.from(schema.importCapture)
					.innerJoin(schema.importRun, eq(schema.importRun.id, schema.importCapture.runId))
					.where(owned(scope))
					.orderBy(asc(schema.importCapture.ordinal)),
			);
		});
		const listBatches = Effect.fn("ImportsRepository.listBatches")(function* (
			scope: IngestionScope,
		) {
			return yield* database.run((db) =>
				db
					.select({ data: schema.importBatch.data })
					.from(schema.importBatch)
					.innerJoin(schema.importRun, eq(schema.importRun.id, schema.importBatch.runId))
					.where(owned(scope))
					.orderBy(asc(schema.importBatch.ordinal)),
			);
		});
		const isIngestionApplied = Effect.fn("ImportsRepository.isIngestionApplied")(function* (
			scope: IngestionScope,
		) {
			const rows = yield* database.run((db) =>
				db
					.select({ id: schema.importRun.id })
					.from(schema.importRun)
					.where(
						and(
							owned(scope),
							eq(schema.importRun.collectionSealed, true),
							sql`not exists (select 1 from ${schema.importPayloadReservation} r where r.run_id = ${scope.runId} and r.ordinal is not null and not r.released and not exists (select 1 from ${schema.importCapture} c where c.run_id = r.run_id and c.id = r.id))`,
							sql`not exists (select 1 from ${schema.importBatch} b where b.run_id = ${scope.runId} and b.data->>'state' <> 'applied')`,
							sql`not exists (select 1 from ${schema.importCapture} c where c.run_id = ${scope.runId} and c.phase = 'application' and not exists (select 1 from ${schema.importBatch} b where b.run_id = c.run_id and b.capture_id = c.id and b.data->>'state' = 'applied'))`,
						),
					)
					.limit(1),
			);
			return rows.length > 0;
		});
		const getCapture = Effect.fn("ImportsRepository.getCapture")(function* (
			scope: IngestionScope,
			id: string,
		) {
			const [row] = yield* database.run((db) =>
				db
					.select({ data: schema.importCapture.data })
					.from(schema.importCapture)
					.innerJoin(schema.importRun, eq(schema.importRun.id, schema.importCapture.runId))
					.where(and(owned(scope), eq(schema.importCapture.id, id)))
					.limit(1),
			);
			return row?.data ?? null;
		});
		const getIntegrationInput = Effect.fn("ImportsRepository.getIntegrationInput")(function* (
			scope: IngestionScope,
		) {
			const [row] = yield* database.run((db) =>
				db
					.select({ envelope: schema.importCapture.data, lot: schema.importRun.integrationLot })
					.from(schema.importRun)
					.leftJoin(
						schema.importCapture,
						and(
							eq(schema.importCapture.runId, schema.importRun.id),
							eq(schema.importCapture.id, "admitted-envelope"),
						),
					)
					.where(owned(scope))
					.limit(1),
			);
			return row ?? null;
		});
		const pageCaptures = Effect.fn("ImportsRepository.pageCaptures")(function* (
			scope: IngestionScope,
			after: number | null,
			limit: number,
		) {
			return yield* database.run((db) =>
				db
					.select({ data: schema.importCapture.data })
					.from(schema.importCapture)
					.innerJoin(schema.importRun, eq(schema.importRun.id, schema.importCapture.runId))
					.where(
						and(
							owned(scope),
							sql`${schema.importCapture.ordinal} >= 64`,
							eq(schema.importCapture.phase, "collection"),
							after === null ? undefined : sql`${schema.importCapture.ordinal} > ${after}`,
						),
					)
					.orderBy(asc(schema.importCapture.ordinal))
					.limit(Math.min(100, Math.max(1, limit))),
			);
		});
		const listIssues = Effect.fn("ImportsRepository.listIssues")(function* (input: {
			scope: IngestionScope;
			after?: string;
			limit: number;
		}) {
			return yield* database.run((db) =>
				db
					.select({ data: schema.importIssue.data })
					.from(schema.importIssue)
					.innerJoin(schema.importRun, eq(schema.importRun.id, schema.importIssue.runId))
					.where(
						and(
							owned(input.scope),
							input.after === undefined
								? undefined
								: sql`${schema.importIssue.id} > ${input.after}`,
						),
					)
					.orderBy(asc(schema.importIssue.id))
					.limit(Math.min(100, Math.max(1, input.limit))),
			);
		});
		const getBatchIssues = Effect.fn("ImportsRepository.getBatchIssues")(function* (
			scope: IngestionScope,
			batchId: string,
		) {
			return yield* database.run((db) =>
				db
					.select({ data: schema.importIssue.data })
					.from(schema.importIssue)
					.innerJoin(schema.importRun, eq(schema.importRun.id, schema.importIssue.runId))
					.innerJoin(
						schema.importBatch,
						and(
							eq(schema.importBatch.runId, schema.importRun.id),
							eq(schema.importBatch.id, batchId),
						),
					)
					.where(
						and(
							owned(scope),
							sql`${schema.importIssue.id} = any(${schema.importBatch.operationIds})`,
						),
					)
					.orderBy(asc(schema.importIssue.id))
					.limit(1000),
			);
		});
		const listBatchExecutions = Effect.fn("ImportsRepository.listBatchExecutions")(function* (
			scope: IngestionScope,
		) {
			return yield* database.run((db) =>
				db
					.select({
						executionId: schema.importBatch.executionId,
						workflowName: schema.importBatch.workflowName,
					})
					.from(schema.importBatch)
					.innerJoin(schema.importRun, eq(schema.importRun.id, schema.importBatch.runId))
					.where(and(owned(scope), sql`${schema.importBatch.data}->>'state' <> 'pending'`)),
			);
		});
		const listRecoveryRuns = Effect.fn("ImportsRepository.listRecoveryRuns")(function* (
			limit: number,
		) {
			return yield* database.run((db) =>
				db
					.select({
						id: schema.importRun.id,
						userId: schema.importRun.userId,
						source: schema.importRun.source,
						status: schema.importRun.status,
						acceptedAt: schema.importRun.createdAt,
						accountGeneration: schema.importRun.accountGeneration,
						admitted: sql<boolean>`${schema.importRun.plan} is not null and ${schema.importRun.pins} is not null`,
					})
					.from(schema.importRun)
					.innerJoin(
						schema.user,
						and(
							eq(schema.user.id, schema.importRun.userId),
							eq(schema.user.accountGeneration, schema.importRun.accountGeneration),
						),
					)
					.where(
						or(
							and(
								isNull(schema.importRun.integrationId),
								inArray(schema.importRun.status, ["pending", "cancelling"]),
								isNotNull(schema.importRun.plan),
								isNotNull(schema.importRun.pins),
							),
							and(
								isNull(schema.importRun.integrationId),
								inArray(schema.importRun.status, ["pending", "cancelling"]),
								isNull(schema.importRun.plan),
								sql`${schema.importRun.createdAt} < now() - interval '5 minutes'`,
							),
							and(
								inArray(schema.importRun.status, ["completed", "failed", "cancelled", "expired"]),
								or(
									isNotNull(schema.importRun.pins),
									sql`exists (select 1 from ${schema.importPayloadReservation} where ${schema.importPayloadReservation.runId} = ${schema.importRun.id} and not ${schema.importPayloadReservation.released})`,
								),
							),
						),
					)
					.orderBy(asc(schema.importRun.createdAt))
					.limit(Math.min(100, Math.max(1, limit))),
			);
		});
		const listIntegrationRecoveryRuns = Effect.fn("ImportsRepository.listIntegrationRecoveryRuns")(
			function* (input: { limit: number; before: Date; after: IngestionRecoveryCursor | null }) {
				return yield* database.run((db) =>
					db
						.select({ run: schema.importRun })
						.from(schema.importRun)
						.innerJoin(
							schema.user,
							and(
								eq(schema.user.id, schema.importRun.userId),
								eq(schema.user.accountGeneration, schema.importRun.accountGeneration),
							),
						)
						.where(
							and(
								isNotNull(schema.importRun.integrationId),
								inArray(schema.importRun.status, ["blocked", "pending", "cancelling"]),
								lte(schema.importRun.createdAt, input.before),
								input.after
									? or(
											gt(schema.importRun.createdAt, new Date(input.after.createdAt)),
											and(
												eq(schema.importRun.createdAt, new Date(input.after.createdAt)),
												gt(schema.importRun.id, input.after.id),
											),
										)
									: undefined,
							),
						)
						.orderBy(asc(schema.importRun.createdAt), asc(schema.importRun.id))
						.limit(Math.min(100, Math.max(1, input.limit))),
				);
			},
		);
		const listCleanupPins = Effect.fn("ImportsRepository.listCleanupPins")(function* (input: {
			userId: UserId;
			runId?: ImportRunId;
		}) {
			return yield* database.run((db) =>
				db
					.select({ pins: schema.importRun.pins })
					.from(schema.importRun)
					.where(
						and(
							eq(schema.importRun.userId, input.userId),
							input.runId === undefined ? undefined : eq(schema.importRun.id, input.runId),
							isNotNull(schema.importRun.pins),
						),
					),
			);
		});
		const reserveIngestionPins = Effect.fn("ImportsRepository.reserveIngestionPins")(function* (
			scope: IngestionScope,
			pins: IngestionPins,
			preparedRelease?: PreparedIngestionRelease,
		) {
			const run = yield* lockProjection(scope, ["pending", "blocked"]);
			yield* assertAdmissionOwner({
				userId: scope.userId,
				pluginInstallationId: run.pluginInstallationId,
				integrationId: run.integrationId === null ? null : IntegrationId.make(run.integrationId),
			});
			if (run.pins && stableStringify(run.pins) !== stableStringify(pins)) {
				return yield* new DbError({ message: "Ingestion pin reservation changed" });
			}
			if (
				run.preparedRelease &&
				stableStringify(run.preparedRelease) !== stableStringify(preparedRelease)
			) {
				return yield* new DbError({ message: "Ingestion prepared release changed" });
			}
			const prepared = preparedRelease
				? yield* Schema.decodeEffect(PreparedIngestionRelease)(preparedRelease)
				: undefined;
			if (
				prepared &&
				(prepared.state.workflowScriptId !== pins.scriptId ||
					prepared.state.pluginRevision.revisionId !== pins.pluginRevisionId ||
					prepared.state.pluginRevision.configRevisionId !== pins.pluginConfigRevisionId)
			) {
				return yield* new DbError({
					message: "Ingestion prepared release does not match retained pins",
				});
			}
			yield* database.run((db) =>
				db
					.update(schema.importRun)
					.set({ pins, ...(prepared ? { preparedRelease: prepared } : {}) })
					.where(owned(scope)),
			);
			return yield* Effect.void;
		});
		const getPreparedRelease = Effect.fn("ImportsRepository.getPreparedRelease")(function* (
			scope: IngestionScope,
		) {
			const [row] = yield* database.run((db) =>
				db
					.select({ preparedRelease: schema.importRun.preparedRelease })
					.from(schema.importRun)
					.where(owned(scope))
					.limit(1),
			);
			return row?.preparedRelease
				? yield* Schema.decodeEffect(PreparedIngestionRelease)(row.preparedRelease)
				: null;
		});
		const retireRuns = Effect.fn("ImportsRepository.retireRuns")(function* (input: {
			userId: UserId;
			integrationId?: IntegrationId;
			pluginInstallationId?: string;
		}) {
			yield* database.requireTransaction;
			yield* database.acquireUserWriteLock(input.userId);
			const predicate = and(
				eq(schema.importRun.userId, input.userId),
				input.integrationId === undefined
					? undefined
					: eq(schema.importRun.integrationId, input.integrationId),
				input.pluginInstallationId === undefined
					? undefined
					: eq(schema.importRun.pluginInstallationId, input.pluginInstallationId),
			);
			yield* database.run((db) =>
				db
					.update(schema.importRun)
					.set({ status: "cancelling" })
					.where(
						and(predicate, inArray(schema.importRun.status, ["pending", "blocked", "running"])),
					),
			);
			return yield* database.run((db) =>
				db
					.select({
						id: schema.importRun.id,
						integrationId: schema.importRun.integrationId,
						accountGeneration: schema.importRun.accountGeneration,
						pluginInstallationId: schema.importRun.pluginInstallationId,
					})
					.from(schema.importRun)
					.where(predicate),
			);
		});
		const claimAdmissionAbort = Effect.fn("ImportsRepository.claimAdmissionAbort")(function* (
			scope: IngestionScope,
		) {
			const rows = yield* database.run((db) =>
				db
					.update(schema.importRun)
					.set({ status: "cancelling" })
					.where(
						and(
							owned(scope),
							eq(schema.importRun.status, "pending"),
							isNull(schema.importRun.plan),
						),
					)
					.returning({ id: schema.importRun.id }),
			);
			return rows.length > 0;
		});
		const abortAdmission = Effect.fn("ImportsRepository.abortAdmission")(function* (
			scope: IngestionScope,
		) {
			yield* database.requireTransaction;
			const [run] = yield* database.run((db) =>
				db
					.select({ id: schema.importRun.id })
					.from(schema.importRun)
					.where(
						and(
							owned(scope),
							eq(schema.importRun.status, "cancelling"),
							isNull(schema.importRun.plan),
						),
					)
					.for("update"),
			);
			if (!run) {
				return false;
			}
			yield* purgePayloadReservations(scope);
			yield* database.run((db) =>
				db
					.delete(schema.dataImportSubmission)
					.where(
						and(
							eq(schema.dataImportSubmission.userId, scope.userId),
							eq(schema.dataImportSubmission.runId, scope.runId),
						),
					),
			);
			yield* database.run((db) => db.delete(schema.importRun).where(owned(scope)));
			return true;
		});
		const getOutcome = Effect.fn("ImportsRepository.getOutcome")(function* (
			scope: IngestionScope,
			operationId: string,
		) {
			const [row] = yield* database.run((db) =>
				db
					.select({ data: schema.importOutcome.data })
					.from(schema.importOutcome)
					.innerJoin(schema.importRun, eq(schema.importRun.id, schema.importOutcome.runId))
					.where(and(owned(scope), eq(schema.importOutcome.operationId, operationId)))
					.limit(1),
			);
			return row?.data ?? null;
		});
		const releaseCapture = Effect.fn("ImportsRepository.releaseCapture")(function* (
			scope: IngestionScope,
			captureId: string,
		) {
			const rows = yield* database.run((db) =>
				db
					.update(schema.importCapture)
					.set({
						data: sql`jsonb_set(jsonb_set(${schema.importCapture.data}, '{payload}', 'null'::jsonb), '{state}', '"released"'::jsonb)`,
					})
					.where(
						and(
							eq(schema.importCapture.runId, scope.runId),
							eq(schema.importCapture.id, captureId),
							sql`exists (select 1 from ${schema.importRun} where ${owned(scope)} and ${schema.importRun.status} in ('completed', 'failed', 'cancelled', 'expired'))`,
						),
					)
					.returning({ id: schema.importCapture.id }),
			);
			return rows.length > 0;
		});
		const releaseIngestionPins = Effect.fn("ImportsRepository.releaseIngestionPins")(function* (
			scope: IngestionScope,
		) {
			const rows = yield* database.run((db) =>
				db
					.update(schema.importRun)
					.set({ pins: null, preparedRelease: null })
					.where(
						and(
							owned(scope),
							inArray(schema.importRun.status, ["completed", "failed", "cancelled", "expired"]),
						),
					)
					.returning({ id: schema.importRun.id }),
			);
			return rows.length > 0;
		});
		const deleteIngestionReport = Effect.fn("ImportsRepository.deleteIngestionReport")(function* (
			scope: IngestionScope,
		) {
			const rows = yield* database.run((db) =>
				db
					.delete(schema.importRun)
					.where(
						and(
							owned(scope),
							inArray(schema.importRun.status, ["completed", "failed", "cancelled", "expired"]),
						),
					)
					.returning({ id: schema.importRun.id }),
			);
			return rows.length > 0;
		});

		return {
			retireRuns,
			getOutcome,
			listIssues,
			getRunById,
			getCapture,
			listBatches,
			putActivity,
			recordIssue,
			advanceBatch,
			pinIngestion,
			listCaptures,
			pageCaptures,
			projectBatch,
			recordOutcome,
			registerBatch,
			expireBlocked,
			rejectBlocked,
			deleteRunById,
			abortAdmission,
			getBatchIssues,
			reservePayload,
			releaseCapture,
			publishCapture,
			sealCollection,
			startIngestion,
			releaseBlocked,
			listCleanupPins,
			cancelIngestion,
			settleIngestion,
			getIngestionRun,
			createManualRun,
			getStagingOwner,
			finishActivities,
			listRecoveryRuns,
			createBlockedRun,
			startPayloadWrite,
			stopPayloadWrites,
			getPreparedRelease,
			isIngestionApplied,
			updateInputSummary,
			getIntegrationInput,
			listBatchExecutions,
			claimAdmissionAbort,
			admitDataSubmission,
			findDataUploadRetry,
			reserveIngestionPins,
			clearPayloadRecovery,
			releaseIngestionPins,
			createIntegrationRun,
			getRunControlForUser,
			putSettlementActivity,
			deleteIngestionReport,
			getPayloadReservation,
			listPayloadReservations,
			purgePayloadReservations,
			startIntegrationIngestion,
			releasePayloadReservation,
			createIntegrationRunIfIdle,
			listIntegrationRecoveryRuns,
			listRecentStatusesByIntegrationId,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
