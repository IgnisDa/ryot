import { DbError } from "@ryot/contract/errors";
import type {
	ListedImportRun,
	ListedImportRunFailure,
} from "@ryot/contract/modules/imports/schemas";
import type {
	ImportRunFailureStage,
	ImportRunSource,
	ImportRunStatus,
} from "@ryot/contract/modules/imports/types";
import { ImportRunId, type IntegrationId, type UserId } from "@ryot/contract/schema/brands";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

type ImportRunRow = typeof schema.importRun.$inferSelect;
type ImportRunFailureRow = typeof schema.importRunFailure.$inferSelect;

const normalizeRun = (row: ImportRunRow): ListedImportRun => ({
	id: ImportRunId.make(row.id),
	source: row.source,
	status: row.status,
	progress: row.progress,
	totalItems: row.totalItems,
	failedItems: row.failedItems,
	errorSummary: row.errorSummary,
	inputSummary: row.inputSummary,
	importedItems: row.importedItems,
	processedItems: row.processedItems,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	startedAt: row.startedAt?.toISOString() ?? null,
	finishedAt: row.finishedAt?.toISOString() ?? null,
});

const normalizeFailure = (row: ImportRunFailureRow): ListedImportRunFailure => ({
	id: row.id,
	runId: ImportRunId.make(row.runId),
	stage: row.stage,
	message: row.message,
	context: row.context,
	itemIndex: row.itemIndex,
	sourceLabel: row.sourceLabel,
	eventSchemaSlug: row.eventSchemaSlug,
	sourceIdentifier: row.sourceIdentifier,
	entitySchemaSlug: row.entitySchemaSlug,
	createdAt: row.createdAt.toISOString(),
});

