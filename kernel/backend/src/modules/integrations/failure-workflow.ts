import { unknownToMessage } from "@ryot-app/contract/errors";
import type { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import type { ImportRunId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";
import { Activity } from "effect/unstable/workflow";

import { failImportRun } from "#modules/imports/runtime/import-run-status";

import { IntegrationRunError } from "./jobs";

export const toIntegrationWorkflowError = (cause: unknown) =>
	new IntegrationRunError({ message: unknownToMessage(cause) });

export const failRun = (name: string, runId: ImportRunId, reason: ImportRunFailureReason) => {
	const failEffect = failImportRun(runId, reason).pipe(Effect.mapError(toIntegrationWorkflowError));
	return Activity.make({ name, error: IntegrationRunError, execute: failEffect });
};
