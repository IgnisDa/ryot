import { DbError } from "@ryot/contract/errors";
import type { ListedImportRun } from "@ryot/contract/modules/imports/schemas";
import type { ImportRunFailureStage, ImportRunSource } from "@ryot/contract/modules/imports/types";
import { ImportRunId, type IntegrationId, type UserId } from "@ryot/contract/schema/brands";
import type { RunStatus } from "@ryot/contract/schema/run-status";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

type ImportRunRow = typeof schema.importRun.$inferSelect;

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

export class ImportsRepository extends Context.Service<ImportsRepository>()("ImportsRepository", {
	make: Effect.sync(() => {
		const createRun = Effect.fn("ImportsRepository.createRun")(function* (input: {
			userId: UserId;
			source: ImportRunSource;
			integrationId?: IntegrationId | null;
			inputSummary: Record<string, unknown>;
		}) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
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
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
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

		const hasActiveRunForIntegration = Effect.fn("ImportsRepository.hasActiveRunForIntegration")(
			function* (input: { integrationId: IntegrationId }) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
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
			const db = yield* Database;
			return yield* mapDatabaseErrors(
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
			status?: RunStatus;
			totalItems?: number;
			failedItems?: number;
			errorSummary?: string;
			importedItems?: number;
			processedItems?: number;
			inputSummary?: Record<string, unknown>;
		}) {
			const db = yield* Database;
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
			if (input.inputSummary !== undefined) {
				updates.inputSummary = input.inputSummary;
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
			yield* mapDatabaseErrors(
				db.update(schema.importRun).set(updates).where(eq(schema.importRun.id, input.runId)),
			);
		});

		const deleteRunById = Effect.fn("ImportsRepository.deleteRunById")(function* (input: {
			userId: UserId;
			runId: ImportRunId;
		}) {
			const db = yield* Database;
			yield* mapDatabaseErrors(
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
			stage: ImportRunFailureStage;
			sourceLabel?: string | null | undefined;
			eventSchemaSlug?: string | null | undefined;
			sourceIdentifier?: string | null | undefined;
			entitySchemaSlug?: string | null | undefined;
			context?: Record<string, unknown> | null | undefined;
		}) {
			const db = yield* Database;
			yield* mapDatabaseErrors(
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

		return {
			updateRun,
			createRun,
			getRunById,
			deleteRunById,
			createFailure,
			hasActiveRunForIntegration,
			listRecentStatusesByIntegrationId,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
