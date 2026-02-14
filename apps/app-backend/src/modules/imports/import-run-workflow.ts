import { Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";

import { withoutSchemaServices } from "#lib/shared/schema";

import { ImportRunJobData } from "./jobs";
import { ImportRunError } from "./runtime/workflow-errors";

export const ProcessImportRunWorkflow = Workflow.make("ProcessImportRunWorkflow", {
	success: withoutSchemaServices(Schema.Void),
	error: withoutSchemaServices(ImportRunError),
	payload: withoutSchemaServices(ImportRunJobData),
	idempotencyKey: ({ runId }) => runId,
});
