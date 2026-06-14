import { Workflow } from "@effect/workflow";
import { ImportRunId, IntegrationId, UserId } from "@ryot/contract/schema/brands";
import { Schema } from "effect";

import { ImportRunError } from "../runtime/workflow-errors";

export const NormalizedMediaImportJobData = Schema.Struct({
	runId: ImportRunId,
	userId: UserId,
	executionId: Schema.String,
	integrationId: Schema.optional(IntegrationId),
});

export type NormalizedMediaImportJobData = typeof NormalizedMediaImportJobData.Type;

export const ProcessNormalizedMediaImportWorkflow = Workflow.make({
	success: Schema.Void,
	error: ImportRunError,
	payload: NormalizedMediaImportJobData,
	idempotencyKey: ({ executionId }) => executionId,
	name: "ProcessNormalizedMediaImportWorkflow",
});