export class ImportsRepository extends Effect.Service<ImportsRepository>()("ImportsRepository", {
	sync: () => {
		const createRun = Effect.fn("ImportsRepository.createRun")(function* (input: {
			userId: UserId;
			source: ImportRunSource;
			integrationId?: IntegrationId | null;
			inputSummary: Record<string, unknown>;
		}) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.insert(schema.importRun)
					.values({
						userId: input.userId,
						source: input.source,
						inputSummary: input.inputSummary,
						integrationId: input.integrationId ?? null,
					})
					.returning(),
			);
			if (!row) {
				return yield* new DbError({ message: "Import run insert returned no row" });
			}
			return normalizeRun(row);
		});

		const getRunById = Effect.fn("ImportsRepository.getRunById")(function* (input: {
			runId: ImportRunId;
			userId: UserId;
		}) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
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

		const listRunsByUser = Effect.fn("ImportsRepository.listRunsByUser")(function* (input: {
			userId: UserId;
		}) {
			const db = yield* CurrentDb;
			const rows = yield* dbEffect(() =>
				db
					.select()
					.from(schema.importRun)
					.where(
						and(eq(schema.importRun.userId, input.userId), isNull(schema.importRun.integrationId)),
					)
					.orderBy(desc(schema.importRun.createdAt)),
			);
			return rows.map(normalizeRun);
		});

		const listRunsByIntegrationId = Effect.fn("ImportsRepository.listRunsByIntegrationId")(
			function* (input: { userId: UserId; integrationId: IntegrationId }) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select()
						.from(schema.importRun)
						.where(
							and(
								eq(schema.importRun.userId, input.userId),
								eq(schema.importRun.integrationId, input.integrationId),
							),
						)
						.orderBy(desc(schema.importRun.createdAt)),
				);
				return rows.map(normalizeRun);
			},
		);

		const hasActiveRunForIntegration = Effect.fn("ImportsRepository.hasActiveRunForIntegration")(
			function* (input: { integrationId: IntegrationId }) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({ id: schema.importRun.id })
						.from(schema.importRun)
						.where(
							and(
								eq(schema.importRun.integrationId, input.integrationId),
								inArray(schema.importRun.status, ["pending", "running"]),
							),
						)
						.limit(1),
				);
				return row !== undefined;
			},
		);

		const listRecentStatusesByIntegrationId = Effect.fn(
			"ImportsRepository.listRecentStatusesByIntegrationId",
		)(function* (input: { integrationId: IntegrationId; limit: number }) {
			const db = yield* CurrentDb;
			return yield* dbEffect(() =>
				db
					.select({ status: schema.importRun.status })
					.from(schema.importRun)
					.where(eq(schema.importRun.integrationId, input.integrationId))
					.orderBy(desc(schema.importRun.createdAt))
					.limit(input.limit),
			);
		});

		const updateRun = Effect.fn("ImportsRepository.updateRun")(function* (input: {
			runId: string;
			startedAt?: Date;
			finishedAt?: Date;
			progress?: number;
			totalItems?: number;
			failedItems?: number;
			errorSummary?: string;
			importedItems?: number;
			processedItems?: number;
			status?: ImportRunStatus;
		}) {
			const db = yield* CurrentDb;
			const updates: Partial<typeof schema.importRun.$inferInsert> = {};
			if (input.status !== undefined) {
				updates.status = input.status;
			}
			if (input.progress !== undefined) {
				updates.progress = input.progress;
			}
			if (input.startedAt !== undefined) {
				updates.startedAt = input.startedAt;
			}
			if (input.totalItems !== undefined) {
				updates.totalItems = input.totalItems;
			}
			if (input.finishedAt !== undefined) {
				updates.finishedAt = input.finishedAt;
			}
			if (input.failedItems !== undefined) {
				updates.failedItems = input.failedItems;
			}
			if (input.errorSummary !== undefined) {
				updates.errorSummary = input.errorSummary;
			}
			if (input.importedItems !== undefined) {
				updates.importedItems = input.importedItems;
			}
			if (input.processedItems !== undefined) {
				updates.processedItems = input.processedItems;
			}
			if (Object.keys(updates).length === 0) {
				return;
			}
			yield* dbEffect(() =>
				db.update(schema.importRun).set(updates).where(eq(schema.importRun.id, input.runId)),
			);
		});

		const deleteRunById = Effect.fn("ImportsRepository.deleteRunById")(function* (input: {
			runId: ImportRunId;
			userId: UserId;
		}) {
			const db = yield* CurrentDb;
			yield* dbEffect(() =>
				db
					.delete(schema.importRun)
					.where(
						and(eq(schema.importRun.id, input.runId), eq(schema.importRun.userId, input.userId)),
					),
			);
		});

		const createFailure = Effect.fn("ImportsRepository.createFailure")(function* (input: {
			runId: string;
			message: string;
			itemIndex: number;
			sourceLabel?: string | null;
			stage: ImportRunFailureStage;
			eventSchemaSlug?: string | null;
			sourceIdentifier?: string | null;
			entitySchemaSlug?: string | null;
			context?: Record<string, unknown> | null;
		}) {
			const db = yield* CurrentDb;
			yield* dbEffect(() =>
				db.insert(schema.importRunFailure).values({
					runId: input.runId,
					stage: input.stage,
					message: input.message,
					itemIndex: input.itemIndex,
					context: input.context ?? null,
					sourceLabel: input.sourceLabel ?? null,
					eventSchemaSlug: input.eventSchemaSlug ?? null,
					sourceIdentifier: input.sourceIdentifier ?? null,
					entitySchemaSlug: input.entitySchemaSlug ?? null,
				}),
			);
		});

		const listFailuresByRunId = Effect.fn("ImportsRepository.listFailuresByRunId")(
			function* (input: { runId: ImportRunId; page: number; limit: number }) {
				const db = yield* CurrentDb;
				const offset = (input.page - 1) * input.limit;
				const [rows, totals] = yield* Effect.all([
					dbEffect(() =>
						db
							.select()
							.from(schema.importRunFailure)
							.where(eq(schema.importRunFailure.runId, input.runId))
							.orderBy(asc(schema.importRunFailure.createdAt))
							.limit(input.limit)
							.offset(offset),
					),
					dbEffect(() =>
						db
							.select({ total: count() })
							.from(schema.importRunFailure)
							.where(eq(schema.importRunFailure.runId, input.runId)),
					),
				]);
				return { total: totals[0]?.total ?? 0, items: rows.map(normalizeFailure) };
			},
		);

		return {
			createRun,
			getRunById,
			listRunsByUser,
			listRunsByIntegrationId,
			hasActiveRunForIntegration,
			listRecentStatusesByIntegrationId,
			updateRun,
			deleteRunById,
			createFailure,
			listFailuresByRunId,
		};
	},
}) {}
