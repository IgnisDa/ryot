import { Activity } from "@effect/workflow";
import { unknownToMessage } from "@ryot/contract/errors";
import type { ImportRunId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import type { MediaImportAdapterFailure } from "#modules/imports/media/adapter-result";
import {
	failImportRun,
	failImportRunWithFailures,
	type ImportRunFailureDetails,
} from "#modules/imports/runtime/import-run-status";

import { IntegrationRunError } from "./jobs";

export const toIntegrationWorkflowError = (cause: unknown) =>
	new IntegrationRunError({ message: unknownToMessage(cause) });

export const failRun = (name: string, runId: ImportRunId, message: string) =>
	Activity.make({
		name,
		error: IntegrationRunError,
		execute: failImportRun(runId, message).pipe(Effect.mapError(toIntegrationWorkflowError)),
	});

const toImportFailure = (failure: MediaImportAdapterFailure): ImportRunFailureDetails => ({
	message: failure.message,
	itemIndex: failure.itemIndex,
	sourceLabel: failure.sourceLabel,
	sourceIdentifier: failure.sourceIdentifier,
	stage: failure.stage ?? "input_transformation",
	context: failure.context ? { ...failure.context } : null,
});

export const failRunWithFailures = (input: {
	name: string;
	runId: ImportRunId;
	errorSummary?: string;
	failures: ReadonlyArray<ImportRunFailureDetails>;
}) =>
	Activity.make({
		name: input.name,
		error: IntegrationRunError,
		execute: failImportRunWithFailures({
			runId: input.runId,
			failures: input.failures,
			...(input.errorSummary !== undefined ? { errorSummary: input.errorSummary } : {}),
		}).pipe(Effect.mapError(toIntegrationWorkflowError)),
	});

export const failRunWithAdapterFailures = (
	name: string,
	runId: ImportRunId,
	failures: ReadonlyArray<MediaImportAdapterFailure>,
) => failRunWithFailures({ name, runId, failures: failures.map(toImportFailure) });
