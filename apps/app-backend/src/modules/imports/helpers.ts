import { createImportRunFailure, updateImportRun } from "./repository";
import type { ImportRunFailureStage } from "./schemas";

export type ImportRunFailureInput = {
	runId: string;
	message: string;
	itemIndex: number;
	sourceLabel?: string | null;
	stage: ImportRunFailureStage;
	eventSchemaSlug?: string | null;
	sourceIdentifier?: string | null;
	entitySchemaSlug?: string | null;
	context?: Record<string, unknown> | null;
};

export const sanitizeErrorMessage = (error: unknown, fallback: string): string => {
	if (!(error instanceof Error)) {
		return fallback;
	}
	return error.message;
};

export const failImportRun = async (
	runId: string,
	errorSummary: string,
	updateRun: typeof updateImportRun = updateImportRun,
): Promise<void> => {
	await updateRun({ runId, errorSummary, status: "failed", finishedAt: new Date() });
};

export const recordImportRunFailure = async (
	input: ImportRunFailureInput,
	createFailure: typeof createImportRunFailure = createImportRunFailure,
): Promise<void> => {
	await createFailure({
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
