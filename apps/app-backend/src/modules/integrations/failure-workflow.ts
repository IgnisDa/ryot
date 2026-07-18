import { unknownToMessage } from "@ryot/contract/errors";
import type { ImportRunId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";
import { Activity } from "effect/unstable/workflow";

import type { ImportRunFailureDetails } from "#modules/imports/failure-service";
import {
	failImportRun,
	failImportRunWithFailures,
} from "#modules/imports/runtime/import-run-status";

import { IntegrationRunError } from "./jobs";

export const toIntegrationWorkflowError = (cause: unknown) =>
	new IntegrationRunError({ message: unknownToMessage(cause) });

export const failRun = (name: string, runId: ImportRunId, message: string) => {
	const failEffect = failImportRun(runId, message).pipe(
		Effect.mapError(toIntegrationWorkflowError),
	);
	return Activity.make({
		name,
		error: IntegrationRunError,
		execute: failEffect,
	});
};

export const failRunWithFailures = (input: {
	name: string;
	runId: ImportRunId;
	errorSummary?: string;
	failures: ReadonlyArray<ImportRunFailureDetails>;
}) => {
	const failWithFailuresEffect = failImportRunWithFailures({
		runId: input.runId,
		failures: input.failures,
		...(input.errorSummary !== undefined ? { errorSummary: input.errorSummary } : {}),
	}).pipe(Effect.mapError(toIntegrationWorkflowError));
	return Activity.make({
		name: input.name,
		error: IntegrationRunError,
		execute: failWithFailuresEffect,
	});
};
