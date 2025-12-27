import type { ImportRunFailureStage } from "@ryot/contract/modules/imports/types";
import { DateTime, Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";

import { ImportsRepository } from "../repository";

export const PROGRESS_UPDATE_INTERVAL = 10;

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

export type ImportRunFailureDetails = Omit<ImportRunFailureInput, "runId">;

export const sanitizeErrorMessage = (error: unknown, fallback: string): string =>
	error instanceof Error ? error.message : fallback;

export const markImportRunStarted = Effect.fn("imports.markImportRunStarted")(function* (
	runId: string,
) {
	const runWithDb = yield* DbRunner;
	const startedAt = yield* DateTime.nowAsDate;
	const repository = yield* ImportsRepository;
	yield* runWithDb(repository.updateRun({ runId, status: "running", startedAt }));
});

export const failImportRun = Effect.fn("imports.failImportRun")(function* (
	runId: string,
	errorSummary: string,
) {
	const runWithDb = yield* DbRunner;
	const repository = yield* ImportsRepository;
	const finishedAt = yield* DateTime.nowAsDate;
	yield* runWithDb(repository.updateRun({ runId, errorSummary, status: "failed", finishedAt }));
});

export const recordImportRunFailure = Effect.fn("imports.recordImportRunFailure")(function* (
	input: ImportRunFailureInput,
) {
	const runWithDb = yield* DbRunner;
	const repository = yield* ImportsRepository;
	yield* runWithDb(repository.createFailure(input));
});

export const failImportRunWithFailures = Effect.fn("imports.failImportRunWithFailures")(
	function* (input: {
		runId: string;
		errorSummary?: string;
		failures: ReadonlyArray<ImportRunFailureDetails>;
	}) {
		const runWithDb = yield* DbRunner;
		const repository = yield* ImportsRepository;
		const failureCount = input.failures.length;
		const errorSummary = input.errorSummary ?? input.failures[0]?.message ?? "Import run failed";

		for (const failure of input.failures) {
			yield* recordImportRunFailure({ ...failure, runId: input.runId });
		}

		const finishedAt = yield* DateTime.nowAsDate;
		yield* runWithDb(
			repository.updateRun({
				finishedAt,
				errorSummary,
				progress: 100,
				status: "failed",
				runId: input.runId,
				totalItems: failureCount,
				failedItems: failureCount,
				processedItems: failureCount,
			}),
		);
	},
);
