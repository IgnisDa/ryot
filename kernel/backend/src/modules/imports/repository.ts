import { DbError } from "@ryot-app/contract/errors";
import type {
	ImportRunFailureReason,
	ListedImportRun,
} from "@ryot-app/contract/modules/imports/schemas";
import type {
	ImportRunFailureStage,
	ImportRunSource,
} from "@ryot-app/contract/modules/imports/types";
import type { IntegrationLot } from "@ryot-app/contract/modules/integrations/types";
import { ImportRunId, type IntegrationId, type UserId } from "@ryot-app/contract/schema/brands";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { isUniqueConstraintError } from "#lib/infrastructure/db/errors";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";

type ImportRunRow = typeof schema.importRun.$inferSelect;

export type ImportRunExecutionKind = "source" | "integration";
export type ImportRunSettlement = "settled" | "cancellation-requested" | "preserved";
export type ImportRunStart = "started" | "cancellation-requested" | "preserved";
export type ImportRunCancellation = "requested" | "already-requested" | "not-cancellable";

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
			pluginInstallationId: string;
			inputSummary: Record<string, unknown>;
			executionKind: ImportRunExecutionKind;
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
						executionKind: input.executionKind,
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
			pluginInstallationId: string;
			inputSummary: Record<string, unknown>;
		}) {
			return yield* insertRun({
				...input,
				integrationId: null,
				integrationLot: null,
				executionKind: "source",
			});
		});

		const createIntegrationRun = Effect.fn("ImportsRepository.createIntegrationRun")(
			function* (input: {
				userId: UserId;
				source: ImportRunSource;
				integrationId: IntegrationId;
				integrationLot: IntegrationLot;
				pluginInstallationId: string;
				inputSummary: Record<string, unknown>;
			}) {
				return yield* insertRun({ ...input, executionKind: "integration" });
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

		const getRunControlForUser = Effect.fn("ImportsRepository.getRunControlForUser")(
			function* (input: { userId: UserId; runId: ImportRunId }) {
				const [row] = yield* database.run((db) =>
					db
						.select({
							id: schema.importRun.id,
							status: schema.importRun.status,
							executionKind: schema.importRun.executionKind,
						})
						.from(schema.importRun)
						.where(
							and(eq(schema.importRun.id, input.runId), eq(schema.importRun.userId, input.userId)),
						)
						.limit(1),
				);
				return row ? { ...row, id: ImportRunId.make(row.id) } : null;
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
						runId: input.runId,
						stage: input.stage,
						reason: input.reason,
						itemIndex: input.itemIndex,
						sourceLabel: input.sourceLabel ?? null,
						eventSchemaSlug: input.eventSchemaSlug ?? null,
						sourceIdentifier: input.sourceIdentifier ?? null,
						entitySchemaSlug: input.entitySchemaSlug ?? null,
					}),
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
			updateInputSummary,
			requestCancellation,
			createIntegrationRun,
			getRunControlForUser,
			createIntegrationRunIfIdle,
			listRecentStatusesByIntegrationId,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
