import { and, asc, count, desc, eq, isNull } from "drizzle-orm";

import { assertPersisted, db } from "~/lib/db";
import { importRun, importRunFailure } from "~/lib/db/schema";

import type {
	ImportRunFailureStage,
	ImportRunSource,
	ImportRunStatus,
	ListedImportRun,
	ListedImportRunFailure,
} from "./schemas";

const importRunSelection = {
	id: importRun.id,
	source: importRun.source,
	status: importRun.status,
	progress: importRun.progress,
	createdAt: importRun.createdAt,
	updatedAt: importRun.updatedAt,
	startedAt: importRun.startedAt,
	finishedAt: importRun.finishedAt,
	totalItems: importRun.totalItems,
	failedItems: importRun.failedItems,
	errorSummary: importRun.errorSummary,
	inputSummary: importRun.inputSummary,
	importedItems: importRun.importedItems,
	processedItems: importRun.processedItems,
};

const importRunFailureSelection = {
	id: importRunFailure.id,
	runId: importRunFailure.runId,
	stage: importRunFailure.stage,
	message: importRunFailure.message,
	context: importRunFailure.context,
	createdAt: importRunFailure.createdAt,
	itemIndex: importRunFailure.itemIndex,
	sourceLabel: importRunFailure.sourceLabel,
	eventSchemaSlug: importRunFailure.eventSchemaSlug,
	entitySchemaSlug: importRunFailure.entitySchemaSlug,
	sourceIdentifier: importRunFailure.sourceIdentifier,
};

type ImportRunRow = Pick<typeof importRun.$inferSelect, keyof typeof importRunSelection>;
type ImportRunFailureRow = Pick<
	typeof importRunFailure.$inferSelect,
	keyof typeof importRunFailureSelection
>;

const normalizeRun = (row: ImportRunRow): ListedImportRun => ({
	id: row.id,
	source: row.source,
	status: row.status,
	progress: row.progress,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
	startedAt: row.startedAt,
	finishedAt: row.finishedAt,
	totalItems: row.totalItems,
	failedItems: row.failedItems,
	errorSummary: row.errorSummary,
	inputSummary: row.inputSummary,
	importedItems: row.importedItems,
	processedItems: row.processedItems,
});

const normalizeFailure = (row: ImportRunFailureRow): ListedImportRunFailure => ({
	id: row.id,
	runId: row.runId,
	stage: row.stage,
	message: row.message,
	context: row.context,
	createdAt: row.createdAt,
	itemIndex: row.itemIndex,
	sourceLabel: row.sourceLabel,
	eventSchemaSlug: row.eventSchemaSlug,
	sourceIdentifier: row.sourceIdentifier,
	entitySchemaSlug: row.entitySchemaSlug,
});

export const createImportRun = async (input: {
	userId: string;
	source: ImportRunSource;
	integrationId?: string | null;
	inputSummary: Record<string, unknown>;
}): Promise<ListedImportRun> => {
	const [created] = await db
		.insert(importRun)
		.values({
			userId: input.userId,
			source: input.source,
			inputSummary: input.inputSummary,
			integrationId: input.integrationId ?? null,
		})
		.returning(importRunSelection);
	return normalizeRun(assertPersisted(created, "import_run"));
};

export const getImportRunById = async (input: {
	runId: string;
	userId: string;
}): Promise<ListedImportRun | undefined> => {
	const [found] = await db
		.select(importRunSelection)
		.from(importRun)
		.where(and(eq(importRun.id, input.runId), eq(importRun.userId, input.userId)))
		.limit(1);
	return found ? normalizeRun(found) : undefined;
};

export const listImportRunsByUser = async (input: {
	userId: string;
}): Promise<ListedImportRun[]> => {
	const rows = await db
		.select(importRunSelection)
		.from(importRun)
		.where(and(eq(importRun.userId, input.userId), isNull(importRun.integrationId)))
		.orderBy(desc(importRun.createdAt));
	return rows.map(normalizeRun);
};

export const updateImportRun = async (input: {
	runId: string;
	progress?: number;
	failedItems?: number;
	importedItems?: number;
	processedItems?: number;
	startedAt?: Date | null;
	finishedAt?: Date | null;
	status?: ImportRunStatus;
	totalItems?: number | null;
	errorSummary?: string | null;
}): Promise<void> => {
	type UpdateSet = Partial<typeof importRun.$inferInsert>;
	const updates: UpdateSet = {};
	if (input.status !== undefined) {
		updates.status = input.status;
	}
	if (input.progress !== undefined) {
		updates.progress = input.progress;
	}
	if (input.startedAt !== undefined) {
		updates.startedAt = input.startedAt ?? null;
	}
	if (input.finishedAt !== undefined) {
		updates.finishedAt = input.finishedAt ?? null;
	}
	if (input.totalItems !== undefined) {
		updates.totalItems = input.totalItems ?? null;
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
	if (input.errorSummary !== undefined) {
		updates.errorSummary = input.errorSummary ?? null;
	}
	if (Object.keys(updates).length === 0) {
		return;
	}
	await db.update(importRun).set(updates).where(eq(importRun.id, input.runId));
};

export const deleteImportRunById = async (input: {
	runId: string;
	userId: string;
}): Promise<void> => {
	await db
		.delete(importRun)
		.where(and(eq(importRun.id, input.runId), eq(importRun.userId, input.userId)));
};

export const createImportRunFailure = async (input: {
	runId: string;
	message: string;
	itemIndex: number;
	sourceLabel?: string | null;
	stage: ImportRunFailureStage;
	eventSchemaSlug?: string | null;
	sourceIdentifier?: string | null;
	entitySchemaSlug?: string | null;
	context?: Record<string, unknown> | null;
}): Promise<void> => {
	await db.insert(importRunFailure).values({
		runId: input.runId,
		stage: input.stage,
		message: input.message,
		itemIndex: input.itemIndex,
		context: input.context ?? null,
		sourceLabel: input.sourceLabel ?? null,
		eventSchemaSlug: input.eventSchemaSlug ?? null,
		sourceIdentifier: input.sourceIdentifier ?? null,
		entitySchemaSlug: input.entitySchemaSlug ?? null,
	});
};

export const listImportRunFailuresByRunId = async (input: {
	page: number;
	runId: string;
	limit: number;
}): Promise<{ items: ListedImportRunFailure[]; total: number }> => {
	const offset = (input.page - 1) * input.limit;
	const [rows, totalRows] = await Promise.all([
		db
			.select(importRunFailureSelection)
			.from(importRunFailure)
			.where(eq(importRunFailure.runId, input.runId))
			.orderBy(asc(importRunFailure.createdAt))
			.limit(input.limit)
			.offset(offset),
		db
			.select({ total: count() })
			.from(importRunFailure)
			.where(eq(importRunFailure.runId, input.runId)),
	]);
	return { total: totalRows[0]?.total ?? 0, items: rows.map(normalizeFailure) };
};
