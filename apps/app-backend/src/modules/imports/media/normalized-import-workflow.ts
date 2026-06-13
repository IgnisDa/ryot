import { Workflow } from "@effect/workflow";
import { ImportRunId, IntegrationId, UserId } from "@ryot/contract/schema/brands";
import { Schema } from "effect";

import { ImportRunError } from "../runtime/workflow-helpers";

export const NormalizedMediaImportJobData = Schema.Struct({
	runId: ImportRunId,
	userId: UserId,
	executionId: Schema.String,
	integrationId: Schema.optional(IntegrationId),
});

export type NormalizedMediaImportJobData = typeof NormalizedMediaImportJobData.Type;

// Single-owns the post-adapter media import pipeline (record failures, resolve, populate, write,
// finalize). Both parents (one-time imports and integrations) persist the normalized adapter
// result to Redis, then await this child so its activities journal under one canonical workflow
// instead of whichever parent invoked it.
export const ProcessNormalizedMediaImportWorkflow = Workflow.make({
	success: Schema.Void,
	error: ImportRunError,
	payload: NormalizedMediaImportJobData,
	idempotencyKey: ({ executionId }) => executionId,
	name: "ProcessNormalizedMediaImportWorkflow",
});
