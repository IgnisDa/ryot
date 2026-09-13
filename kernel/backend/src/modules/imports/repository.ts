import { DbError } from "@ryot-app/contract/errors";
import {
	dataJsonSource,
	type DataJsonDocument,
} from "@ryot-app/contract/modules/imports/data-json";
import type {
	ImportRunFailureReason,
	ListedImportRun,
} from "@ryot-app/contract/modules/imports/schemas";
import type {
	ImportRunFailureStage,
	ImportRunSource,
} from "@ryot-app/contract/modules/imports/types";
import type { IntegrationLot } from "@ryot-app/contract/modules/integrations/types";
import {
	EntitySchemaSlug,
	EventSchemaSlug,
	ImportRunId,
	type IntegrationId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { generateId } from "better-auth";
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { isUniqueConstraintError } from "#lib/infrastructure/db/errors";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";

type ImportRunRow = typeof schema.importRun.$inferSelect;

export type ImportRunExecutionKind = "source" | "integration";
export type ImportRunSettlement = "settled" | "cancellation-requested" | "preserved";
export type ImportRunStart = "started" | "cancellation-requested" | "preserved";
export type ImportRunCancellation = "requested" | "already-requested" | "not-cancellable";
export type ImportRunFailureCursor = { readonly createdAt: Date; readonly id: string };

const normalizeRun = (row: ImportRunRow): ListedImportRun => ({
	source: row.source,
	status: row.status,
	progress: row.progress,
	totalItems: row.totalItems,
	id: ImportRunId.make(row.id),
	failedItems: row.failedItems,
	inputSummary: row.inputSummary,
	failureReason: row.failureReason,
	importedItems: row.importedItems,
	processedItems: row.processedItems,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	startedAt: row.startedAt?.toISOString() ?? null,
	finishedAt: row.finishedAt?.toISOString() ?? null,
});

export class ImportsRepository extends Context.Service<ImportsRepository>()("ImportsRepository", {
	make: Effect.gen(function* () {
		const database = yield* DatabaseSession;
		const insertRun = Effect.fn("ImportsRepository.insertRun")(function* (input: {
			userId: UserId;
			source: ImportRunSource;
			pluginInstallationId: string | null;
			inputSummary: Record<string, unknown>;
			integrationId: IntegrationId | null;
			integrationLot: IntegrationLot | null;
		}) {
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
				userId: UserId;
				document: DataJsonDocument;
				digest: string;
				submissionKey: string | null;
				uploadTokenHash: string | null;
				integrationId: IntegrationId | null;
				inputSummary: Record<string, unknown>;
			}) {
				const runId = ImportRunId.make(generateId());
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
							dataDocument: input.document,
							inputSummary: input.inputSummary,
							integrationId: input.integrationId,
							integrationLot: input.integrationId === null ? null : "sink",
						}),
				);
				return { runId, created: true, digest: input.digest };
			},
		);

		const getDataDocument = Effect.fn("ImportsRepository.getDataDocument")(function* (input: {
			userId: UserId;
			runId: ImportRunId;
		}) {
			const [row] = yield* database.run((db) =>
				db
					.select({ document: schema.importRun.dataDocument })
					.from(schema.importRun)
					.where(
						and(eq(schema.importRun.id, input.runId), eq(schema.importRun.userId, input.userId)),
					)
					.limit(1),
			);
			return row?.document ?? null;
		});

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

		const releaseDataDocument = Effect.fn("ImportsRepository.releaseDataDocument")(function* (
			runId: ImportRunId,
		) {
			yield* database.run((db) =>
				db
					.update(schema.importRun)
					.set({ dataDocument: null })
					.where(eq(schema.importRun.id, runId)),
			);
		});

		const getRunStatus = Effect.fn("ImportsRepository.getRunStatus")(function* (
			runId: ImportRunId | string,
		) {
			const [row] = yield* database.run((db) =>
				db
					.select({ status: schema.importRun.status })
					.from(schema.importRun)
					.where(eq(schema.importRun.id, runId))
					.limit(1),
			);
			return row?.status ?? null;
		});

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

		const listRunFailurePage = Effect.fn("ImportsRepository.listRunFailurePage")(function* (input: {
			limit: number;
			runId: ImportRunId;
			after?: ImportRunFailureCursor | undefined;
		}) {
			const failures = yield* database.run((db) => {
				const runIdCondition = eq(schema.importRunFailure.runId, input.runId);
				const afterCondition =
					input.after === undefined
						? undefined
						: or(
								gt(schema.importRunFailure.createdAt, input.after.createdAt),
								and(
									eq(schema.importRunFailure.createdAt, input.after.createdAt),
									gt(schema.importRunFailure.id, input.after.id),
								),
							);
				return db
					.select({
						id: schema.importRunFailure.id,
						runId: schema.importRunFailure.runId,
						stage: schema.importRunFailure.stage,
						reason: schema.importRunFailure.reason,
						createdAt: schema.importRunFailure.createdAt,
						itemIndex: schema.importRunFailure.itemIndex,
						sourceLabel: schema.importRunFailure.sourceLabel,
						eventSchemaSlug: schema.importRunFailure.eventSchemaSlug,
						sourceIdentifier: schema.importRunFailure.sourceIdentifier,
						entitySchemaSlug: schema.importRunFailure.entitySchemaSlug,
					})
					.from(schema.importRunFailure)
					.where(
						afterCondition === undefined ? runIdCondition : and(runIdCondition, afterCondition),
					)
					.orderBy(asc(schema.importRunFailure.createdAt), asc(schema.importRunFailure.id))
					.limit(input.limit + 1);
			});
			const hasMore = failures.length > input.limit;
			const items = failures
				.slice(0, input.limit)
				.map((failure) =>
					Object.assign({}, failure, {
						runId: ImportRunId.make(failure.runId),
						createdAt: failure.createdAt.toISOString(),
						eventSchemaSlug:
							failure.eventSchemaSlug === null
								? null
								: EventSchemaSlug.make(failure.eventSchemaSlug),
						entitySchemaSlug:
							failure.entitySchemaSlug === null
								? null
								: EntitySchemaSlug.make(failure.entitySchemaSlug),
					}),
				);
			const last = failures[input.limit - 1];
			return {
				items,
				nextCursor:
					hasMore && last !== undefined ? { id: last.id, createdAt: last.createdAt } : null,
			};
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

		const markStarted = Effect.fn("ImportsRepository.markStarted")(function* (input: {
			runId: ImportRunId;
			startedAt: Date;
		}) {
			const rows = yield* database.run((db) =>
				db
					.update(schema.importRun)
					.set({ status: "running", startedAt: input.startedAt })
					.where(and(eq(schema.importRun.id, input.runId), eq(schema.importRun.status, "pending")))
					.returning({ id: schema.importRun.id }),
			);
			if (rows.length > 0) {
				return "started";
			}
			const status = yield* getRunStatus(input.runId);
			return status === "cancelling" || status === "cancelled"
				? "cancellation-requested"
				: "preserved";
		});

		type ProgressUpdate = {
			runId: ImportRunId;
			progress?: number;
			totalItems?: number;
			failedItems?: number;
			importedItems?: number;
			processedItems?: number;
		};
		const progressUpdates = (input: ProgressUpdate) => {
			const updates: Partial<typeof schema.importRun.$inferInsert> = {};
			if (input.progress !== undefined) {
				updates.progress = input.progress;
			}
			if (input.totalItems !== undefined) {
				updates.totalItems = input.totalItems;
			}
			if (input.failedItems !== undefined) {
				updates.failedItems = input.failedItems;
			}
			if (input.importedItems !== undefined) {
				updates.importedItems = input.importedItems;
			}
			if (input.processedItems !== undefined) {
				updates.processedItems = input.processedItems;
			}
			return updates;
		};

		const updateProgress = Effect.fn("ImportsRepository.updateProgress")(function* (
			input: ProgressUpdate,
		) {
			const updates = progressUpdates(input);
			if (Object.keys(updates).length === 0) {
				return false;
			}
			const rows = yield* database.run((db) =>
				db
					.update(schema.importRun)
					.set(updates)
					.where(and(eq(schema.importRun.id, input.runId), eq(schema.importRun.status, "running")))
					.returning({ id: schema.importRun.id }),
			);
			return rows.length > 0;
		});

		const settle = Effect.fn("ImportsRepository.settle")(function* (input: {
			finishedAt: Date;
			runId: ImportRunId;
			progress?: number;
			totalItems?: number;
			failedItems?: number;
			importedItems?: number;
			processedItems?: number;
			status: "completed" | "failed";
			failureReason?: ImportRunFailureReason;
			expectedStatuses: ReadonlyArray<"pending" | "running">;
		}) {
			const rows = yield* database.run((db) =>
				db
					.update(schema.importRun)
					.set({
						...progressUpdates(input),
						status: input.status,
						finishedAt: input.finishedAt,
						...(input.failureReason === undefined ? {} : { failureReason: input.failureReason }),
					})
					.where(
						and(
							eq(schema.importRun.id, input.runId),
							inArray(schema.importRun.status, [...input.expectedStatuses]),
						),
					)
					.returning({ id: schema.importRun.id }),
			);
			if (rows.length > 0) {
				return "settled";
			}
			const status = yield* getRunStatus(input.runId);
			return status === "cancelling" ? "cancellation-requested" : "preserved";
		});

		const finishCompleted = (input: ProgressUpdate & { finishedAt: Date }) =>
			settle({ ...input, status: "completed", expectedStatuses: ["running"] });
		const finishFailed = (
			input: ProgressUpdate & { finishedAt: Date; failureReason: ImportRunFailureReason },
		) => settle({ ...input, status: "failed", expectedStatuses: ["pending", "running"] });

		const requestCancellation = Effect.fn("ImportsRepository.requestCancellation")(
			function* (input: { userId: UserId; runId: ImportRunId }) {
				const rows = yield* database.run((db) =>
					db
						.update(schema.importRun)
						.set({ status: "cancelling" })
						.where(
							and(
								eq(schema.importRun.id, input.runId),
								eq(schema.importRun.userId, input.userId),
								inArray(schema.importRun.status, ["pending", "running"]),
							),
						)
						.returning({ id: schema.importRun.id }),
				);
				if (rows.length > 0) {
					return "requested";
				}
				const run = yield* getRunControlForUser(input);
				if (!run) {
					return null;
				}
				return run.status === "cancelling" || run.status === "cancelled"
					? "already-requested"
					: "not-cancellable";
			},
		);

		const finishCancelled = Effect.fn("ImportsRepository.finishCancelled")(function* (input: {
			runId: ImportRunId;
			finishedAt: Date;
		}) {
			const rows = yield* database.run((db) =>
				db
					.update(schema.importRun)
					.set({ status: "cancelled", failureReason: null, finishedAt: input.finishedAt })
					.where(
						and(eq(schema.importRun.id, input.runId), eq(schema.importRun.status, "cancelling")),
					)
					.returning({ id: schema.importRun.id }),
			);
			if (rows.length > 0) {
				return "settled" as const;
			}
			const status = yield* getRunStatus(input.runId);
			return status === "cancelled" ? ("settled" as const) : ("preserved" as const);
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

		const createFailure = Effect.fn("ImportsRepository.createFailure")(function* (input: {
			id?: string;
			runId: string;
			itemIndex: number;
			stage: ImportRunFailureStage;
			reason: ImportRunFailureReason;
			sourceLabel?: string | null | undefined;
			eventSchemaSlug?: string | null | undefined;
			sourceIdentifier?: string | null | undefined;
			entitySchemaSlug?: string | null | undefined;
		}) {
			yield* database.run((db) =>
				db
					.insert(schema.importRunFailure)
					.values({
						...(input.id === undefined ? {} : { id: input.id }),
						runId: input.runId,
						stage: input.stage,
						reason: input.reason,
						itemIndex: input.itemIndex,
						sourceLabel: input.sourceLabel ?? null,
						eventSchemaSlug: input.eventSchemaSlug ?? null,
						sourceIdentifier: input.sourceIdentifier ?? null,
						entitySchemaSlug: input.entitySchemaSlug ?? null,
					})
					.onConflictDoNothing(),
			);
		});

		return {
			getRunById,
			markStarted,
			finishFailed,
			deleteRunById,
			createFailure,
			updateProgress,
			finishCompleted,
			createManualRun,
			finishCancelled,
			getDataDocument,
			listRunFailurePage,
			updateInputSummary,
			requestCancellation,
			admitDataSubmission,
			findDataUploadRetry,
			releaseDataDocument,
			createIntegrationRun,
			getRunControlForUser,
			createIntegrationRunIfIdle,
			listRecentStatusesByIntegrationId,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
