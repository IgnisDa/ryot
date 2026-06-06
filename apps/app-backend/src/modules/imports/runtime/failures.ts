import { DateTime, Effect } from "effect";

import { DbRunner } from "#lib/db";

import { ImportsRepository } from "../repository";
import type { ImportRunFailureStage } from "../types";

export const PROGRESS_UPDATE_INTERVAL = 10;

type ImportRunFailureInput = {
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

export const sanitizeErrorMessage = (error: unknown, fallback: string): string =>
	error instanceof Error ? error.message : fallback;

export const failImportRun = (runId: string, errorSummary: string) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* ImportsRepository;
		const finishedAt = yield* DateTime.nowAsDate;
		yield* runWithDb(repository.updateRun({ runId, errorSummary, status: "failed", finishedAt }));
	});

export const recordImportRunFailure = (input: ImportRunFailureInput) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* ImportsRepository;
		yield* runWithDb(repository.createFailure(input));
	});
